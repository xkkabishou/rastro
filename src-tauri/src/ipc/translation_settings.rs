// 翻译 Provider 配置管理 + translate_text IPC Commands
// T1.2.1: 翻译配置 CRUD — 独立于主 AI Provider 配置 (ADR-301)
// T1.2.2: translate_text — 使用翻译 Provider 翻译文本片段
use std::str::FromStr;
use std::time::Instant;

use serde::Serialize;
use tauri::State;

use crate::{
    ai_integration::provider_registry::{
        default_base_url, map_provider_http_error, normalize_base_url, validate_base_url,
    },
    app_state::AppState,
    errors::{AppError, AppErrorCode},
    models::ProviderId,
    storage::translation_provider_settings,
};

/// 翻译 Provider 配置 DTO（脱敏）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationProviderConfigDto {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: Option<String>,
    pub is_active: bool,
    pub masked_key: Option<String>,
}

/// 翻译 Provider 连接测试结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationConnectivityDto {
    pub provider: ProviderId,
    pub model: String,
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// translate_text 返回结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTextResult {
    pub translated: String,
}

// --- Keychain 前缀隔离 ---
// 翻译 Key: "translation_{provider}" (ADR-301)
// 主 AI Key: "provider:{provider}"   (已有)
fn translation_keychain_account(provider: &str) -> String {
    format!("translation_{provider}")
}

// --- T1.2.1: 翻译配置管理 IPC Commands ---

/// 列出所有翻译 Provider 配置（脱敏）
#[tauri::command]
pub fn list_translation_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<TranslationProviderConfigDto>, AppError> {
    let records = {
        let connection = state.storage.connection();
        translation_provider_settings::list_all(&connection)?
    };

    records
        .into_iter()
        .map(|record| build_translation_config_dto(record))
        .collect()
}

/// 保存翻译 API Key（Keychain translation_ 前缀 + DB 脱敏 Key）
#[tauri::command]
pub fn save_translation_provider_key(
    state: State<'_, AppState>,
    provider: ProviderId,
    api_key: String,
) -> Result<TranslationProviderConfigDto, AppError> {
    // 写入 Keychain（使用 translation_ 前缀与主 Key 隔离）
    let account = translation_keychain_account(provider.as_str());
    state.keychain.save_key(&account, &api_key)?;

    // 脱敏 Key 写入 DB
    let masked = state.keychain.mask_key(&api_key);
    let record = {
        let connection = state.storage.connection();
        translation_provider_settings::update_masked_key(
            &connection,
            provider.as_str(),
            Some(&masked),
        )?;
        translation_provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderNotConfigured,
            "翻译 Provider 配置不存在",
            false,
        )
    })?;

    build_translation_config_dto(record)
}

/// 设置活跃翻译 Provider + 模型
#[tauri::command]
pub fn set_active_translation_provider(
    state: State<'_, AppState>,
    provider: ProviderId,
    model: String,
) -> Result<TranslationProviderConfigDto, AppError> {
    let record = {
        let mut connection = state.storage.connection();
        translation_provider_settings::set_active(&mut connection, provider.as_str(), &model)?
    };

    build_translation_config_dto(record)
}

/// 更新翻译 Provider 配置（base_url、model）
#[tauri::command]
pub fn update_translation_provider_config(
    state: State<'_, AppState>,
    provider: ProviderId,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<TranslationProviderConfigDto, AppError> {
    let normalized_base_url = base_url
        .as_deref()
        .map(|value| normalize_base_url(provider, value));

    if let Some(ref url) = normalized_base_url {
        validate_base_url(url)?;
    }

    let record = {
        let connection = state.storage.connection();
        translation_provider_settings::update_config(
            &connection,
            provider.as_str(),
            normalized_base_url.as_deref(),
            model.as_deref(),
        )?
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::InternalError,
            "未找到对应翻译 Provider 配置",
            false,
        )
    })?;

    build_translation_config_dto(record)
}

/// 测试翻译 Provider 连接
#[tauri::command]
pub async fn test_translation_connection(
    state: State<'_, AppState>,
    provider: ProviderId,
) -> Result<TranslationConnectivityDto, AppError> {
    let config = resolve_translation_runtime_config(&state, provider)?;

    let client = reqwest::Client::new();
    let request = build_translation_test_request(&client, &config);

    let started = Instant::now();
    let response = request
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| {
            AppError::new(
                AppErrorCode::ProviderConnectionFailed,
                format!("翻译 API 连接失败: {}", err),
                true,
            )
        })?;
    let latency_ms = started.elapsed().as_millis() as u64;

    if response.status().is_success() {
        return Ok(TranslationConnectivityDto {
            provider,
            model: config.model,
            success: true,
            latency_ms: Some(latency_ms),
            error: None,
        });
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(map_provider_http_error(
        status,
        &body,
        "翻译 API 测试失败",
    ))
}

// --- T1.2.2: translate_text IPC Command ---

/// 翻译文本片段（使用翻译 Provider 配置）
#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    text: String,
) -> Result<TranslateTextResult, AppError> {
    // 读取活跃的翻译 Provider 配置
    let active_record = {
        let connection = state.storage.connection();
        translation_provider_settings::get_active(&connection)?
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderNotConfigured,
            "请先在设置中配置翻译 API",
            false,
        )
    })?;

    let provider = ProviderId::from_str(&active_record.provider)?;
    let config = resolve_translation_runtime_config(&state, provider)?;

    // 构建翻译请求
    let client = reqwest::Client::new();
    let prompt = format!(
        "请将以下英文文本翻译为中文，只输出翻译结果，不要解释：\n\n{}",
        text
    );

    let request = build_translation_chat_request(&client, &config, &prompt);
    let response = request
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|err| {
            AppError::new(
                AppErrorCode::ProviderConnectionFailed,
                format!("翻译请求失败: {}", err),
                true,
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(map_provider_http_error(status, &body, "翻译请求失败"));
    }

    let body: serde_json::Value = response.json().await.map_err(|err| {
        AppError::new(
            AppErrorCode::InternalError,
            format!("解析翻译响应失败: {}", err),
            true,
        )
    })?;

    // 从不同 Provider 的响应格式中提取翻译文本
    let translated = extract_chat_response_text(provider, &body)
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::InternalError,
                "无法从翻译 API 响应中提取文本",
                true,
            )
        })?;

    Ok(TranslateTextResult {
        translated: translated.trim().to_string(),
    })
}

