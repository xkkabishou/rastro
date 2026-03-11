// A. 文档与应用状态 Command (4 个)
// 对应 rust-backend-system.md Section 7.3 A
use std::{path::Path, str::FromStr};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{
    app_state::AppState,
    errors::{AppError, AppErrorCode},
    models::{DocumentSourceType, ProviderId},
    storage::{documents, translation_artifacts, translation_jobs},
};

use super::{translation::TranslationEngineStatus, zotero::ZoteroStatusDto};

/// 后端健康状态
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendHealth {
    pub database: bool,
    pub keychain: bool,
    pub translation_engine: TranslationEngineStatus,
    pub zotero: ZoteroStatusDto,
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
    pub source_type: DocumentSourceType,
    pub zotero_item_key: Option<String>,
    pub cached_translation: Option<CachedTranslationInfo>,
    pub last_opened_at: String,
}

/// 缓存翻译信息
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTranslationInfo {
    pub available: bool,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub translated_pdf_path: Option<String>,
    pub bilingual_pdf_path: Option<String>,
    pub updated_at: Option<String>,
}

/// 返回 DB、Keychain、Engine、Zotero 探测状态
#[tauri::command]
pub fn get_backend_health(
    state: State<'_, AppState>,
) -> Result<BackendHealth, crate::errors::AppError> {
    Ok(BackendHealth {
        database: state.storage.healthcheck(),
        keychain: state.keychain.is_available(),
        translation_engine: state.translation_status.lock().clone(),
        zotero: state.zotero_status.lock().clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// 计算文件哈希、读取元数据、建立/更新 documents 记录
#[tauri::command]
pub fn open_document(
    state: State<'_, AppState>,
    file_path: String,
    source_type: Option<String>,
    zotero_item_key: Option<String>,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    let path = Path::new(&file_path);
    if !path.is_absolute() || !path.exists() {
        return Err(AppError::new(
            AppErrorCode::DocumentNotFound,
            "文档路径不存在或不是绝对路径",
            false,
        ));
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "pdf" {
        return Err(AppError::new(
            AppErrorCode::DocumentUnsupported,
            "当前仅支持打开 PDF 文档",
            false,
        ));
    }

    let bytes = std::fs::read(path)?;
    let file_sha256 = format!("{:x}", Sha256::digest(bytes));
    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();
    let source_type = source_type
        .as_deref()
        .map(DocumentSourceType::from_str)
        .transpose()?
        .unwrap_or(DocumentSourceType::Local);

    let record = {
        let connection = state.storage.connection();
        documents::upsert(
            &connection,
            &documents::UpsertDocumentParams {
                file_path,
                file_sha256,
                title,
                page_count: 0,
                source_type,
                zotero_item_key,
                timestamp,
            },
        )?
    };

    snapshot_from_record(&state, record)
}

/// 最近打开文档列表
#[tauri::command]
pub fn list_recent_documents(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<DocumentSnapshot>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        documents::list_recent(&connection, limit.unwrap_or(10).clamp(1, 50))?
    };

    records
        .into_iter()
        .map(|record| snapshot_from_record(&state, record))
        .collect()
}

/// 返回单文档快照，包括缓存可用性
#[tauri::command]
pub fn get_document_snapshot(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentSnapshot, crate::errors::AppError> {
    let record = {
        let connection = state.storage.connection();
        documents::get_by_id(&connection, &document_id)?
    }
    .ok_or_else(|| AppError::new(AppErrorCode::DocumentNotFound, "未找到对应文档记录", false))?;

    snapshot_from_record(&state, record)
}

fn snapshot_from_record(
    state: &State<'_, AppState>,
    record: documents::DocumentRecord,
) -> Result<DocumentSnapshot, AppError> {
    let cached_translation = {
        let connection = state.storage.connection();
        if let Some(job) = translation_jobs::find_latest_completed_for_document(
            &connection,
            &record.document_id,
            None,
            None,
        )? {
            let artifacts = translation_artifacts::list_by_job(&connection, &job.job_id)?;
            let translated_pdf_path = artifacts
                .iter()
                .find(|artifact| artifact.artifact_kind == "translated_pdf")
                .map(|artifact| artifact.file_path.clone());
            let bilingual_pdf_path = artifacts
                .iter()
                .find(|artifact| artifact.artifact_kind == "bilingual_pdf")
                .map(|artifact| artifact.file_path.clone());

            Some(CachedTranslationInfo {
                available: true,
                provider: ProviderId::from_str(&job.provider).ok(),
                model: Some(job.model),
                translated_pdf_path,
                bilingual_pdf_path,
                updated_at: job.finished_at.or(Some(job.created_at)),
            })
        } else {
            None
        }
    };

    Ok(DocumentSnapshot {
        document_id: record.document_id,
        file_path: record.file_path,
        file_sha256: record.file_sha256,
        title: record.title,
        page_count: record.page_count,
        source_type: DocumentSourceType::from_str(&record.source_type)?,
        zotero_item_key: record.zotero_item_key,
        cached_translation,
        last_opened_at: record.last_opened_at,
    })
}
