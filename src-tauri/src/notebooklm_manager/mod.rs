mod engine_supervisor;
mod http_client;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

use parking_lot::Mutex as ParkingMutex;

use crate::{
    errors::{AppError, AppErrorCode},
    ipc::notebooklm::{
        ArtifactSummary, DownloadArtifactInput, NotebookLMAuthStatus, NotebookLMEngineStatus,
        NotebookLMStatus, NotebookLMTask, NotebookSummary,
    },
};

use self::{
    engine_supervisor::EngineSupervisor,
    http_client::{
        ArtifactSummaryResponse, AuthStatusResponse, NotebookLMHttpClient, NotebookSummaryResponse,
        NotebookTaskResponse,
    },
};

const ENGINE_HOST: &str = "127.0.0.1";
const DEFAULT_ENGINE_PORT: u16 = 8891;
const NOTEBOOKLM_URL: &str = "https://notebooklm.google.com/";

#[derive(Clone)]
pub struct NotebookLMManager {
    inner: Arc<NotebookLMManagerInner>,
}

struct NotebookLMManagerInner {
    notebooklm_dir: PathBuf,
    http_client: NotebookLMHttpClient,
    supervisor: EngineSupervisor,
}

impl NotebookLMManager {
    pub fn new(
        data_dir: PathBuf,
        notebooklm_status: Arc<ParkingMutex<NotebookLMEngineStatus>>,
    ) -> Result<Self, AppError> {
        let notebooklm_dir = data_dir.join("notebooklm");
        fs::create_dir_all(&notebooklm_dir)?;

        let host = std::env::var("RASTRO_NOTEBOOKLM_ENGINE_HOST")
            .unwrap_or_else(|_| ENGINE_HOST.to_string());
        let port = std::env::var("RASTRO_NOTEBOOKLM_ENGINE_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(DEFAULT_ENGINE_PORT);
        let http_client = NotebookLMHttpClient::new(&host, port)?;
        let supervisor = EngineSupervisor::new(
            host,
            port,
            notebooklm_dir.clone(),
            notebooklm_status,
            http_client.clone(),
        )?;

        Ok(Self {
            inner: Arc::new(NotebookLMManagerInner {
                notebooklm_dir,
                http_client,
                supervisor,
            }),
        })
    }

    pub async fn get_status(&self) -> Result<NotebookLMStatus, AppError> {
        let engine = self.ensure_engine(None, false).await?;
        let auth = self.auth_status().await?;
        let notebooks = if auth.authenticated {
            self.list_notebooks().await?
        } else {
            Vec::new()
        };
        Ok(NotebookLMStatus {
            engine,
            auth,
            notebooks,
        })
    }

    pub async fn ensure_engine(
        &self,
        expected_port: Option<u16>,
        force: bool,
    ) -> Result<NotebookLMEngineStatus, AppError> {
        if let Some(expected_port) = expected_port {
            if expected_port != self.inner.supervisor.port() {
                return Err(AppError::new(
                    AppErrorCode::EnginePortConflict,
                    format!(
                        "notebooklm-engine 固定监听 {}，但前端期望端口为 {}",
                        self.inner.supervisor.port(),
                        expected_port
                    ),
                    false,
                )
                .with_detail("expectedPort", expected_port)
                .with_detail("actualPort", self.inner.supervisor.port()));
            }
        }
        self.inner.supervisor.ensure_started(force).await
    }

    pub async fn auth_status(&self) -> Result<NotebookLMAuthStatus, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_auth_status(self.inner.http_client.auth_status().await?))
    }

    pub async fn begin_login(&self) -> Result<NotebookLMAuthStatus, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_auth_status(self.inner.http_client.begin_login().await?))
    }

    pub fn open_external(&self) -> Result<(), AppError> {
        open_url_in_default_browser(NOTEBOOKLM_URL)
    }

    pub async fn logout(&self) -> Result<NotebookLMAuthStatus, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_auth_status(self.inner.http_client.logout().await?))
    }

    pub async fn list_notebooks(&self) -> Result<Vec<NotebookSummary>, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(self
            .inner
            .http_client
            .list_notebooks()
            .await?
            .into_iter()
            .map(map_notebook_summary)
            .collect())
    }

    pub async fn create_notebook(
        &self,
        title: &str,
        description: Option<&str>,
    ) -> Result<NotebookSummary, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_notebook_summary(
            self.inner
                .http_client
                .create_notebook(title, description)
                .await?,
        ))
    }

    pub async fn attach_current_pdf(
        &self,
        notebook_id: &str,
        pdf_path: &str,
    ) -> Result<NotebookLMTask, AppError> {
        self.ensure_engine(None, false).await?;
        let path = Path::new(pdf_path);
        if !path.exists() {
            return Err(AppError::new(
                AppErrorCode::DocumentNotFound,
                "待上传的 PDF 文件不存在",
                false,
            )
            .with_detail("pdfPath", pdf_path.to_string()));
        }
        Ok(map_task(
            self.inner
                .http_client
                .attach_pdf(notebook_id, pdf_path)
                .await?,
        ))
    }

    pub async fn generate_artifact(
        &self,
        notebook_id: &str,
        artifact_type: &str,
    ) -> Result<NotebookLMTask, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_task(
            self.inner
                .http_client
                .generate_artifact(notebook_id, artifact_type)
                .await?,
        ))
    }

    pub async fn get_task(&self, task_id: &str) -> Result<NotebookLMTask, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(map_task(self.inner.http_client.get_task(task_id).await?))
    }

    pub async fn list_artifacts(
        &self,
        notebook_id: &str,
    ) -> Result<Vec<ArtifactSummary>, AppError> {
        self.ensure_engine(None, false).await?;
        Ok(self
            .inner
            .http_client
            .list_artifacts(notebook_id)
            .await?
            .into_iter()
            .map(map_artifact_summary)
            .collect())
    }

    pub async fn download_artifact(
        &self,
        input: DownloadArtifactInput,
    ) -> Result<ArtifactSummary, AppError> {
        self.ensure_engine(None, false).await?;
        let downloads_dir = self.inner.notebooklm_dir.join("downloads");
        fs::create_dir_all(&downloads_dir)?;
        let file_name = format!(
            "{}.{}",
            sanitize_file_stem(&input.title),
            artifact_extension(&input.artifact_type)
        );
        let destination = downloads_dir.join(file_name);
        Ok(map_artifact_summary(
            self.inner
                .http_client
                .download_artifact(
                    &input.artifact_id,
                    &input.artifact_type,
                    destination.to_string_lossy().as_ref(),
                )
                .await?,
        ))
    }
}

