use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMEngineStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub engine_version: Option<String>,
    pub circuit_breaker_open: bool,
    pub last_health_check: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMAuthStatus {
    pub authenticated: bool,
    pub auth_expired: bool,
    pub last_auth_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSummary {
    pub id: String,
    pub title: String,
    pub source_count: u32,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMTask {
    pub id: String,
    pub kind: String,
    pub artifact_type: Option<String>,
    pub status: String,
    pub progress_message: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub notebook_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub id: String,
    #[serde(rename = "notebookId")]
    pub notebook_id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub download_status: String,
    pub local_path: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLMStatus {
    pub engine: NotebookLMEngineStatus,
    pub auth: NotebookLMAuthStatus,
    pub notebooks: Vec<NotebookSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotebookInput {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachCurrentPdfInput {
    pub notebook_id: String,
    pub pdf_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateArtifactInput {
    pub notebook_id: String,
    pub artifact_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArtifactInput {
    pub artifact_id: String,
    pub artifact_type: String,
    pub title: String,
}

#[tauri::command]
pub async fn notebooklm_get_status(
    state: State<'_, AppState>,
) -> Result<NotebookLMStatus, crate::errors::AppError> {
    state.notebooklm_manager.get_status().await
}

#[tauri::command]
pub async fn notebooklm_begin_login(
    state: State<'_, AppState>,
) -> Result<NotebookLMAuthStatus, crate::errors::AppError> {
    state.notebooklm_manager.begin_login().await
}

#[tauri::command]
pub fn notebooklm_open_external(state: State<'_, AppState>) -> Result<(), crate::errors::AppError> {
    state.notebooklm_manager.open_external()
}

#[tauri::command]
pub async fn notebooklm_logout(
    state: State<'_, AppState>,
) -> Result<NotebookLMAuthStatus, crate::errors::AppError> {
    state.notebooklm_manager.logout().await
}

#[tauri::command]
pub async fn notebooklm_list_notebooks(
    state: State<'_, AppState>,
) -> Result<Vec<NotebookSummary>, crate::errors::AppError> {
    state.notebooklm_manager.list_notebooks().await
}

#[tauri::command]
pub async fn notebooklm_create_notebook(
    state: State<'_, AppState>,
    input: CreateNotebookInput,
) -> Result<NotebookSummary, crate::errors::AppError> {
    state
        .notebooklm_manager
        .create_notebook(&input.title, input.description.as_deref())
        .await
}

#[tauri::command]
pub async fn notebooklm_attach_current_pdf(
    state: State<'_, AppState>,
    input: AttachCurrentPdfInput,
) -> Result<NotebookLMTask, crate::errors::AppError> {
    state
        .notebooklm_manager
        .attach_current_pdf(&input.notebook_id, &input.pdf_path)
        .await
}

#[tauri::command]
pub async fn notebooklm_generate_artifact(
    state: State<'_, AppState>,
    input: GenerateArtifactInput,
) -> Result<NotebookLMTask, crate::errors::AppError> {
    state
        .notebooklm_manager
        .generate_artifact(&input.notebook_id, &input.artifact_type)
        .await
}

#[tauri::command]
pub async fn notebooklm_get_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<NotebookLMTask, crate::errors::AppError> {
    state.notebooklm_manager.get_task(&task_id).await
}

#[tauri::command]
pub async fn notebooklm_list_artifacts(
    state: State<'_, AppState>,
    notebook_id: String,
) -> Result<Vec<ArtifactSummary>, crate::errors::AppError> {
    state.notebooklm_manager.list_artifacts(&notebook_id).await
}

#[tauri::command]
pub async fn notebooklm_download_artifact(
    state: State<'_, AppState>,
    input: DownloadArtifactInput,
) -> Result<ArtifactSummary, crate::errors::AppError> {
    state.notebooklm_manager.download_artifact(input).await
}
