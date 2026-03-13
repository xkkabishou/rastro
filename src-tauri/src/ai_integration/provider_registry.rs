// Provider 配置解析与请求适配
use std::{str::FromStr, time::Instant};

use reqwest::{Client, RequestBuilder, StatusCode, Url};
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
            .map(|value| normalize_base_url(provider, &value))
            .unwrap_or_else(|| default_base_url(provider).to_string()),
        api_key,
    })
}

pub fn normalize_base_url(provider: ProviderId, base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    let Ok(mut url) = Url::parse(trimmed) else {
        return trimmed.to_string();
    };

    let normalized_path = url.path().trim_end_matches('/');
    if normalized_path.is_empty() {
        match provider {
            ProviderId::Openai | ProviderId::Claude => url.set_path("/v1"),
            ProviderId::Gemini => url.set_path("/v1beta"),
        }
    }

    url.to_string().trim_end_matches('/').to_string()
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
        ProviderId::Claude => {
            let mut payload = json!({
                "model": config.model,
                "stream": true,
                "max_tokens": 2048,
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            });

            if supports_claude_extended_thinking(&config.model) {
                payload["thinking"] = json!({
                    "type": "enabled",
                    "budget_tokens": 1024
                });
            }

            client
                .post(format!(
                    "{}/messages",
                    config.base_url.trim_end_matches('/')
                ))
                .header("x-api-key", &config.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&payload)
        }
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

fn extract_text_content(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        Value::Array(parts) => {
            let fragments: Vec<String> = parts
                .iter()
                .filter_map(extract_text_content)
                .filter(|fragment| !fragment.is_empty())
                .collect();

            if fragments.is_empty() {
                None
            } else {
                Some(fragments.join(""))
            }
        }
        Value::Object(map) => map
            .get("text")
            .and_then(extract_text_content)
            .or_else(|| map.get("value").and_then(extract_text_content))
            .or_else(|| map.get("parts").and_then(extract_text_content))
            .or_else(|| map.get("content").and_then(extract_text_content)),
        _ => None,
    }
}

fn extract_openai_compatible_delta(payload: &Value) -> Option<String> {
    let choice = payload.get("choices").and_then(|choices| choices.get(0))?;

    choice
        .get("delta")
        .and_then(|delta| delta.get("content"))
        .and_then(extract_text_content)
        .or_else(|| {
            choice
                .get("delta")
                .and_then(|delta| delta.get("text"))
                .and_then(extract_text_content)
        })
        .or_else(|| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(extract_text_content)
        })
        .or_else(|| choice.get("text").and_then(extract_text_content))
}

fn extract_claude_delta(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) == Some("content_block_delta") {
        return payload
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(extract_text_content);
    }

    None
}

fn extract_claude_thinking(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) == Some("content_block_delta") {
        return payload
            .get("delta")
            .and_then(|delta| delta.get("thinking"))
            .and_then(extract_text_content);
    }

    None
}

fn extract_gemini_delta(payload: &Value) -> Option<String> {
    payload
        .get("candidates")
        .and_then(|candidates| candidates.get(0))
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(extract_text_content)
}

/// 从 SSE JSON 里提取增量文本
pub fn extract_stream_delta(provider: ProviderId, payload: &Value) -> Option<String> {
    match provider {
        ProviderId::Openai => extract_openai_compatible_delta(payload)
            .or_else(|| extract_claude_delta(payload))
            .or_else(|| extract_gemini_delta(payload)),
        ProviderId::Claude => extract_claude_delta(payload)
            .or_else(|| extract_openai_compatible_delta(payload))
            .or_else(|| extract_gemini_delta(payload)),
        ProviderId::Gemini => extract_gemini_delta(payload)
            .or_else(|| extract_openai_compatible_delta(payload))
            .or_else(|| extract_claude_delta(payload)),
    }
}

/// 从 SSE JSON 里提取思考增量文本
pub fn extract_stream_thinking(provider: ProviderId, payload: &Value) -> Option<String> {
    match provider {
        ProviderId::Claude => extract_claude_thinking(payload),
        ProviderId::Openai | ProviderId::Gemini => None,
    }
}

