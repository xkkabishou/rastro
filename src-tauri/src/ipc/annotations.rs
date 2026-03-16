// 标注 IPC Commands
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::{
    app_state::AppState,
    errors::{AppError, AppErrorCode},
    models::AnnotationRect,
    storage::annotations,
};

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDto {
    pub annotation_id: String,
    pub document_id: String,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub color: String,
    pub page_number: i64,
    pub text: String,
    pub note_content: Option<String>,
    pub rects: Vec<AnnotationRect>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAnnotationInput {
    pub document_id: String,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub color: String,
    pub page_number: i64,
    pub text: String,
    pub note_content: Option<String>,
    pub rects: Vec<AnnotationRect>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnnotationInput {
    pub annotation_id: String,
    pub color: Option<String>,
    pub note_content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAnnotationResult {
    pub deleted: bool,
}

// ---------------------------------------------------------------------------
// Record → DTO 转换
// ---------------------------------------------------------------------------

fn record_to_dto(record: annotations::AnnotationRecord) -> Result<AnnotationDto, AppError> {
    let rects: Vec<AnnotationRect> =
        serde_json::from_str(&record.rects_json).map_err(|e| {
            AppError::internal(format!("标注矩形 JSON 反序列化失败: {e}"))
        })?;

    Ok(AnnotationDto {
        annotation_id: record.annotation_id,
        document_id: record.document_id,
        annotation_type: record.annotation_type,
        color: record.color,
        page_number: record.page_number,
        text: record.selected_text,
        note_content: record.note_content,
        rects,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_annotation(
    state: tauri::State<'_, AppState>,
    input: SaveAnnotationInput,
) -> Result<AnnotationDto, AppError> {
    let rects_json = serde_json::to_string(&input.rects)
        .map_err(|e| AppError::internal(format!("标注矩形序列化失败: {e}")))?;

    let conn = state.storage.connection();
    let record = annotations::create(
        &conn,
        &annotations::CreateAnnotationParams {
            document_id: input.document_id,
            annotation_type: input.annotation_type,
            color: input.color,
            page_number: input.page_number,
            selected_text: input.text,
            note_content: input.note_content,
            rects_json,
        },
    )?;

    record_to_dto(record)
}

#[tauri::command]
pub fn update_annotation(
    state: tauri::State<'_, AppState>,
    input: UpdateAnnotationInput,
) -> Result<AnnotationDto, AppError> {
    let conn = state.storage.connection();
    let record = annotations::update(
        &conn,
        &annotations::UpdateAnnotationParams {
            annotation_id: input.annotation_id.clone(),
            color: input.color,
            note_content: input.note_content,
        },
    )?;

    match record {
        Some(r) => record_to_dto(r),
        None => Err(AppError::new(
            AppErrorCode::AnnotationNotFound,
            format!("标注不存在: {}", input.annotation_id),
            false,
        )),
    }
}

#[tauri::command]
pub fn delete_annotation(
    state: tauri::State<'_, AppState>,
    annotation_id: String,
) -> Result<DeleteAnnotationResult, AppError> {
    let conn = state.storage.connection();
    let deleted = annotations::delete(&conn, &annotation_id)?;
    Ok(DeleteAnnotationResult { deleted })
}

#[tauri::command]
pub fn list_annotations(
    state: tauri::State<'_, AppState>,
    document_id: String,
) -> Result<Vec<AnnotationDto>, AppError> {
    let conn = state.storage.connection();
    let records = annotations::list_by_document(&conn, &document_id)?;
    records.into_iter().map(record_to_dto).collect()
}

#[tauri::command]
pub fn list_annotations_by_page(
    state: tauri::State<'_, AppState>,
    document_id: String,
    page_number: i64,
) -> Result<Vec<AnnotationDto>, AppError> {
    let conn = state.storage.connection();
    let records = annotations::list_by_document_and_page(&conn, &document_id, page_number)?;
    records.into_iter().map(record_to_dto).collect()
}
