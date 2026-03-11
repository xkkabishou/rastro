// G. Zotero 集成 Command (3 个)
// 对应 rust-backend-system.md Section 7.3 G
use serde::Serialize;

use super::document::DocumentSnapshot;

/// Zotero 状态
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroStatusDto {
    pub detected: bool,
    pub database_path: Option<String>,
    pub item_count: Option<u32>,
    pub status_message: String,
}

/// 分页 Zotero 文献列表
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedZoteroItemsDto {
    pub items: Vec<ZoteroItemDto>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

/// Zotero 文献条目
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroItemDto {
    pub item_key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u32>,
    pub publication_title: Option<String>,
    pub pdf_path: Option<String>,
    pub date_added: String,
}

/// 自动发现 Zotero profile 与 DB
#[tauri::command]
pub fn detect_zotero_library() -> Result<ZoteroStatusDto, crate::errors::AppError> {
    todo!()
}

/// 返回文献条目和附件摘要（分页）
#[tauri::command]
pub fn fetch_zotero_items(
    _query: Option<String>,
    _offset: Option<u32>,
    _limit: Option<u32>,
) -> Result<PagedZoteroItemsDto, crate::errors::AppError> {
    todo!()
}

/// 解析对应 PDF 路径后复用 open_document 逻辑
#[tauri::command]
pub fn open_zotero_attachment(
    _item_key: String,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    todo!()
}
