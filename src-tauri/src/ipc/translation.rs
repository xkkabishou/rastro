// B+C. Translation Engine 生命周期 + 翻译任务 Command (7 个)
// 对应 rust-backend-system.md Section 7.3 B + C
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;

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
        ai_integration::AiIntegration, app_state::AppState, keychain::KeychainService,
        notebooklm_manager::NotebookLMManager, storage::Storage,
        translation_manager::TranslationManager,
    };

    use super::{request_translation, TranslationEngineStatus};

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

    fn build_test_state() -> AppState {
        let data_dir = temp_dir("ipc-translation-test");
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new();
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
        let notebooklm_status = Arc::new(ParkingMutex::new(
            crate::ipc::notebooklm::NotebookLMEngineStatus {
                running: false,
                pid: None,
                port: 8891,
                engine_version: None,
                circuit_breaker_open: false,
                last_health_check: None,
            },
        ));
        let notebooklm_manager =
            NotebookLMManager::new(data_dir.clone(), notebooklm_status.clone()).unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            notebooklm_manager,
            notebooklm_status,
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
