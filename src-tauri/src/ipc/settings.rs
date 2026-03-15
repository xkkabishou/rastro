// E+F. Provider 配置与凭据 + 使用统计 Command (6 个)
// 对应 rust-backend-system.md Section 7.3 E + F
use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    models::ProviderId,
    storage::{provider_settings, usage_events},
};

/// Provider 配置 DTO（脱敏）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigDto {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: Option<String>,
    pub is_active: bool,
    pub masked_key: Option<String>,
    pub last_test_status: Option<String>,
    pub last_tested_at: Option<String>,
}

/// Provider 连接测试结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectivityDto {
    pub provider: ProviderId,
    pub model: String,
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// 删除 Key 结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProviderKeyResult {
    pub provider: ProviderId,
    pub removed: bool,
}

/// 使用统计 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatsDto {
    pub by_provider: Vec<ProviderUsageDto>,
    pub total: UsageTotalDto,
}

/// 单 Provider 使用统计
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageDto {
    pub provider: ProviderId,
    pub model: String,
    pub by_feature: Vec<FeatureUsageDto>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
}

/// 单功能维度使用统计
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureUsageDto {
    pub feature: String,
    pub count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
}

/// 使用统计汇总
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotalDto {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
    pub currency: String,
}

// --- E. Provider 配置与凭据 (5 个) ---

/// 返回脱敏配置与当前激活状态
#[tauri::command]
pub fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigDto>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        provider_settings::list_all(&connection)?
    };

    records
        .into_iter()
        .map(|record| build_provider_config_dto(&state, record))
        .collect()
}

/// Key 写入 Keychain，DB 只存非敏感字段
#[tauri::command]
pub fn save_provider_key(
    state: State<'_, AppState>,
    provider: ProviderId,
    api_key: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    state.keychain.save_key(provider.as_str(), &api_key)?;

    let record = {
        let connection = state.storage.connection();
        provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderNotConfigured,
            "Provider 配置不存在",
            false,
        )
    })?;

    build_provider_config_dto(&state, record)
}

/// 删除 Keychain 中的 Key
#[tauri::command]
pub fn remove_provider_key(
    state: State<'_, AppState>,
    provider: ProviderId,
) -> Result<RemoveProviderKeyResult, crate::errors::AppError> {
    let removed = state.keychain.delete_key(provider.as_str())?;
    Ok(RemoveProviderKeyResult { provider, removed })
}

/// 修改当前生效 Provider 与模型
#[tauri::command]
pub fn set_active_provider(
    state: State<'_, AppState>,
    provider: ProviderId,
    model: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    let record = {
        let mut connection = state.storage.connection();
        provider_settings::set_active(&mut connection, provider.as_str(), &model)?
    };

    build_provider_config_dto(&state, record)
}

/// 实际发送测试请求验证连接
#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    provider: ProviderId,
    model: Option<String>,
) -> Result<ProviderConnectivityDto, crate::errors::AppError> {
    let result = state.ai_integration.test_connection(provider, model).await;
    let tested_at = chrono::Utc::now().to_rfc3339();

    {
        let connection = state.storage.connection();
        match &result {
            Ok(_) => provider_settings::update_test_status(
                &connection,
                provider.as_str(),
                Some("ok"),
                Some(&tested_at),
            )?,
            Err(error) => provider_settings::update_test_status(
                &connection,
                provider.as_str(),
                Some(&error.message),
                Some(&tested_at),
            )?,
        }
    }

    let result = result?;
    Ok(ProviderConnectivityDto {
        provider: result.provider,
        model: result.model,
        success: result.success,
        latency_ms: result.latency_ms,
        error: result.error,
    })
}

/// 更新 Provider 配置（base_url、model）
#[tauri::command]
pub fn update_provider_config(
    state: State<'_, AppState>,
    provider: ProviderId,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    let normalized_base_url = base_url
        .as_deref()
        .map(|value| crate::ai_integration::provider_registry::normalize_base_url(provider, value));

    // 写入前校验 base_url 安全性
    if let Some(ref url) = normalized_base_url {
        crate::ai_integration::provider_registry::validate_base_url(url)?;
    }

    let record = {
        let connection = state.storage.connection();
        provider_settings::update_config(
            &connection,
            provider.as_str(),
            normalized_base_url.as_deref(),
            model.as_deref(),
        )?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            "未找到对应 Provider 配置",
            false,
        )
    })?;

    build_provider_config_dto(&state, record)
}

/// 可用模型列表项
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: Option<String>,
}

/// 拉取模型列表结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchModelsResult {
    pub provider: ProviderId,
    pub models: Vec<ModelInfo>,
}

