// 精读模式 IPC 命令
use serde::Serialize;
use tauri::State;

use crate::{app_state::AppState, errors::AppError, storage::documents};

/// 精读状态返回值
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepReadStatus {
    pub enabled: bool,
    pub char_count: Option<u32>,
}

/// 保存精读全文
#[tauri::command]
pub fn save_deep_read_text(
    state: State<'_, AppState>,
    document_id: String,
    text: String,
) -> Result<DeepReadStatus, AppError> {
    let char_count = text.chars().count() as u32;
    let connection = state.storage.connection();
    documents::save_deep_read_text(&connection, &document_id, &text)?;
    Ok(DeepReadStatus {
        enabled: true,
        char_count: Some(char_count),
    })
}

/// 清除精读文本
#[tauri::command]
pub fn clear_deep_read_text(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeepReadStatus, AppError> {
    let connection = state.storage.connection();
    documents::clear_deep_read_text(&connection, &document_id)?;
    Ok(DeepReadStatus {
        enabled: false,
        char_count: None,
    })
}

/// 查询精读状态
#[tauri::command]
pub fn get_deep_read_status(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeepReadStatus, AppError> {
    let connection = state.storage.connection();
    let text = documents::get_deep_read_text(&connection, &document_id)?;
    Ok(DeepReadStatus {
        enabled: text.is_some(),
        char_count: text.as_ref().map(|t| t.chars().count() as u32),
    })
}
