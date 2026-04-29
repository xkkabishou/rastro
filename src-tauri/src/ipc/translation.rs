// B+C. Translation Engine 生命周期 + 翻译任务 Command (7 个)
// 对应 rust-backend-system.md Section 7.3 B + C
use std::{io::ErrorKind, path::Path};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{app_state::AppState, errors::AppError, storage::Storage};

/// 翻译引擎状态
#[derive(Debug, Serialize, Clone)]
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
#[derive(Debug, Serialize, Clone)]
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
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCacheResult {
    pub deleted: bool,
    pub freed_bytes: u64,
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
pub async fn ensure_translation_engine(
    state: State<'_, AppState>,
    expected_port: Option<u16>,
    force: Option<bool>,
) -> Result<TranslationEngineStatus, crate::errors::AppError> {
    state
        .translation_manager
        .ensure_engine(expected_port, force.unwrap_or(false))
        .await
}

/// 优雅关闭翻译引擎，必要时强杀
#[tauri::command]
pub async fn shutdown_translation_engine(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<TranslationEngineStatus, crate::errors::AppError> {
    state
        .translation_manager
        .shutdown_engine(force.unwrap_or(false))
        .await
}

/// 仅查询引擎状态，不触发启动
#[tauri::command]
pub async fn get_translation_engine_status(
    state: State<'_, AppState>,
) -> Result<TranslationEngineStatus, crate::errors::AppError> {
    state.translation_manager.get_engine_status().await
}

// --- C. 翻译任务 (4 个) ---

/// 提交翻译任务，命中缓存则直接返回完成态
#[tauri::command]
pub async fn request_translation(
    state: State<'_, AppState>,
    input: RequestTranslationInput,
) -> Result<TranslationJobDto, crate::errors::AppError> {
    state.translation_manager.request_translation(input).await
}

/// 获取单任务状态
#[tauri::command]
pub fn get_translation_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<TranslationJobDto, crate::errors::AppError> {
    state.translation_manager.get_job(job_id)
}

/// 取消排队或运行中的翻译任务
#[tauri::command]
pub async fn cancel_translation(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<CancelTranslationResult, crate::errors::AppError> {
    let cancelled = state
        .translation_manager
        .cancel_translation(job_id.clone())
        .await?;
    Ok(CancelTranslationResult { job_id, cancelled })
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
    state: State<'_, AppState>,
    document_id: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Option<TranslationJobDto>, crate::errors::AppError> {
    state
        .translation_manager
        .load_cached_translation(document_id, provider, model)
}

#[tauri::command]
pub fn delete_translation_cache(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeleteCacheResult, AppError> {
    delete_translation_cache_inner(&state.storage, &document_id)
}

#[derive(Debug)]
struct TranslationCacheArtifactRecord {
    file_path: String,
    file_size_bytes: u64,
}

fn delete_translation_cache_inner(
    storage: &Storage,
    document_id: &str,
) -> Result<DeleteCacheResult, AppError> {
    let connection = storage.connection();

    // R2-M1: 检查是否有活跃翻译任务，防止竞态
    let active_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM translation_jobs
         WHERE document_id = ?1 AND status IN ('queued', 'running')",
        params![document_id],
        |row| row.get(0),
    )?;
    if active_count > 0 {
        return Err(AppError::new(
            crate::errors::AppErrorCode::InternalError,
            "该文档有正在进行的翻译任务，请先取消翻译后再删除缓存",
            false,
        ));
    }

    let transaction = connection.unchecked_transaction()?;
    let artifacts = {
        let mut statement = transaction.prepare(
            "SELECT file_path, file_size_bytes
             FROM translation_artifacts
             WHERE document_id = ?1",
        )?;
        let rows = statement.query_map(params![document_id], |row| {
            Ok(TranslationCacheArtifactRecord {
                file_path: row.get("file_path")?,
                file_size_bytes: row.get("file_size_bytes")?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()?
    };

    let freed_bytes = artifacts
        .iter()
        .map(|artifact| artifact.file_size_bytes)
        .sum();

    for artifact in &artifacts {
        remove_file_if_exists(Path::new(&artifact.file_path))?;
    }

    let deleted_artifacts = transaction.execute(
        "DELETE FROM translation_artifacts WHERE document_id = ?1",
        params![document_id],
    )?;
    let deleted_jobs = transaction.execute(
        "DELETE FROM translation_jobs WHERE document_id = ?1",
        params![document_id],
    )?;
    transaction.commit()?;

    Ok(DeleteCacheResult {
        deleted: deleted_artifacts > 0 || deleted_jobs > 0,
        freed_bytes,
    })
}

fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error)),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    use parking_lot::Mutex as ParkingMutex;
    use serde_json::json;
    use tauri::{
        ipc::CallbackFn,
        test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
        webview::InvokeRequest,
        WebviewWindowBuilder,
    };

    use crate::{
        ai_integration::AiIntegration,
        app_state::AppState,
        keychain::KeychainService,
        models::{ArtifactKind, DocumentSourceType},
        storage::{documents, translation_artifacts, translation_jobs, Storage},
        translation_manager::TranslationManager,
    };

    use super::{delete_translation_cache_inner, request_translation, TranslationEngineStatus};

    #[test]
    fn request_translation_command_serializes_document_not_found_errors() {
        let app = mock_builder()
            .manage(build_test_state())
            .invoke_handler(tauri::generate_handler![request_translation])
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let error = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "request_translation".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: json!({
                    "input": {
                        "documentId": "doc-1",
                        "filePath": "/tmp/missing.pdf"
                    }
                })
                .into(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect_err("missing translation file should surface as invoke error");

        assert_eq!(error["code"], "DOCUMENT_NOT_FOUND");
        assert_eq!(error["retryable"], false);
        assert_eq!(error["details"]["documentId"], json!("doc-1"));
    }

    #[test]
    fn delete_translation_cache_removes_cached_files_and_rows() {
        let storage = Storage::new_in_memory().unwrap();
        let cache_dir = temp_dir("translation-cache");
        let translated_pdf = cache_dir.join("translated.pdf");
        fs::write(&translated_pdf, b"cache").unwrap();
        let timestamp = chrono::Utc::now().to_rfc3339();

        let document = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/original.pdf".to_string(),
                    file_sha256: "sha-doc".to_string(),
                    title: "Demo".to_string(),
                    page_count: 3,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap()
        };
        let job = {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document.document_id.clone(),
                    engine_job_id: Some("engine-1".to_string()),
                    cache_key: "cache-1".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "completed".to_string(),
                    stage: "completed".to_string(),
                    progress: 100.0,
                    created_at: timestamp.clone(),
                },
            )
            .unwrap()
        };

        {
            let connection = storage.connection();
            translation_artifacts::create(
                &connection,
                &translation_artifacts::CreateTranslationArtifactParams {
                    job_id: job.job_id.clone(),
                    document_id: document.document_id.clone(),
                    artifact_kind: ArtifactKind::TranslatedPdf.as_str().to_string(),
                    file_path: translated_pdf.to_string_lossy().into_owned(),
                    file_sha256: "sha-cache".to_string(),
                    file_size_bytes: 5,
                    created_at: timestamp,
                },
            )
            .unwrap();
        }

        let result = delete_translation_cache_inner(&storage, &document.document_id).unwrap();

        assert!(result.deleted);
        assert_eq!(result.freed_bytes, 5);
        assert!(!translated_pdf.exists());

        let connection = storage.connection();
        assert!(translation_jobs::get_by_id(&connection, &job.job_id)
            .unwrap()
            .is_none());
        let remaining_artifacts = connection
            .query_row(
                "SELECT COUNT(*) FROM translation_artifacts WHERE document_id = ?1",
                [document.document_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(remaining_artifacts, 0);
    }

    #[test]
    fn delete_translation_cache_returns_false_for_empty_document() {
        let storage = Storage::new_in_memory().unwrap();

        let result = delete_translation_cache_inner(&storage, "missing").unwrap();

        assert!(!result.deleted);
        assert_eq!(result.freed_bytes, 0);
    }

    #[test]
    fn delete_translation_cache_rejects_queued_jobs() {
        let storage = Storage::new_in_memory().unwrap();
        let timestamp = chrono::Utc::now().to_rfc3339();
        let document = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/queued.pdf".to_string(),
                    file_sha256: "sha-queued".to_string(),
                    title: "Queued".to_string(),
                    page_count: 3,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap()
        };
        {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document.document_id.clone(),
                    engine_job_id: None,
                    cache_key: "cache-queued".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "queued".to_string(),
                    stage: "queued".to_string(),
                    progress: 0.0,
                    created_at: timestamp,
                },
            )
            .unwrap();
        }

        let error = delete_translation_cache_inner(&storage, &document.document_id)
            .expect_err("queued job should block cache deletion");

        assert!(error.message.contains("正在进行"));
    }

    fn build_test_state() -> AppState {
        let data_dir = temp_dir("ipc-translation-test");
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai_integration = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();
        let translation_status = Arc::new(ParkingMutex::new(TranslationEngineStatus {
            running: false,
            pid: None,
            port: 8890,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )
        .unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            zotero_status: Arc::new(ParkingMutex::new(crate::ipc::zotero::ZoteroStatusDto {
                detected: false,
                database_path: None,
                item_count: None,
                status_message: "未检测 Zotero".to_string(),
            })),
            runtime_flags: Arc::new(ParkingMutex::new(HashMap::new())),
        }
    }

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
