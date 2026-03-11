// B+C. Translation Engine 生命周期 + 翻译任务 Command (7 个)
// 对应 rust-backend-system.md Section 7.3 B + C
use serde::{Deserialize, Serialize};

/// 翻译引擎状态
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationEngineStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub engine_version: Option<String>,
    pub circuit_breaker_open: bool,
    pub last_health_check: Option<String>,
}

/// 翻译任务 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationJobDto {
    pub job_id: String,
    pub document_id: String,
    pub engine_job_id: Option<String>,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub provider: String,
    pub model: String,
    pub translated_pdf_path: Option<String>,
    pub bilingual_pdf_path: Option<String>,
    pub figure_report_path: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// 翻译请求输入
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTranslationInput {
    pub document_id: String,
    pub file_path: String,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub output_mode: Option<String>,
    pub figure_translation: Option<bool>,
    pub skip_reference_pages: Option<bool>,
    pub force_refresh: Option<bool>,
}

// --- B. Translation Engine 生命周期 (3 个) ---

/// 若未运行则启动引擎；force=true 可绕过熔断状态
#[tauri::command]
pub fn ensure_translation_engine(
    _expected_port: Option<u16>,
    _force: Option<bool>,
) -> Result<TranslationEngineStatus, crate::errors::AppError> {
    todo!()
}

/// 优雅关闭翻译引擎，必要时强杀
#[tauri::command]
pub fn shutdown_translation_engine(
    _force: Option<bool>,
) -> Result<TranslationEngineStatus, crate::errors::AppError> {
    todo!()
}

/// 仅查询引擎状态，不触发启动
#[tauri::command]
pub fn get_translation_engine_status() -> Result<TranslationEngineStatus, crate::errors::AppError> {
    todo!()
}

// --- C. 翻译任务 (4 个) ---

/// 提交翻译任务，命中缓存则直接返回完成态
#[tauri::command]
pub fn request_translation(
    _input: RequestTranslationInput,
) -> Result<TranslationJobDto, crate::errors::AppError> {
    todo!()
}

/// 获取单任务状态
#[tauri::command]
pub fn get_translation_job(
    _job_id: String,
) -> Result<TranslationJobDto, crate::errors::AppError> {
    todo!()
}

/// 取消排队或运行中的翻译任务
#[tauri::command]
pub fn cancel_translation(
    _job_id: String,
) -> Result<CancelTranslationResult, crate::errors::AppError> {
    todo!()
}

/// 取消翻译结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTranslationResult {
    pub job_id: String,
    pub cancelled: bool,
}

/// 前端重新打开文档时快速恢复缓存
#[tauri::command]
pub fn load_cached_translation(
    _document_id: String,
    _provider: Option<String>,
    _model: Option<String>,
) -> Result<Option<TranslationJobDto>, crate::errors::AppError> {
    todo!()
}
