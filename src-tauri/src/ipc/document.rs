// A. 文档与应用状态 Command
// 对应 rust-backend-system.md Section 7.3 A
use std::{path::Path, str::FromStr};

use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::State;

use crate::{
    app_state::AppState,
    artifact_aggregator::{self, DocumentArtifactDto},
    errors::{AppError, AppErrorCode},
    models::{DocumentSourceType, ProviderId},
    storage::{document_summaries, documents, translation_artifacts, translation_jobs},
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
    pub has_summary: bool,
    pub is_favorite: bool,
    pub artifact_count: u32,
    pub last_opened_at: String,
}

/// 文档筛选条件输入
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFilterInput {
    pub has_translation: Option<bool>,
    pub has_summary: Option<bool>,
    pub is_favorite: Option<bool>,
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
    title_override: Option<String>,
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

    // 流式计算 SHA256（避免将整个文件读入内存）
    let file_sha256 = {
        use sha2::Digest;
        let file = std::fs::File::open(path)?;
        let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
        let mut hasher = Sha256::new();
        // Sha256 implements io::Write via the digest crate
        std::io::copy(&mut reader, &mut hasher)?;
        format!("{:x}", hasher.finalize())
    };
    // 优先使用外部传入的标题（如 Zotero 元数据标题），否则使用文件名
    let title = title_override.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });
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
    query: Option<String>,
    filter: Option<DocumentFilterInput>,
) -> Result<Vec<DocumentSnapshot>, crate::errors::AppError> {
    let connection = state.storage.connection();
    let filter = filter.unwrap_or_default();
    let records = documents::list_with_filters(
        &connection,
        documents::DocumentFilter {
            query,
            is_favorite: filter.is_favorite,
            has_translation: filter.has_translation,
            has_summary: filter.has_summary,
        },
        limit.unwrap_or(10).clamp(1, 50),
    )?;

    // R2-H1: 批量富化快照，避免 per-document N+1 查询
    batch_enrich_snapshots(&connection, records)
}

/// 从历史记录中移除文档
#[tauri::command]
pub fn remove_recent_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<serde_json::Value, AppError> {
    let removed = {
        let connection = state.storage.connection();
        documents::soft_delete(&connection, &document_id)?
    };

    Ok(serde_json::json!({ "removed": removed }))
}

/// 收藏或取消收藏文档
#[tauri::command]
pub fn toggle_document_favorite(
    state: State<'_, AppState>,
    document_id: String,
    favorite: bool,
) -> Result<serde_json::Value, AppError> {
    let updated = {
        let connection = state.storage.connection();
        documents::toggle_favorite(&connection, &document_id, favorite)?
    };

    Ok(serde_json::json!({ "updated": updated }))
}

/// 在 Finder 中定位文件
#[tauri::command]
pub fn reveal_in_finder(file_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &file_path])
            .spawn()?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = file_path;
    }

    Ok(())
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

#[tauri::command]
pub fn list_document_artifacts(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<DocumentArtifactDto>, AppError> {
    let connection = state.storage.connection();
    artifact_aggregator::list_artifacts_for_document(&connection, &document_id)
}

fn snapshot_from_record(
    state: &State<'_, AppState>,
    record: documents::DocumentRecord,
) -> Result<DocumentSnapshot, AppError> {
    let (cached_translation, has_summary, artifact_count) = {
        let connection = state.storage.connection();
        let cached_translation = if let Some(job) =
            translation_jobs::find_latest_completed_for_document(
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
        };
        let has_summary =
            document_summaries::get_by_document_id(&connection, &record.document_id)?.is_some();
        let artifact_count =
            artifact_aggregator::count_artifacts_for_document(&connection, &record.document_id)?
                .total_count();

        (cached_translation, has_summary, artifact_count)
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
        has_summary,
        is_favorite: record.is_favorite,
        artifact_count,
        last_opened_at: record.last_opened_at,
    })
}