// --- 内部辅助函数 ---

/// 翻译 Provider 运行时配置
pub(crate) struct TranslationRuntimeConfig {
    pub(crate) provider: ProviderId,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
}

/// 解析翻译 Provider 的运行时配置（独立于主 AI 配置）
pub(crate) fn resolve_translation_runtime_config(
    state: &State<'_, AppState>,
    provider: ProviderId,
) -> Result<TranslationRuntimeConfig, AppError> {
    let record = {
        let connection = state.storage.connection();
        translation_provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderNotConfigured,
            format!("翻译 Provider {} 未配置", provider.as_str()),
            false,
        )
    })?;

    if record.model.is_empty() {
        return Err(AppError::new(
            AppErrorCode::ProviderNotConfigured,
            format!("翻译 Provider {} 未设置模型", provider.as_str()),
            false,
        ));
    }

    // 从 Keychain 读取翻译 API Key（translation_ 前缀）
    let account = translation_keychain_account(provider.as_str());
    let api_key = state.keychain.get_key(&account)?.ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderKeyMissing,
            format!("翻译 Provider {} 尚未保存 API Key", provider.as_str()),
            false,
        )
    })?;

    let resolved_base_url = record
        .base_url
        .as_ref()
        .map(|value| normalize_base_url(provider, value))
        .unwrap_or_else(|| default_base_url(provider).to_string());

    if record.base_url.is_some() {
        validate_base_url(&resolved_base_url)?;
    }

    Ok(TranslationRuntimeConfig {
        provider,
        model: record.model,
        base_url: resolved_base_url,
        api_key,
    })
}

/// 构建翻译连接测试请求（非流式，最小 tokens）
fn build_translation_test_request(
    client: &reqwest::Client,
    config: &TranslationRuntimeConfig,
) -> reqwest::RequestBuilder {
    match config.provider {
        ProviderId::Openai => client
            .post(format!(
                "{}/chat/completions",
                config.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&config.api_key)
            .json(&serde_json::json!({
                "model": config.model,
                "stream": false,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 8
            })),
        ProviderId::Claude => client
            .post(format!(
                "{}/messages",
                config.base_url.trim_end_matches('/')
            ))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": config.model,
                "max_tokens": 8,
                "messages": [{"role": "user", "content": "ping"}]
            })),
        ProviderId::Gemini => client
            .post(format!(
                "{}/models/{}:generateContent?key={}",
                config.base_url.trim_end_matches('/'),
                config.model,
                config.api_key
            ))
            .json(&serde_json::json!({
                "contents": [{"role": "user", "parts": [{"text": "ping"}]}]
            })),
    }
}

/// 构建翻译聊天请求（非流式）
pub(crate) fn build_translation_chat_request(
    client: &reqwest::Client,
    config: &TranslationRuntimeConfig,
    prompt: &str,
) -> reqwest::RequestBuilder {
    match config.provider {
        ProviderId::Openai => client
            .post(format!(
                "{}/chat/completions",
                config.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&config.api_key)
            .json(&serde_json::json!({
                "model": config.model,
                "stream": false,
                "messages": [{"role": "user", "content": prompt}]
            })),
        ProviderId::Claude => client
            .post(format!(
                "{}/messages",
                config.base_url.trim_end_matches('/')
            ))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": config.model,
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}]
            })),
        ProviderId::Gemini => client
            .post(format!(
                "{}/models/{}:generateContent?key={}",
                config.base_url.trim_end_matches('/'),
                config.model,
                config.api_key
            ))
            .json(&serde_json::json!({
                "contents": [{"role": "user", "parts": [{"text": prompt}]}]
            })),
    }
}

/// 从非流式聊天响应中提取文本内容
pub(crate) fn extract_chat_response_text(provider: ProviderId, body: &serde_json::Value) -> Option<String> {
    match provider {
        ProviderId::Openai => {
            // OpenAI: { "choices": [{ "message": { "content": "..." } }] }
            body.get("choices")?
                .get(0)?
                .get("message")?
                .get("content")?
                .as_str()
                .map(String::from)
        }
        ProviderId::Claude => {
            // Claude: { "content": [{ "type": "text", "text": "..." }] }
            let content = body.get("content")?.as_array()?;
            content
                .iter()
                .filter_map(|block| {
                    if block.get("type")?.as_str()? == "text" {
                        block.get("text")?.as_str().map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("")
                .into()
        }
        ProviderId::Gemini => {
            // Gemini: { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
            body.get("candidates")?
                .get(0)?
                .get("content")?
                .get("parts")?
                .get(0)?
                .get("text")?
                .as_str()
                .map(String::from)
        }
    }
}

fn build_translation_config_dto(
    record: translation_provider_settings::TranslationProviderSettingRecord,
) -> Result<TranslationProviderConfigDto, AppError> {
    Ok(TranslationProviderConfigDto {
        provider: record.provider.parse()?,
        model: record.model,
        base_url: record.base_url,
        is_active: record.is_active,
        masked_key: record.masked_key,
    })
}
