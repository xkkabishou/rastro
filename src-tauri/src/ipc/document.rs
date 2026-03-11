// A. 文档与应用状态 Command (4 个)
// 对应 rust-backend-system.md Section 7.3 A
use serde::Serialize;

/// 后端健康状态
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendHealth {
    pub database: bool,
    pub keychain: bool,
    pub translation_engine_running: bool,
    pub zotero_detected: bool,
    pub version: String,
}

/// 文档快照
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub document_id: String,
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: String,
    pub zotero_item_key: Option<String>,
    pub cached_translation: Option<CachedTranslationInfo>,
    pub last_opened_at: String,
}

/// 缓存翻译信息
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTranslationInfo {
    pub available: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub translated_pdf_path: Option<String>,
    pub bilingual_pdf_path: Option<String>,
    pub updated_at: Option<String>,
}

/// 返回 DB、Keychain、Engine、Zotero 探测状态
#[tauri::command]
pub fn get_backend_health() -> Result<BackendHealth, crate::errors::AppError> {
    todo!()
}

/// 计算文件哈希、读取元数据、建立/更新 documents 记录
#[tauri::command]
pub fn open_document(
    _file_path: String,
    _source_type: Option<String>,
    _zotero_item_key: Option<String>,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    todo!()
}

/// 最近打开文档列表
#[tauri::command]
pub fn list_recent_documents(
    _limit: Option<u32>,
) -> Result<Vec<DocumentSnapshot>, crate::errors::AppError> {
    todo!()
}

/// 返回单文档快照，包括缓存可用性
#[tauri::command]
pub fn get_document_snapshot(
    _document_id: String,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    todo!()
}