fn map_auth_status(value: AuthStatusResponse) -> NotebookLMAuthStatus {
    NotebookLMAuthStatus {
        authenticated: value.authenticated,
        auth_expired: value.auth_expired,
        last_auth_at: value.last_auth_at,
        last_error: value.last_error,
    }
}

fn map_notebook_summary(value: NotebookSummaryResponse) -> NotebookSummary {
    NotebookSummary {
        id: value.id,
        title: value.title,
        source_count: value.source_count,
        updated_at: value.updated_at,
    }
}

fn map_task(value: NotebookTaskResponse) -> NotebookLMTask {
    NotebookLMTask {
        id: value.id,
        kind: value.kind,
        artifact_type: value.artifact_type,
        status: value.status,
        progress_message: value.progress_message,
        error_code: value.error_code,
        error_message: value.error_message,
        notebook_id: value.notebook_id,
        created_at: value.created_at,
        updated_at: value.updated_at,
    }
}

fn map_artifact_summary(value: ArtifactSummaryResponse) -> ArtifactSummary {
    ArtifactSummary {
        id: value.id,
        notebook_id: value.notebook_id,
        artifact_type: value.artifact_type,
        title: value.title,
        download_status: value.download_status,
        local_path: value.local_path,
        created_at: value.created_at,
    }
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        "notebooklm-artifact".to_string()
    } else {
        sanitized
    }
}

fn artifact_extension(artifact_type: &str) -> &'static str {
    match artifact_type {
        "mind-map" => "json",
        "slide-deck" => "pdf",
        "audio-overview" => "mp3",
        _ => "bin",
    }
}

fn open_url_in_default_browser(url: &str) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    let status = command.status().map_err(|error| {
        AppError::new(
            AppErrorCode::NotebooklmUnknown,
            "无法拉起系统默认浏览器，请手动使用“外部打开”入口。",
            true,
        )
        .with_detail("cause", error.to_string())
        .with_detail("url", url.to_string())
    })?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::NotebooklmUnknown,
            "系统默认浏览器拉起失败，请手动使用“外部打开”入口。",
            true,
        )
        .with_detail("url", url.to_string())
        .with_detail("exitCode", status.code().unwrap_or_default()))
    }
}