fn supports_claude_extended_thinking(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();

    normalized.contains("claude-3-7")
        || normalized.contains("claude-3.7")
        || normalized.contains("sonnet-4")
        || normalized.contains("opus-4")
        || normalized.contains("haiku-4")
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

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(map_provider_http_error(
        status,
        &body,
        "Provider 测试失败",
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

pub(crate) fn map_provider_http_error(
    status: StatusCode,
    response_body: &str,
    context: &str,
) -> AppError {
    let normalized = response_body.to_ascii_lowercase();
    let code = if status == StatusCode::TOO_MANY_REQUESTS
        || normalized.contains("rate limit")
        || normalized.contains("too many requests")
    {
        AppErrorCode::ProviderRateLimited
    } else if status == StatusCode::PAYMENT_REQUIRED
        || normalized.contains("insufficient_quota")
        || normalized.contains("insufficient credit")
        || normalized.contains("insufficient funds")
        || normalized.contains("quota exceeded")
        || normalized.contains("billing")
    {
        AppErrorCode::ProviderInsufficientCredit
    } else {
        AppErrorCode::ProviderConnectionFailed
    };

    let trimmed_body = response_body.trim();
    let message = if trimmed_body.is_empty() {
        format!("{context}: HTTP {status}")
    } else {
        format!("{context}: HTTP {status} - {trimmed_body}")
    };

    let mut error = AppError::new(
        code,
        message,
        matches!(
            code,
            AppErrorCode::ProviderRateLimited | AppErrorCode::ProviderConnectionFailed
        ),
    )
    .with_detail("status", status.as_u16());

    if !trimmed_body.is_empty() {
        error = error.with_detail("responseBody", trimmed_body.to_string());
    }

    error
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use reqwest::StatusCode;

    use crate::{
        ai_integration::provider_registry::{
            extract_stream_delta, extract_stream_thinking, map_provider_http_error,
            normalize_base_url,
        },
        errors::AppErrorCode,
        models::ProviderId,
    };

    #[test]
    fn maps_rate_limit_responses_to_provider_rate_limited() {
        let error = map_provider_http_error(
            StatusCode::TOO_MANY_REQUESTS,
            r#"{"error":"rate limit exceeded"}"#,
            "Provider 测试失败",
        );

        assert_eq!(error.code, AppErrorCode::ProviderRateLimited);
        assert!(error.retryable);
        assert_eq!(
            error.details.as_ref().unwrap()["status"],
            serde_json::json!(429)
        );
    }

    #[test]
    fn maps_payment_failures_to_provider_insufficient_credit() {
        let error = map_provider_http_error(
            StatusCode::PAYMENT_REQUIRED,
            r#"{"error":"insufficient_quota"}"#,
            "流式请求失败",
        );

        assert_eq!(error.code, AppErrorCode::ProviderInsufficientCredit);
        assert!(!error.retryable);
        assert!(error.message.contains("insufficient_quota"));
    }

    #[test]
    fn falls_back_to_provider_connection_failed_for_other_statuses() {
        let error = map_provider_http_error(
            StatusCode::BAD_GATEWAY,
            "",
            "Provider 测试失败",
        );

        assert_eq!(error.code, AppErrorCode::ProviderConnectionFailed);
        assert!(error.retryable);
        assert_eq!(error.details.as_ref().unwrap()["status"], 502);
    }

    #[test]
    fn extract_stream_delta_supports_openai_content_arrays() {
        let payload = json!({
            "choices": [
                {
                    "delta": {
                        "content": [
                            { "type": "text", "text": "你好" },
                            { "type": "text", "text": "，世界" }
                        ]
                    }
                }
            ]
        });

        assert_eq!(
            extract_stream_delta(ProviderId::Openai, &payload).as_deref(),
            Some("你好，世界")
        );
    }

    #[test]
    fn extract_stream_delta_uses_cross_provider_fallbacks_for_compatible_gateways() {
        let payload = json!({
            "type": "content_block_delta",
            "delta": {
                "text": "兼容返回"
            }
        });

        assert_eq!(
            extract_stream_delta(ProviderId::Openai, &payload).as_deref(),
            Some("兼容返回")
        );
    }

    #[test]
    fn extract_stream_thinking_reads_claude_thinking_delta() {
        let payload = json!({
            "type": "content_block_delta",
            "delta": {
                "thinking": "先确认上下文"
            }
        });

        assert_eq!(
            extract_stream_thinking(ProviderId::Claude, &payload).as_deref(),
            Some("先确认上下文")
        );
    }

    #[test]
    fn normalize_base_url_appends_default_version_prefix_for_root_urls() {
        assert_eq!(
            normalize_base_url(ProviderId::Claude, "https://sub2api.chiikawa.org"),
            "https://sub2api.chiikawa.org/v1"
        );
        assert_eq!(
            normalize_base_url(ProviderId::Gemini, "https://generativelanguage.googleapis.com"),
            "https://generativelanguage.googleapis.com/v1beta"
        );
    }
}
