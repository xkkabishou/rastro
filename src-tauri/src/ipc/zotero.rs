// G. Zotero 集成 Command (3 个)
// 对应 rust-backend-system.md Section 7.3 G
use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    errors::AppErrorCode,
    models::DocumentSourceType,
    zotero_connector::{ZoteroConnector, DEFAULT_PAGE_LIMIT},
};

use super::document::{self, DocumentSnapshot};

/// Zotero 状态
#[derive(Debug, Serialize, Clone)]
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
pub fn detect_zotero_library(
    state: State<'_, AppState>,
) -> Result<ZoteroStatusDto, crate::errors::AppError> {
    let status = match ZoteroConnector::detect() {
        Ok(connector) => ZoteroStatusDto {
            detected: true,
            database_path: Some(connector.database_path().to_string_lossy().into_owned()),
            item_count: Some(connector.item_count()?),
            status_message: "已检测到 Zotero 本地数据库".to_string(),
        },
        Err(error) if error.code == AppErrorCode::ZoteroNotFound => ZoteroStatusDto {
            detected: false,
            database_path: None,
            item_count: None,
            status_message: error.message,
        },
        Err(error) => return Err(error),
    };

    *state.zotero_status.lock() = status.clone();
    Ok(status)
}

/// 返回文献条目和附件摘要（分页）
#[tauri::command]
pub fn fetch_zotero_items(
    query: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<PagedZoteroItemsDto, crate::errors::AppError> {
    let connector = ZoteroConnector::detect()?;
    let page = connector.fetch_items(
        query.as_deref(),
        offset.unwrap_or(0),
        limit.unwrap_or(DEFAULT_PAGE_LIMIT),
    )?;

    Ok(PagedZoteroItemsDto {
        items: page
            .items
            .into_iter()
            .map(|item| ZoteroItemDto {
                item_key: item.item_key,
                title: item.title,
                authors: item.authors,
                year: item.year,
                publication_title: item.publication_title,
                pdf_path: item.pdf_path,
                date_added: item.date_added,
            })
            .collect(),
        total: page.total,
        offset: page.offset,
        limit: page.limit,
    })
}

/// 解析对应 PDF 路径后复用 open_document 逻辑
#[tauri::command]
pub fn open_zotero_attachment(
    state: State<'_, AppState>,
    item_key: String,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    let connector = ZoteroConnector::detect()?;
    let attachment = connector.resolve_attachment(&item_key)?;

    document::open_document(
        state,
        attachment.file_path.to_string_lossy().into_owned(),
        Some(DocumentSourceType::Zotero.as_str().to_string()),
        Some(attachment.parent_item_key),
    )
}
