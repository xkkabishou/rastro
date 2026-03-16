#![allow(dead_code)]

use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppErrorCode};

#[derive(Clone)]
pub struct TranslationHttpClient {
    client: reqwest::Client,
    base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthzResponse {
    pub status: String,
    pub service: Option<String>,
    pub version: Option<String>,
    pub engine: Option<String>,
    pub engine_version: Option<String>,
    pub python_version: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub queue_depth: Option<u32>,
    pub active_job_id: Option<String>,
    pub supported_providers: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuth {
    pub api_key: String,
    pub base_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobRequest {
    pub request_id: String,
    pub document_id: String,
    pub cache_key: String,
    pub pdf_path: String,
    pub output_dir: String,
    pub source_lang: String,
    pub target_lang: String,
    pub provider: String,
    pub model: String,
    pub provider_auth: ProviderAuth,
    pub output_mode: String,
    pub figure_translation: bool,
    pub skip_reference_pages: bool,
    pub force_refresh: bool,
    pub timeout_seconds: u64,
    pub glossary: Vec<GlossaryTerm>,
    pub custom_prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobResponse {
    pub job_id: String,
    pub status: String,
    pub queue_position: Option<u32>,
    pub cache_hit: Option<bool>,
    pub poll_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineJobResult {
    pub translated_pdf_path: Option<String>,
    pub bilingual_pdf_path: Option<String>,
    pub figure_report_path: Option<String>,
    pub manifest_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineJobError {
    pub code: Option<String>,
    pub message: String,
    pub retryable: Option<bool>,
    pub details: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetJobResponse {
    pub job_id: String,
    pub document_id: Option<String>,
    pub status: String,
    pub stage: Option<String>,
    pub progress: Option<f64>,
    pub queue_position: Option<u32>,
    pub current_page: Option<u32>,
    pub total_pages: Option<u32>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub result: Option<EngineJobResult>,
    pub error: Option<EngineJobError>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelJobResponse {
    pub job_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownResponse {
    pub accepted: bool,
    pub active_job_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownRequest {
    graceful_timeout_seconds: u64,
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

impl TranslationHttpClient {
    pub fn new(host: &str, port: u16) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
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

    pub async fn create_job(
        &self,
        request: &CreateJobRequest,
    ) -> Result<CreateJobResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/v1/jobs", self.base_url))
            .json(request)
            .send()
            .await
            .map_err(map_transport_error)?;

        Self::parse_response(response).await
    }

    pub async fn get_job(&self, job_id: &str) -> Result<GetJobResponse, AppError> {
        let response = self
            .client
            .get(format!("{}/v1/jobs/{job_id}", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;

        Self::parse_response(response).await
    }

    pub async fn cancel_job(&self, job_id: &str) -> Result<CancelJobResponse, AppError> {
        let response = self
            .client
            .delete(format!("{}/v1/jobs/{job_id}", self.base_url))
            .send()
            .await
            .map_err(map_transport_error)?;

        Self::parse_response(response).await
    }

    pub async fn shutdown(
        &self,
        graceful_timeout_seconds: u64,
    ) -> Result<ShutdownResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/control/shutdown", self.base_url))
            .json(&ShutdownRequest {
                graceful_timeout_seconds,
            })
            .send()
            .await
            .map_err(map_transport_error)?;

        Self::parse_response(response).await
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
            if status == reqwest::StatusCode::REQUEST_TIMEOUT {
                AppErrorCode::EngineTimeout
            } else {
                AppErrorCode::EngineUnavailable
            },
            format!("translation-engine 返回异常状态: {status}"),
            status.is_server_error(),
        )
        .with_detail("responseBody", body))
    }
}

fn map_transport_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        return AppError::new(
            AppErrorCode::EngineTimeout,
            format!("translation-engine 请求超时: {error}"),
            true,
        );
    }

    AppError::new(
        AppErrorCode::EngineUnavailable,
        format!("无法连接 translation-engine: {error}"),
        true,
    )
}

fn map_engine_error(error: EngineErrorPayload) -> AppError {
    let code = match error.code.as_str() {
        "ENGINE_BUSY" => AppErrorCode::EngineUnavailable,
        "PROVIDER_AUTH_MISSING" => AppErrorCode::ProviderKeyMissing,
        "UNSUPPORTED_PROVIDER" => AppErrorCode::UnsupportedTranslationProvider,
        "TRANSLATION_TIMEOUT" => AppErrorCode::EngineTimeout,
        "JOB_CANCELLED" => AppErrorCode::TranslationCancelled,
        _ => AppErrorCode::TranslationFailed,
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

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, time::Duration};

    use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use crate::errors::AppErrorCode;

    use super::{map_engine_error, TranslationHttpClient};

    #[test]
    fn map_engine_error_covers_all_engine_error_branches() {
        let cases = [
            ("ENGINE_BUSY", AppErrorCode::EngineUnavailable),
            ("PROVIDER_AUTH_MISSING", AppErrorCode::ProviderKeyMissing),
            (
                "UNSUPPORTED_PROVIDER",
                AppErrorCode::UnsupportedTranslationProvider,
            ),
            ("TRANSLATION_TIMEOUT", AppErrorCode::EngineTimeout),
            ("JOB_CANCELLED", AppErrorCode::TranslationCancelled),
            ("UNKNOWN", AppErrorCode::TranslationFailed),
        ];

        for (engine_code, expected) in cases {
            let error = map_engine_error(super::EngineErrorPayload {
                code: engine_code.to_string(),
                message: format!("mapped from {engine_code}"),
                retryable: Some(true),
                details: Some(HashMap::from([("source".to_string(), json!("engine"))])),
            });

            assert_eq!(error.code, expected);
            assert_eq!(
                error.details.as_ref().unwrap()["engineCode"],
                json!(engine_code)
            );
            assert_eq!(error.details.as_ref().unwrap()["source"], json!("engine"));
        }
    }

    #[tokio::test]
    async fn parse_response_maps_request_timeout_status_to_engine_timeout() {
        async fn timeout_handler() -> impl IntoResponse {
            (
                StatusCode::REQUEST_TIMEOUT,
                Json(json!({ "message": "timeout" })),
            )
        }

        let address = spawn_server(Router::new().route("/healthz", get(timeout_handler))).await;
        let client = TranslationHttpClient::new("127.0.0.1", address.port()).unwrap();

        let error = client
            .healthz()
            .await
            .expect_err("408 should map to AppError");
        assert_eq!(error.code, AppErrorCode::EngineTimeout);
        assert_eq!(
            error.details.as_ref().unwrap()["responseBody"],
            json!("{\"message\":\"timeout\"}")
        );
    }

    #[tokio::test]
    async fn parse_response_maps_engine_error_envelope_from_http_body() {
        async fn engine_error_handler() -> impl IntoResponse {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "code": "JOB_CANCELLED",
                        "message": "job was cancelled",
                        "retryable": false,
                        "details": { "jobId": "job-1" }
                    }
                })),
            )
        }

        let address =
            spawn_server(Router::new().route("/healthz", get(engine_error_handler))).await;
        let client = TranslationHttpClient::new("127.0.0.1", address.port()).unwrap();

        let error = client
            .healthz()
            .await
            .expect_err("engine envelope should map");
        assert_eq!(error.code, AppErrorCode::TranslationCancelled);
        assert_eq!(error.details.as_ref().unwrap()["jobId"], json!("job-1"));
    }

    async fn spawn_server(router: Router) -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        address
    }
}
