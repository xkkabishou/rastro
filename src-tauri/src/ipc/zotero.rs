// G. Zotero 集成 Command (5 个)
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

/// Zotero 文件夹（collection）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroCollectionDto {
    pub collection_id: i64,
    pub key: String,
    pub name: String,
    pub parent_collection_id: Option<i64>,
    pub item_count: u32,
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

    Ok(items_page_to_dto(page))
}

/// 获取 Zotero 所有 collections（文件夹树）
#[tauri::command]
pub fn fetch_zotero_collections() -> Result<Vec<ZoteroCollectionDto>, crate::errors::AppError> {
    let connector = ZoteroConnector::detect()?;
    let collections = connector.fetch_collections()?;

    Ok(collections
        .into_iter()
        .map(|c| ZoteroCollectionDto {
            collection_id: c.collection_id,
            key: c.key,
            name: c.name,
            parent_collection_id: c.parent_collection_id,
            item_count: c.item_count,
        })
        .collect())
}

/// 获取指定 collection 下的文献列表（分页）
/// collection_id 为 None 时返回未分类文献
#[tauri::command]
pub fn fetch_zotero_collection_items(
    collection_id: Option<i64>,
    query: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<PagedZoteroItemsDto, crate::errors::AppError> {
    let connector = ZoteroConnector::detect()?;
    let page = connector.fetch_items_in_collection(
        collection_id,
        query.as_deref(),
        offset.unwrap_or(0),
        limit.unwrap_or(DEFAULT_PAGE_LIMIT),
    )?;

    Ok(items_page_to_dto(page))
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
        attachment.title,
    )
}

/// 辅助：将内部 ZoteroItemsPage 转为 DTO
fn items_page_to_dto(page: crate::zotero_connector::ZoteroItemsPage) -> PagedZoteroItemsDto {
    PagedZoteroItemsDto {
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
    }
}


#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::json;
    use tauri::{
        ipc::CallbackFn,
        test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
        webview::InvokeRequest,
        WebviewWindowBuilder,
    };

    use super::fetch_zotero_items;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn fetch_zotero_items_command_serializes_zotero_not_found_errors() {
        let _guard = ENV_LOCK.lock().unwrap();
        let previous_db = std::env::var_os("RASTRO_ZOTERO_DB_PATH");
        let previous_profile = std::env::var_os("RASTRO_ZOTERO_PROFILE_DIR");
        let previous_home = std::env::var_os("HOME");
        let isolated_home = temp_path("ipc-zotero-empty-home");
        std::env::set_var(
            "RASTRO_ZOTERO_DB_PATH",
            temp_path("ipc-zotero-missing").join("missing.sqlite"),
        );
        std::env::remove_var("RASTRO_ZOTERO_PROFILE_DIR");
        std::env::set_var("HOME", &isolated_home);

        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![fetch_zotero_items])
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let error = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "fetch_zotero_items".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: json!({}).into(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect_err("missing zotero database should surface as invoke error");

        restore_env("RASTRO_ZOTERO_DB_PATH", previous_db);
        restore_env("RASTRO_ZOTERO_PROFILE_DIR", previous_profile);
        restore_env("HOME", previous_home);
        assert_eq!(error["code"], "ZOTERO_NOT_FOUND");
        assert_eq!(error["retryable"], false);
    }

    fn temp_path(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{unique}"))
    }

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        if let Some(value) = value {
            std::env::set_var(key, value);
        } else {
            std::env::remove_var(key);
        }
    }
}
