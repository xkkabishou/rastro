// Provider 配置解析与请求适配
use std::{str::FromStr, time::Instant};

use reqwest::{Client, RequestBuilder};
use serde_json::{json, Value};

use crate::{
    ai_integration::{AiIntegration, ProviderConnectivityResult},
    errors::{AppError, AppErrorCode},
    models::ProviderId,
    storage::provider_settings,
};

/// Provider 运行时配置
#[derive(Debug, Clone)]
pub struct ProviderRuntimeConfig {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

/// 解析 Provider 的生效配置
pub fn resolve_runtime_config(
    ai: &AiIntegration,
    explicit_provider: Option<ProviderId>,
    explicit_model: Option<String>,
) -> Result<ProviderRuntimeConfig, AppError> {
    let setting = {
        let connection = ai.storage.connection();
        if let Some(provider) = explicit_provider {
            provider_settings::get_by_provider(&connection, provider.as_str())?
        } else {
            provider_settings::get_active(&connection)?
        }
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderKeyMissing,
            "未找到可用的 Provider 配置",
            false,
        )
    })?;

    let provider = explicit_provider.unwrap_or_else(|| {
        ProviderId::from_str(&setting.provider).expect("provider_settings should stay normalized")
    });
    let model = explicit_model.unwrap_or_else(|| setting.model.clone());
    let api_key = match ai.keychain.get_key(provider.as_str())? {
        Some(value) => value,
        None if setting
            .base_url
            .as_deref()
            .map(|value| value.starts_with("http://127.0.0.1"))
            .unwrap_or(false) =>
        {
            "test-key".to_string()
        }
        None => {
            return Err(AppError::new(
                AppErrorCode::ProviderKeyMissing,
                format!("Provider {} 尚未保存 API Key", provider.as_str()),
                false,
            ));
        }
    };

    Ok(ProviderRuntimeConfig {
        provider,
        model,
        base_url: setting
            .base_url
            .unwrap_or_else(|| default_base_url(provider).to_string()),
        api_key,
    })
}

/// 构建流式请求
pub fn build_stream_request(
    client: &Client,
    config: &ProviderRuntimeConfig,
    prompt: &str,
) -> RequestBuilder {
    match config.provider {
        ProviderId::Openai => client
            .post(format!(
                "{}/chat/completions",
                config.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&config.api_key)
            .json(&json!({
                "model": config.model,
                "stream": true,
                "stream_options": { "include_usage": true },
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            })),
        ProviderId::Claude => client
            .post(format!(
                "{}/messages",
                config.base_url.trim_end_matches('/')
            ))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": config.model,
                "stream": true,
                "max_tokens": 2048,
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            })),
        ProviderId::Gemini => client
            .post(format!(
                "{}/models/{}:streamGenerateContent?alt=sse&key={}",
                config.base_url.trim_end_matches('/'),
                config.model,
                config.api_key
            ))
            .json(&json!({
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            { "text": prompt }
                        ]
                    }
                ]
            })),
    }
}

/// 构建连通性测试请求
pub fn build_test_request(client: &Client, config: &ProviderRuntimeConfig) -> RequestBuilder {
    match config.provider {
        ProviderId::Openai => client
            .post(format!(
                "{}/chat/completions",
                config.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&config.api_key)
            .json(&json!({
                "model": config.model,
                "stream": false,
                "messages": [
                    { "role": "user", "content": "ping" }
                ],
                "max_tokens": 8
            })),
        ProviderId::Claude => client
            .post(format!(
                "{}/messages",
                config.base_url.trim_end_matches('/')
            ))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": config.model,
                "max_tokens": 8,
                "messages": [
                    { "role": "user", "content": "ping" }
                ]
            })),
        ProviderId::Gemini => client
            .post(format!(
                "{}/models/{}:generateContent?key={}",
                config.base_url.trim_end_matches('/'),
                config.model,
                config.api_key
            ))
            .json(&json!({
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            { "text": "ping" }
                        ]
                    }
                ]
            })),
    }
}

/// 从 SSE JSON 里提取增量文本
pub fn extract_stream_delta(provider: ProviderId, payload: &Value) -> Option<String> {
    match provider {
        ProviderId::Openai => payload
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("delta"))
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        ProviderId::Claude => {
            if payload.get("type").and_then(Value::as_str) == Some("content_block_delta") {
                return payload
                    .get("delta")
                    .and_then(|delta| delta.get("text"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }

            None
        }
        ProviderId::Gemini => payload
            .get("candidates")
            .and_then(|candidates| candidates.get(0))
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(|parts| parts.get(0))
            .and_then(|part| part.get("text"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }
}

/// 执行连通性测试
pub async fn test_connection(
    ai: &AiIntegration,
    provider: ProviderId,
    model: Option<String>,
) -> Result<ProviderConnectivityResult, AppError> {
    let config = resolve_runtime_config(ai, Some(provider), model)?;
    let request = build_test_request(&ai.client, &config);
    let started = Instant::now();
    let response = request.send().await?;
    let latency_ms = started.elapsed().as_millis() as u64;

    if response.status().is_success() {
        return Ok(ProviderConnectivityResult {
            provider: config.provider,
            model: config.model,
            success: true,
            latency_ms: Some(latency_ms),
            error: None,
        });
    }

    Err(AppError::new(
        AppErrorCode::ProviderConnectionFailed,
        format!("Provider 测试失败: HTTP {}", response.status()),
        true,
    ))
}

/// 返回 Provider 默认 base URL
pub fn default_base_url(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Openai => "https://api.openai.com/v1",
        ProviderId::Claude => "https://api.anthropic.com/v1",
        ProviderId::Gemini => "https://generativelanguage.googleapis.com/v1beta",
    }
}
