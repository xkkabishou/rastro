#![allow(dead_code)]

use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppErrorCode};

#[derive(Clone)]
pub struct NotebookLMHttpClient {
    client: reqwest::Client,
    base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthzResponse {
    pub status: String,
    pub service: Option<String>,
    pub engine_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusResponse {
    pub authenticated: bool,
    pub auth_expired: bool,
    pub last_auth_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSummaryResponse {
    pub id: String,
    pub title: String,
    pub source_count: u32,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookTaskResponse {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummaryResponse {
    pub id: String,
    pub notebook_id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub download_status: String,
    pub local_path: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct ListEnvelope<T> {
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct EngineErrorEnvelope {
    error: EngineErrorPayload,
}

#[derive(Debug, Deserialize)]
struct EngineErrorPayload {
    code: String,
    message: String,
    retryable: Option<bool>,
    details: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotebookRequest<'a> {
    title: &'a str,
    description: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachPdfRequest<'a> {
    pdf_path: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateArtifactRequest<'a> {
    artifact_type: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadArtifactRequest<'a> {
    artifact_type: &'a str,
    destination_path: &'a str,
}

#[derive(Serialize)]
struct EmptyRequest {}

impl NotebookLMHttpClient {
    pub fn new(host: &str, port: u16) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(AppError::from)?;

        Ok(Self {
            client,
            base_url: format!("http://{host}:{port}"),
        })
    }

    pub async fn healthz(&self) -> Result<HealthzResponse, AppError> {
        let response = self
            .client
            .get(format!("{}/healthz", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn auth_status(&self) -> Result<AuthStatusResponse, AppError> {
        let response = self
            .client
            .get(format!("{}/auth/status", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn begin_login(&self) -> Result<AuthStatusResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/auth/login", self.base_url))
            .timeout(Duration::from_secs(330))
            .json(&EmptyRequest {})
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn logout(&self) -> Result<AuthStatusResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/auth/logout", self.base_url))
            .json(&EmptyRequest {})
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn list_notebooks(&self) -> Result<Vec<NotebookSummaryResponse>, AppError> {
        let response = self
            .client
            .get(format!("{}/notebooks", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;
        Ok(
            Self::parse_response::<ListEnvelope<NotebookSummaryResponse>>(response)
                .await?
                .items,
        )
    }

    pub async fn create_notebook(
        &self,
        title: &str,
        description: Option<&str>,
    ) -> Result<NotebookSummaryResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/notebooks", self.base_url))
            .json(&CreateNotebookRequest { title, description })
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn attach_pdf(
        &self,
        notebook_id: &str,
        pdf_path: &str,
    ) -> Result<NotebookTaskResponse, AppError> {
        let response = self
            .client
            .post(format!(
                "{}/notebooks/{notebook_id}/sources/pdf",
                self.base_url
            ))
            .json(&AttachPdfRequest { pdf_path })
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn generate_artifact(
        &self,
        notebook_id: &str,
        artifact_type: &str,
    ) -> Result<NotebookTaskResponse, AppError> {
        let response = self
            .client
            .post(format!(
                "{}/notebooks/{notebook_id}/artifacts",
                self.base_url
            ))
            .json(&GenerateArtifactRequest { artifact_type })
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn get_task(&self, task_id: &str) -> Result<NotebookTaskResponse, AppError> {
        let response = self
            .client
            .get(format!("{}/tasks/{task_id}", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn list_artifacts(
        &self,
        notebook_id: &str,
    ) -> Result<Vec<ArtifactSummaryResponse>, AppError> {
        let response = self
            .client
            .get(format!(
                "{}/notebooks/{notebook_id}/artifacts",
                self.base_url
            ))
            .send()
            .await
            .map_err(map_transport_error)?;
        Ok(
            Self::parse_response::<ListEnvelope<ArtifactSummaryResponse>>(response)
                .await?
                .items,
        )
    }

    pub async fn download_artifact(
        &self,
        artifact_id: &str,
        artifact_type: &str,
        destination_path: &str,
    ) -> Result<ArtifactSummaryResponse, AppError> {
        let response = self
            .client
            .post(format!(
                "{}/artifacts/{artifact_id}/download",
                self.base_url
            ))
            .json(&DownloadArtifactRequest {
                artifact_type,
                destination_path,
            })
            .send()
            .await
            .map_err(map_transport_error)?;
        Self::parse_response(response).await
    }

    pub async fn shutdown(&self) -> Result<(), AppError> {
        let response = self
            .client
            .post(format!("{}/control/shutdown", self.base_url))
            .json(&EmptyRequest {})
            .send()
            .await
            .map_err(map_transport_error)?;
        let _: serde_json::Value = Self::parse_response(response).await?;
        Ok(())
    }

    async fn parse_response<T: for<'de> Deserialize<'de>>(
        response: reqwest::Response,
    ) -> Result<T, AppError> {
        if response.status().is_success() {
            return response.json::<T>().await.map_err(AppError::from);
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if let Ok(envelope) = serde_json::from_str::<EngineErrorEnvelope>(&body) {
            return Err(map_engine_error(envelope.error));
        }

        Err(AppError::new(
            AppErrorCode::NotebooklmUnknown,
            format!("notebooklm-engine 返回异常状态: {status}"),
            status.is_server_error(),
        )
        .with_detail("responseBody", body))
    }
}

fn map_transport_error(error: reqwest::Error) -> AppError {
    AppError::new(
        AppErrorCode::NotebooklmEngineUnavailable,
        format!("无法连接 notebooklm-engine: {error}"),
        true,
    )
}

fn map_engine_error(error: EngineErrorPayload) -> AppError {
    let code = match error.code.as_str() {
        "NOTEBOOKLM_AUTH_REQUIRED" => AppErrorCode::NotebooklmAuthRequired,
        "NOTEBOOKLM_AUTH_EXPIRED" => AppErrorCode::NotebooklmAuthExpired,
        "NOTEBOOKLM_ENGINE_UNAVAILABLE" => AppErrorCode::NotebooklmEngineUnavailable,
        "NOTEBOOKLM_UPLOAD_FAILED" => AppErrorCode::NotebooklmUploadFailed,
        "NOTEBOOKLM_GENERATION_FAILED" => AppErrorCode::NotebooklmGenerationFailed,
        "NOTEBOOKLM_DOWNLOAD_FAILED" => AppErrorCode::NotebooklmDownloadFailed,
        "NOTEBOOKLM_RATE_LIMITED" => AppErrorCode::NotebooklmRateLimited,
        _ => AppErrorCode::NotebooklmUnknown,
    };

    let mut mapped = AppError::new(code, error.message, error.retryable.unwrap_or(false))
        .with_detail("engineCode", error.code);
    if let Some(details) = error.details {
        for (key, value) in details {
            mapped = mapped.with_detail(key, value);
        }
    }
    mapped
}