/// 通过 /v1/models 拉取可用模型列表
#[tauri::command]
pub async fn fetch_available_models(
    state: State<'_, AppState>,
    provider: ProviderId,
) -> Result<FetchModelsResult, crate::errors::AppError> {
    // 读取 provider 配置获取 base_url 和 key
    let record = {
        let connection = state.storage.connection();
        provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            "未找到对应 Provider 配置",
            false,
        )
    })?;

    let api_key = state.keychain.get_key(provider.as_str())?.ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderKeyMissing,
            "请先配置 API Key",
            false,
        )
    })?;

    let has_custom_base_url = record.base_url.is_some();
    let base_url = record
        .base_url
        .map(|value| crate::ai_integration::provider_registry::normalize_base_url(provider, &value))
        .unwrap_or_else(|| {
            crate::ai_integration::provider_registry::default_base_url(provider).to_string()
        });

    // 读取后校验（防止历史脏数据泄露 Key）
    if has_custom_base_url {
        crate::ai_integration::provider_registry::validate_base_url(&base_url)?;
    }

    let base_url = base_url.trim_end_matches('/');

    // 构建 models 请求（base_url 已包含版本前缀如 /v1 或 /v1beta）
    let url = format!("{}/models", base_url);

    let client = reqwest::Client::new();
    let mut request_builder = client.get(&url);

    // 设置认证头
    match provider {
        ProviderId::Openai | ProviderId::Claude => {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", api_key));
            if provider == ProviderId::Claude {
                request_builder = request_builder.header("x-api-key", &api_key);
                request_builder = request_builder.header("anthropic-version", "2023-06-01");
            }
        }
        ProviderId::Gemini => {
            // Gemini 使用 query param
            request_builder = request_builder.query(&[("key", &api_key)]);
        }
    }

    let response = request_builder
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| {
            crate::errors::AppError::new(
                crate::errors::AppErrorCode::ProviderConnectionFailed,
                format!("拉取模型列表失败: {}", err),
                true,
            )
        })?;

    // W3: HTTP 状态码检查
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(
            crate::ai_integration::provider_registry::map_provider_http_error(
                status,
                &error_body,
                "拉取模型列表失败",
            ),
        );
    }

    let body: serde_json::Value = response.json().await.map_err(|err| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderConnectionFailed,
            format!("解析模型列表响应失败: {}", err),
            true,
        )
    })?;

    // 解析不同 Provider 的响应格式
    let models = match provider {
        ProviderId::Openai => {
            // OpenAI 格式: { "data": [{ "id": "gpt-4o", ... }] }
            body["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["id"].as_str().map(|id| ModelInfo {
                        id: id.to_string(),
                        name: m["id"].as_str().map(String::from),
                    })
                })
                .collect()
        }
        ProviderId::Claude => {
            // Claude 格式: { "data": [{ "id": "claude-sonnet-4-20250514", "display_name": "..." }] }
            body["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["id"].as_str().map(|id| ModelInfo {
                        id: id.to_string(),
                        name: m["display_name"].as_str().map(String::from),
                    })
                })
                .collect()
        }
        ProviderId::Gemini => {
            // Gemini 格式: { "models": [{ "name": "models/gemini-2.5-pro", "displayName": "..." }] }
            body["models"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["name"].as_str().map(|name| {
                        let id = name.strip_prefix("models/").unwrap_or(name);
                        ModelInfo {
                            id: id.to_string(),
                            name: m["displayName"].as_str().map(String::from),
                        }
                    })
                })
                .collect()
        }
    };

    Ok(FetchModelsResult { provider, models })
}

// --- F. 使用统计 (1 个) ---

/// 汇总问答、总结、翻译消耗
#[tauri::command]
pub fn get_usage_stats(
    state: State<'_, AppState>,
    from: Option<String>,
    to: Option<String>,
    provider: Option<ProviderId>,
) -> Result<UsageStatsDto, crate::errors::AppError> {
    let events = {
        let connection = state.storage.connection();
        usage_events::list_filtered(
            &connection,
            from.as_deref(),
            to.as_deref(),
            provider.as_ref().map(|p| p.as_str()),
        )?
    };

    let mut by_provider: Vec<ProviderUsageDto> = Vec::new();
    let mut total_input = 0;
    let mut total_output = 0;
    let mut total_cost = 0.0;

    for event in events {
        total_input += event.input_tokens;
        total_output += event.output_tokens;
        total_cost += event.estimated_cost;

        let provider_id = event.provider.parse()?;
        let position = by_provider
            .iter()
            .position(|entry| entry.provider == provider_id && entry.model == event.model);

        let entry = if let Some(position) = position {
            &mut by_provider[position]
        } else {
            by_provider.push(ProviderUsageDto {
                provider: provider_id,
                model: event.model.clone(),
                by_feature: Vec::new(),
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0.0,
            });
            by_provider.last_mut().unwrap_or_else(|| unreachable!())
        };

        entry.input_tokens += event.input_tokens;
        entry.output_tokens += event.output_tokens;
        entry.estimated_cost += event.estimated_cost;

        let feature_position = entry
            .by_feature
            .iter()
            .position(|feature| feature.feature == event.feature);
        let feature = if let Some(position) = feature_position {
            &mut entry.by_feature[position]
        } else {
            entry.by_feature.push(FeatureUsageDto {
                feature: event.feature.clone(),
                count: 0,
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0.0,
            });
            entry
                .by_feature
                .last_mut()
                .unwrap_or_else(|| unreachable!())
        };

        feature.count += 1;
        feature.input_tokens += event.input_tokens;
        feature.output_tokens += event.output_tokens;
        feature.estimated_cost += event.estimated_cost;
    }

    Ok(UsageStatsDto {
        by_provider,
        total: UsageTotalDto {
            input_tokens: total_input,
            output_tokens: total_output,
            estimated_cost: total_cost,
            currency: "USD".to_string(),
        },
    })
}

fn build_provider_config_dto(
    state: &State<'_, AppState>,
    record: provider_settings::ProviderSettingRecord,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    let raw_key = state.keychain.get_key(&record.provider)?;
    Ok(ProviderConfigDto {
        provider: record.provider.parse()?,
        model: record.model,
        base_url: record.base_url,
        is_active: record.is_active,
        masked_key: raw_key.as_ref().map(|value| state.keychain.mask_key(value)),
        last_test_status: record.last_test_status,
        last_tested_at: record.last_tested_at,
    })
}