/// R2-H1: 批量查询翻译/总结/产物计数，将 1+3N 次查询优化为 4 次查询。
fn batch_enrich_snapshots(
    connection: &rusqlite::Connection,
    records: Vec<documents::DocumentRecord>,
) -> Result<Vec<DocumentSnapshot>, AppError> {
    use std::collections::{HashMap, HashSet};

    if records.is_empty() {
        return Ok(Vec::new());
    }

    let doc_ids: Vec<&str> = records.iter().map(|r| r.document_id.as_str()).collect();

    // 批量查询最新完成的翻译 job（每个文档取最新一个）
    let placeholders: String = doc_ids
        .iter()
        .enumerate()
        .map(|(i, _)| {
            if i == 0 {
                "?".to_string()
            } else {
                ",?".to_string()
            }
        })
        .collect();

    let mut latest_jobs: HashMap<String, translation_jobs::TranslationJobRecord> = HashMap::new();
    {
        let sql = format!(
            "SELECT * FROM translation_jobs
             WHERE document_id IN ({}) AND status = 'completed'
             ORDER BY created_at DESC",
            placeholders
        );
        let mut statement = connection.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = doc_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = statement.query_map(params.as_slice(), translation_jobs::map_job_row)?;
        for row_result in rows {
            let job = row_result?;
            // 仅保留每个文档的最新 job（已按 created_at DESC 排序）
            latest_jobs.entry(job.document_id.clone()).or_insert(job);
        }
    }

    // 批量查询哪些文档有总结
    let summary_doc_ids: HashSet<String> = {
        let sql = format!(
            "SELECT document_id FROM document_summaries WHERE document_id IN ({})",
            placeholders
        );
        let mut statement = connection.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = doc_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = statement.query_map(params.as_slice(), |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // R3-M1: 批量查询翻译产物数量（仅统计每个文档最新 completed job 的产物，与单文档路径一致）
    let mut translation_artifact_counts: HashMap<String, u32> = HashMap::new();
    {
        let sql = format!(
            "SELECT ta.document_id, COUNT(*) as cnt
             FROM translation_artifacts ta
             INNER JOIN translation_jobs tj ON ta.job_id = tj.job_id
             WHERE ta.document_id IN ({}) AND tj.status = 'completed'
               AND ta.artifact_kind IN ('translated_pdf', 'bilingual_pdf')
               AND tj.created_at = (
                   SELECT MAX(tj2.created_at)
                   FROM translation_jobs tj2
                   WHERE tj2.document_id = ta.document_id AND tj2.status = 'completed'
               )
             GROUP BY ta.document_id",
            placeholders
        );
        let mut statement = connection.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = doc_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = statement.query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
        })?;
        for row_result in rows {
            let (doc_id, count) = row_result?;
            translation_artifact_counts.insert(doc_id, count);
        }
    }

    // 富化快照：加载最新 job 的产物详情
    let mut job_artifacts: HashMap<String, Vec<translation_artifacts::TranslationArtifactRecord>> =
        HashMap::new();
    for (doc_id, job) in &latest_jobs {
        let artifacts = translation_artifacts::list_by_job(connection, &job.job_id)?;
        job_artifacts.insert(doc_id.clone(), artifacts);
    }

    // 组装快照
    let mut snapshots = Vec::with_capacity(records.len());
    for record in records {
        let cached_translation = if let Some(job) = latest_jobs.get(&record.document_id) {
            let artifacts = job_artifacts.get(&record.document_id);
            let translated_pdf_path = artifacts
                .and_then(|a| a.iter().find(|art| art.artifact_kind == "translated_pdf"))
                .map(|art| art.file_path.clone());
            let bilingual_pdf_path = artifacts
                .and_then(|a| a.iter().find(|art| art.artifact_kind == "bilingual_pdf"))
                .map(|art| art.file_path.clone());

            Some(CachedTranslationInfo {
                available: true,
                provider: ProviderId::from_str(&job.provider).ok(),
                model: Some(job.model.clone()),
                translated_pdf_path,
                bilingual_pdf_path,
                updated_at: job
                    .finished_at
                    .clone()
                    .or_else(|| Some(job.created_at.clone())),
            })
        } else {
            None
        };

        let has_summary = summary_doc_ids.contains(&record.document_id);
        let translation_count = translation_artifact_counts
            .get(&record.document_id)
            .copied()
            .unwrap_or(0);
        let artifact_count = translation_count + u32::from(has_summary);

        snapshots.push(DocumentSnapshot {
            document_id: record.document_id,
            file_path: record.file_path,
            file_sha256: record.file_sha256,
            title: record.title,
            page_count: record.page_count,
            source_type: DocumentSourceType::from_str(&record.source_type)?,
            zotero_item_key: record.zotero_item_key,
            cached_translation,
            has_summary,
            is_favorite: record.is_favorite,
            artifact_count,
            last_opened_at: record.last_opened_at,
        });
    }

    Ok(snapshots)
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

    use parking_lot::Mutex;
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
        ipc::{translation::TranslationEngineStatus, zotero::ZoteroStatusDto},
        keychain::KeychainService,
        models::DocumentSourceType,
        storage::Storage,
        translation_manager::TranslationManager,
    };

    use super::{open_document, DocumentSnapshot};

    #[test]
    fn open_document_command_returns_serialized_app_error_payload() {
        let app = mock_builder()
            .manage(build_test_state())
            .invoke_handler(tauri::generate_handler![open_document])
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let error = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "open_document".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: json!({
                    "filePath": "/tmp/does-not-exist.pdf"
                })
                .into(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect_err("missing document should surface as invoke error");

        assert_eq!(
            error,
            json!({
                "code": "DOCUMENT_NOT_FOUND",
                "message": "文档路径不存在或不是绝对路径",
                "retryable": false
            })
        );
    }

    #[test]
    fn open_document_command_rejects_non_pdf_files() {
        let app = mock_builder()
            .manage(build_test_state())
            .invoke_handler(tauri::generate_handler![open_document])
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let text_file = temp_file("ipc-document-test", "notes.txt", b"hello");

        let error = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "open_document".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: json!({
                    "filePath": text_file.to_string_lossy()
                })
                .into(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect_err("non-pdf documents should be rejected");

        assert_eq!(error["code"], "DOCUMENT_UNSUPPORTED");
        assert_eq!(error["retryable"], false);
    }

    #[test]
    fn document_snapshot_serializes_new_fields_in_camel_case() {
        let payload = serde_json::to_value(DocumentSnapshot {
            document_id: "doc-1".to_string(),
            file_path: "/tmp/doc.pdf".to_string(),
            file_sha256: "sha-1".to_string(),
            title: "Demo".to_string(),
            page_count: 12,
            source_type: DocumentSourceType::Local,
            zotero_item_key: None,
            cached_translation: None,
            has_summary: true,
            is_favorite: true,
            artifact_count: 3,
            last_opened_at: "2026-03-16T12:00:00Z".to_string(),
        })
        .unwrap();

        assert_eq!(payload["hasSummary"], json!(true));
        assert_eq!(payload["isFavorite"], json!(true));
        assert_eq!(payload["artifactCount"], json!(3));
    }

    fn build_test_state() -> AppState {
        let data_dir = temp_dir("ipc-document-test");
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai_integration = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();
        let translation_status = Arc::new(Mutex::new(TranslationEngineStatus {
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
            zotero_status: Arc::new(Mutex::new(ZoteroStatusDto {
                detected: false,
                database_path: None,
                item_count: None,
                status_message: "未检测 Zotero".to_string(),
            })),
            runtime_flags: Arc::new(Mutex::new(HashMap::new())),
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

    fn temp_file(prefix: &str, file_name: &str, contents: &[u8]) -> PathBuf {
        let dir = temp_dir(prefix);
        let path = dir.join(file_name);
        fs::write(&path, contents).unwrap();
        path
    }
}
