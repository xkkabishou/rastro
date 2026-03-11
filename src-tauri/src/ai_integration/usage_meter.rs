// Usage 统计与费用估算
use serde_json::Value;

use crate::models::ProviderId;

/// 标准化 usage 快照
#[derive(Debug, Clone)]
pub struct UsageSnapshot {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
    pub currency: String,
}

impl UsageSnapshot {
    /// 使用文本长度做近似估算
    pub fn fallback(
        provider: ProviderId,
        model: &str,
        input_text: &str,
        output_text: &str,
    ) -> Self {
        let input_tokens = estimate_tokens(input_text);
        let output_tokens = estimate_tokens(output_text);
        let estimated_cost = estimate_cost(provider, model, input_tokens, output_tokens);

        Self {
            input_tokens,
            output_tokens,
            estimated_cost,
            currency: "USD".to_string(),
        }
    }
}

/// 尝试从 Provider 返回体中提取 usage 信息
pub fn extract_usage(provider: ProviderId, payload: &Value, model: &str) -> Option<UsageSnapshot> {
    match provider {
        ProviderId::Openai => {
            let usage = payload.get("usage")?;
            let input_tokens = usage.get("prompt_tokens")?.as_u64()?;
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .or_else(|| usage.get("output_tokens").and_then(Value::as_u64))
                .unwrap_or_default();

            Some(UsageSnapshot {
                input_tokens,
                output_tokens,
                estimated_cost: estimate_cost(provider, model, input_tokens, output_tokens),
                currency: "USD".to_string(),
            })
        }
        ProviderId::Claude => {
            let usage = payload.get("usage")?;
            let input_tokens = usage.get("input_tokens")?.as_u64()?;
            let output_tokens = usage.get("output_tokens")?.as_u64()?;

            Some(UsageSnapshot {
                input_tokens,
                output_tokens,
                estimated_cost: estimate_cost(provider, model, input_tokens, output_tokens),
                currency: "USD".to_string(),
            })
        }
        ProviderId::Gemini => {
            let usage = payload.get("usageMetadata")?;
            let input_tokens = usage
                .get("promptTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let output_tokens = usage
                .get("candidatesTokenCount")
                .and_then(Value::as_u64)
                .or_else(|| usage.get("totalTokenCount").and_then(Value::as_u64))
                .unwrap_or_default();

            Some(UsageSnapshot {
                input_tokens,
                output_tokens,
                estimated_cost: estimate_cost(provider, model, input_tokens, output_tokens),
                currency: "USD".to_string(),
            })
        }
    }
}

fn estimate_tokens(text: &str) -> u64 {
    let approx = (text.chars().count() as f64 / 4.0).ceil() as u64;
    approx.max(1)
}

fn estimate_cost(provider: ProviderId, _model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let (input_rate, output_rate) = match provider {
        ProviderId::Openai => (0.15, 0.60),
        ProviderId::Claude => (0.30, 1.50),
        ProviderId::Gemini => (0.10, 0.40),
    };

    ((input_tokens as f64 / 1_000_000.0) * input_rate)
        + ((output_tokens as f64 / 1_000_000.0) * output_rate)
}
