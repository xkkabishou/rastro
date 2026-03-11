// E+F. Provider 配置与凭据 + 使用统计 Command (6 个)
// 对应 rust-backend-system.md Section 7.3 E + F
use serde::Serialize;

/// Provider 配置 DTO（脱敏）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigDto {
    pub provider: String,
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
    pub provider: String,
    pub model: String,
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// 删除 Key 结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProviderKeyResult {
    pub provider: String,
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
    pub provider: String,
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
pub fn list_provider_configs() -> Result<Vec<ProviderConfigDto>, crate::errors::AppError> {
    todo!()
}

/// Key 写入 Keychain，DB 只存非敏感字段
#[tauri::command]
pub fn save_provider_key(
    _provider: String,
    _api_key: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    todo!()
}

/// 删除 Keychain 中的 Key
#[tauri::command]
pub fn remove_provider_key(
    _provider: String,
) -> Result<RemoveProviderKeyResult, crate::errors::AppError> {
    todo!()
}

/// 修改当前生效 Provider 与模型
#[tauri::command]
pub fn set_active_provider(
    _provider: String,
    _model: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    todo!()
}

/// 实际发送测试请求验证连接
#[tauri::command]
pub fn test_provider_connection(
    _provider: String,
    _model: Option<String>,
) -> Result<ProviderConnectivityDto, crate::errors::AppError> {
    todo!()
}

// --- F. 使用统计 (1 个) ---

/// 汇总问答、总结、翻译消耗
#[tauri::command]
pub fn get_usage_stats(
    _from: Option<String>,
    _to: Option<String>,
    _provider: Option<String>,
) -> Result<UsageStatsDto, crate::errors::AppError> {
    todo!()
}
