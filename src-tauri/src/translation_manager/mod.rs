mod artifact_index;
mod cache_eviction;
mod engine_supervisor;
mod http_client;
mod job_registry;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use chrono::Utc;
use parking_lot::Mutex as ParkingMutex;
use tauri::async_runtime;
use tokio::{sync::Mutex, time::sleep};

/// R3-H1: 翻译 job 完成或失败时触发的事件回调类型
/// 参数: (event_name, document_id, job_id)
pub type TranslationEventEmitter = dyn Fn(&str, &str, &str) + Send + Sync;

use crate::{
    errors::{AppError, AppErrorCode},
    ipc::translation::{RequestTranslationInput, TranslationEngineStatus, TranslationJobDto},
    keychain::KeychainService,
    models::ProviderId,
    storage::{custom_prompts, documents, provider_settings, translation_jobs, Storage},
};

use self::{
    artifact_index::{normalize_progress, CacheKeyInput, TranslationArtifactIndex},
    engine_supervisor::EngineSupervisor,
    http_client::{
        CreateJobRequest, EngineJobError, GetJobResponse, ProviderAuth, TranslationHttpClient,
    },
    job_registry::{JobRegistry, PendingTranslationRequest, MAX_QUEUED_JOBS},
};

const ENGINE_HOST: &str = "127.0.0.1";
const DEFAULT_ENGINE_PORT: u16 = 8890;
const DEFAULT_TIMEOUT_SECONDS: u64 = 1800;
const DEFAULT_POLL_INTERVAL_MS: u64 = 1000;

#[derive(Clone)]
pub struct TranslationManager {
    inner: Arc<TranslationManagerInner>,
}

struct TranslationManagerInner {
    storage: Storage,
    keychain: KeychainService,
    artifact_index: TranslationArtifactIndex,
    http_client: TranslationHttpClient,
    supervisor: EngineSupervisor,
    registry: Mutex<JobRegistry>,
    /// R3-H1: 事件发射回调，由 Tauri setup 阶段注入
    event_emitter: ParkingMutex<Option<Arc<TranslationEventEmitter>>>,
}

impl TranslationManager {
    pub fn new(
        data_dir: PathBuf,
        storage: Storage,
        keychain: KeychainService,
        translation_status: Arc<ParkingMutex<TranslationEngineStatus>>,
    ) -> Result<Self, AppError> {
        let host = std::env::var("RASTRO_ENGINE_HOST").unwrap_or_else(|_| ENGINE_HOST.to_string());
        let port = std::env::var("RASTRO_ENGINE_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(DEFAULT_ENGINE_PORT);
        let http_client = TranslationHttpClient::new(&host, port)?;
        let supervisor = EngineSupervisor::new(
            host,
            port,
            data_dir.clone(),
            translation_status,
            http_client.clone(),
        )?;
        let artifact_index = TranslationArtifactIndex::new(&data_dir)?;

        Ok(Self {
            inner: Arc::new(TranslationManagerInner {
                storage,
                keychain,
                artifact_index,
                http_client,
                supervisor,
                registry: Mutex::new(JobRegistry::default()),
                event_emitter: ParkingMutex::new(None),
            }),
        })
    }

    /// R3-H1: 注入事件发射回调（Tauri setup 后调用一次）
    pub fn set_event_emitter<F>(&self, emitter: F)
    where
        F: Fn(&str, &str, &str) + Send + Sync + 'static,
    {
        *self.inner.event_emitter.lock() = Some(Arc::new(emitter));
    }

    /// 触发事件回调（如果已注入）
    fn emit_event(&self, event_name: &str, document_id: &str, job_id: &str) {
        if let Some(emitter) = self.inner.event_emitter.lock().as_ref() {
            emitter(event_name, document_id, job_id);
        }
    }

    pub async fn ensure_engine(
        &self,
        expected_port: Option<u16>,
        force: bool,
    ) -> Result<TranslationEngineStatus, AppError> {
        if let Some(expected_port) = expected_port {
            if expected_port != self.inner.supervisor.port() {
                return Err(AppError::new(
                    AppErrorCode::EnginePortConflict,
                    format!(
                        "translation-engine 固定监听 {}，但前端期望端口为 {}",
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

    pub async fn shutdown_engine(&self, force: bool) -> Result<TranslationEngineStatus, AppError> {
        self.inner.supervisor.shutdown(force).await
    }

    pub async fn get_engine_status(&self) -> Result<TranslationEngineStatus, AppError> {
        Ok(self.inner.supervisor.refresh_status().await)
    }

    pub async fn request_translation(
        &self,
        input: RequestTranslationInput,
    ) -> Result<TranslationJobDto, AppError> {
        let prepared = self.prepare_request(input)?;

        if !prepared.force_refresh {
            if let Some(record) = {
                let connection = self.inner.storage.connection();
                translation_jobs::find_latest_completed_by_cache_key(
                    &connection,
                    &prepared.cache_key,
                )?
            } {
                if self
                    .inner
                    .artifact_index
                    .validate_completed_record(&self.inner.storage, &record)
                    .is_ok()
                {
                    return self
                        .inner
                        .artifact_index
                        .dto_from_record(&self.inner.storage, record);
                }
            }
        }

        {
            let registry = self.inner.registry.lock().await;
            if let Some(existing_job_id) = registry.inflight_job_for_cache_key(&prepared.cache_key)
            {
                drop(registry);
                if let Some(record) = self.lookup_job(&existing_job_id)? {
                    if !is_terminal_status(&record.status) {
                        return self
                            .inner
                            .artifact_index
                            .dto_from_record(&self.inner.storage, record);
                    }
                }

                let mut registry = self.inner.registry.lock().await;
                registry.remove_cache_key_mapping(&prepared.cache_key, &existing_job_id);
            }
        }

        self.ensure_engine(None, false).await?;

        let job = {
            let mut registry = self.inner.registry.lock().await;
            if registry.queue_len() >= MAX_QUEUED_JOBS {
                return Err(AppError::new(
                    AppErrorCode::EngineUnavailable,
                    "翻译队列已满，请稍后重试",
                    true,
                )
                .with_detail("queueDepth", registry.queue_len()));
            }

            let timestamp = Utc::now().to_rfc3339();
            let job = {
                let connection = self.inner.storage.connection();
                translation_jobs::create(
                    &connection,
                    &translation_jobs::CreateTranslationJobParams {
                        document_id: prepared.document_id.clone(),
                        engine_job_id: None,
                        cache_key: prepared.cache_key.clone(),
                        provider: prepared.provider.clone(),
                        model: prepared.model.clone(),
                        source_lang: prepared.source_lang.clone(),
                        target_lang: prepared.target_lang.clone(),
                        status: "queued".to_string(),
                        stage: "queued".to_string(),
                        progress: 0.0,
                        created_at: timestamp,
                    },
                )?
            };

            registry.register(job.job_id.clone(), prepared);
            let should_spawn = registry.try_mark_worker_running();
            (job, should_spawn)
        };

        if job.1 {
            let manager = self.clone();
            async_runtime::spawn(async move {
                manager.dispatch_loop().await;
            });
        }

        self.inner
            .artifact_index
            .dto_from_record(&self.inner.storage, job.0)
    }

    pub fn get_job(&self, job_id: String) -> Result<TranslationJobDto, AppError> {
        let record = self.lookup_job(&job_id)?.ok_or_else(|| {
            AppError::new(AppErrorCode::TranslationFailed, "未找到翻译任务", false)
                .with_detail("jobId", job_id.clone())
        })?;

        self.inner
            .artifact_index
            .dto_from_record(&self.inner.storage, record)
    }

    pub async fn cancel_translation(&self, job_id: String) -> Result<bool, AppError> {
        if let Some(record) = self.lookup_job(&job_id)? {
            if is_terminal_status(&record.status) {
                return Ok(false);
            }
        }

        {
            let mut registry = self.inner.registry.lock().await;
            if registry.cancel_queued(&job_id) {
                self.update_local_job(
                    &job_id,
                    "cancelled",
                    "cancelled",
                    Some("JOB_CANCELLED"),
                    Some("用户在队列中取消了翻译任务"),
                    None,
                    Some(Utc::now().to_rfc3339()),
                    Some(0.0),
                )?;
                return Ok(true);
            }
        }

        let maybe_engine_job_id = {
            let mut registry = self.inner.registry.lock().await;
            registry.mark_cancel_requested(&job_id).flatten()
        };

        if let Some(engine_job_id) = maybe_engine_job_id {
            let _ = self.inner.http_client.cancel_job(&engine_job_id).await;
            return Ok(true);
        }

        if let Some(record) = self.lookup_job(&job_id)? {
            if let Some(engine_job_id) = record.engine_job_id {
                let _ = self.inner.http_client.cancel_job(&engine_job_id).await;
                return Ok(true);
            }
        }

        Ok(false)
    }

    pub fn load_cached_translation(
        &self,
        document_id: String,
        provider: Option<String>,
        model: Option<String>,
    ) -> Result<Option<TranslationJobDto>, AppError> {
        if let Some(provider) = provider.as_deref() {
            let _ = provider.parse::<ProviderId>()?;
        }

        let record = {
            let connection = self.inner.storage.connection();
            translation_jobs::find_latest_completed_for_document(
                &connection,
                &document_id,
                provider.as_deref(),
                model.as_deref(),
            )?
        };

        let Some(record) = record else {
            return Ok(None);
        };

        self.inner
            .artifact_index
            .validate_completed_record(&self.inner.storage, &record)?;
        self.inner
            .artifact_index
            .dto_from_record(&self.inner.storage, record)
            .map(Some)
    }

    fn prepare_request(
        &self,
        input: RequestTranslationInput,
    ) -> Result<PendingTranslationRequest, AppError> {
        // 1. 先查文档记录
        let document = {
            let connection = self.inner.storage.connection();
            documents::get_by_id(&connection, &input.document_id)?
        }
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::DocumentNotFound,
                "未找到对应文档记录，无法创建翻译任务",
                false,
            )
            .with_detail("documentId", input.document_id.clone())
        })?;

        // 2. 校验路径一致性：彻底不信任前端传入的 file_path
        let canonical_input = std::fs::canonicalize(&input.file_path).map_err(|_| {
            AppError::new(AppErrorCode::DocumentNotFound, "无法解析文件路径", false)
                .with_detail("filePath", input.file_path.clone())
        })?;
        let canonical_doc = std::fs::canonicalize(&document.file_path).map_err(|_| {
            AppError::new(
                AppErrorCode::DocumentNotFound,
                "文档记录的路径已失效，请重新打开文档",
                false,
            )
            .with_detail("documentFilePath", document.file_path.clone())
        })?;

        if canonical_input != canonical_doc {
            return Err(AppError::new(
                AppErrorCode::ResourceOwnershipMismatch,
                "file_path 与 document_id 对应的文件路径不一致",
                false,
            )
            .with_detail("inputPath", input.file_path)
            .with_detail("documentPath", document.file_path.clone()));
        }

        // 3. 后续一律使用 document.file_path
        let trusted_file_path = Path::new(&document.file_path);
        if !trusted_file_path.is_absolute() || !trusted_file_path.exists() {
            return Err(AppError::new(
                AppErrorCode::DocumentNotFound,
                "翻译文件路径不存在或不是绝对路径",
                false,
            )
            .with_detail("filePath", document.file_path.clone()));
        }

        let provider_record = {
            let connection = self.inner.storage.connection();
            match input.provider.as_deref() {
                Some(provider) => provider_settings::get_by_provider(&connection, provider)?,
                None => provider_settings::get_active(&connection)?,
            }
        }
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::UnsupportedTranslationProvider,
                "未找到可用的翻译 Provider 配置",
                false,
            )
        })?;

        let provider = input.provider.unwrap_or(provider_record.provider.clone());
        let _ = provider.parse::<ProviderId>()?;
        let model = input.model.unwrap_or(provider_record.model.clone());
        let api_key = self.inner.keychain.get_key(&provider)?.ok_or_else(|| {
            AppError::new(
                AppErrorCode::ProviderKeyMissing,
                format!("Provider `{provider}` 缺少 API Key，请先在设置中配置"),
                false,
            )
        })?;

        let source_lang = input.source_lang.unwrap_or_else(|| "en".to_string());
        let target_lang = input.target_lang.unwrap_or_else(|| "zh-CN".to_string());
        let output_mode =
            normalize_output_mode(input.output_mode.unwrap_or_else(|| "bilingual".to_string()))?;

        let figure_translation = input.figure_translation.unwrap_or(true);
        let skip_reference_pages = input.skip_reference_pages.unwrap_or(true);

        // 读取用户自定义翻译提示词（cache_key 计算需要包含 prompt）
        let custom_prompt = {
            let connection = self.inner.storage.connection();
            custom_prompts::get(&connection, "translation")?
        };

        let cache_key = self.inner.artifact_index.compute_cache_key(&CacheKeyInput {
            document_sha256: document.file_sha256.clone(),
            provider: provider.clone(),
            model: model.clone(),
            source_lang: source_lang.clone(),
            target_lang: target_lang.clone(),
            output_mode: output_mode.clone(),
            figure_translation,
            skip_reference_pages,
            base_url: provider_record.base_url.clone(),
            custom_prompt: custom_prompt.clone(),
        });
        let output_dir = self
            .inner
            .artifact_index
            .output_dir(&document.file_sha256, &cache_key);
        std::fs::create_dir_all(&output_dir)?;

        Ok(PendingTranslationRequest {
            document_id: document.document_id,
            pdf_path: trusted_file_path.to_string_lossy().to_string(),
            output_dir: output_dir.to_string_lossy().to_string(),
            cache_key,
            source_lang,
            target_lang,
            provider,
            model,
            api_key,
            base_url: provider_record.base_url,
            output_mode,
            figure_translation,
            skip_reference_pages,
            force_refresh: input.force_refresh.unwrap_or(false),
            custom_prompt,
        })
    }

    async fn dispatch_loop(&self) {
        loop {
            let next_job_id = {
                let mut registry = self.inner.registry.lock().await;
                match registry.dequeue_next() {
                    Some(job_id) => job_id,
                    None => {
                        registry.mark_worker_idle();
                        return;
                    }
                }
            };

            self.process_job(next_job_id.clone()).await;

            let mut registry = self.inner.registry.lock().await;
            registry.finish(&next_job_id);
        }
    }

    async fn process_job(&self, job_id: String) {
        let Some(snapshot) = ({
            let registry = self.inner.registry.lock().await;
            registry.snapshot(&job_id)
        }) else {
            return;
        };

        if snapshot.cancel_requested {
            let _ = self.update_local_job(
                &job_id,
                "cancelled",
                "cancelled",
                Some("JOB_CANCELLED"),
                Some("任务在调度前被取消"),
                None,
                Some(Utc::now().to_rfc3339()),
                Some(0.0),
            );
            return;
        }

        let started_at = Utc::now().to_rfc3339();
        let _ = self.update_local_job(
            &job_id,
            "running",
            "preflight",
            None,
            None,
            Some(started_at.clone()),
            None,
            Some(0.0),
        );

        if let Err(error) = self.ensure_engine(None, false).await {
            let _ = self.fail_job(&job_id, &error, Some(started_at));
            return;
        }

        let create_request = CreateJobRequest {
            request_id: job_id.clone(),
            document_id: snapshot.request.document_id.clone(),
            cache_key: snapshot.request.cache_key.clone(),
            pdf_path: snapshot.request.pdf_path.clone(),
            output_dir: snapshot.request.output_dir.clone(),
            source_lang: snapshot.request.source_lang.clone(),
            target_lang: snapshot.request.target_lang.clone(),
            provider: snapshot.request.provider.clone(),
            model: snapshot.request.model.clone(),
            provider_auth: ProviderAuth {
                api_key: snapshot.request.api_key.clone(),
                base_url: snapshot.request.base_url.clone(),
            },
            output_mode: snapshot.request.output_mode.clone(),
            figure_translation: snapshot.request.figure_translation,
            skip_reference_pages: snapshot.request.skip_reference_pages,
            force_refresh: snapshot.request.force_refresh,
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            glossary: Vec::new(),
            custom_prompt: snapshot.request.custom_prompt.clone(),
        };

        let create_response = match self.inner.http_client.create_job(&create_request).await {
            Ok(response) => response,
            Err(error) => {
                let _ = self
                    .handle_engine_transport_failure(&job_id, &error, Some(started_at))
                    .await;
                return;
            }
        };

        {
            let connection = self.inner.storage.connection();
            let _ = translation_jobs::set_engine_job_id(
                &connection,
                &job_id,
                Some(&create_response.job_id),
            );
        }
        {
            let mut registry = self.inner.registry.lock().await;
            registry.set_engine_job_id(&job_id, Some(create_response.job_id.clone()));
        }

        let _ = self.update_local_job(
            &job_id,
            &create_response.status,
            "queued",
            None,
            None,
            Some(started_at.clone()),
            None,
            Some(0.0),
        );

        self.poll_engine_job(
            job_id,
            create_response.job_id,
            snapshot.request.document_id,
            Some(started_at),
        )
        .await;
    }

    async fn poll_engine_job(
        &self,
        job_id: String,
        engine_job_id: String,
        document_id: String,
        started_at: Option<String>,
    ) {
        loop {
            let cancel_requested = {
                let registry = self.inner.registry.lock().await;
                registry
                    .snapshot(&job_id)
                    .map(|snapshot| snapshot.cancel_requested)
                    .unwrap_or(false)
            };
            if cancel_requested {
                let _ = self.inner.http_client.cancel_job(&engine_job_id).await;
            }

            let job = match self.inner.http_client.get_job(&engine_job_id).await {
                Ok(job) => job,
                Err(error) => {
                    let _ = self
                        .handle_engine_transport_failure(&job_id, &error, started_at.clone())
                        .await;
                    return;
                }
            };

            if self
                .apply_engine_job_status(&job_id, &job, &document_id, started_at.clone())
                .is_err()
            {
                return;
            }

            if is_terminal_status(&job.status) {
                return;
            }

            sleep(Duration::from_millis(DEFAULT_POLL_INTERVAL_MS)).await;
        }
    }

    fn apply_engine_job_status(
        &self,
        job_id: &str,
        job: &GetJobResponse,
        document_id: &str,
        started_at: Option<String>,
    ) -> Result<(), AppError> {
        let stage = job
            .stage
            .clone()
            .unwrap_or_else(|| default_stage_for_status(&job.status).to_string());
        let progress = job.progress.map(normalize_progress);

        match job.status.as_str() {
            "completed" => {
                let finished_at = job
                    .updated_at
                    .clone()
                    .unwrap_or_else(|| Utc::now().to_rfc3339());
                if let Some(result) = job.result.as_ref() {
                    self.inner.artifact_index.persist_result(
                        &self.inner.storage,
                        job_id,
                        document_id,
                        result,
                        &finished_at,
                    )?;
                }
                self.update_local_job(
                    job_id,
                    "completed",
                    "completed",
                    None,
                    None,
                    started_at,
                    Some(finished_at),
                    Some(1.0),
                )?;
                // R3-H1: 翻译完成后触发事件通知前端
                self.emit_event("translation://job-completed", document_id, job_id);
                if let Err(error) =
                    cache_eviction::evict_if_needed_excluding(&self.inner.storage, Some(job_id))
                {
                    eprintln!("translation cache eviction failed for job {job_id}: {error}");
                }
            }
            "failed" => {
                let error = job.error.clone().unwrap_or(EngineJobError {
                    code: Some("UPSTREAM_TRANSLATOR_ERROR".to_string()),
                    message: "translation-engine 返回失败".to_string(),
                    retryable: Some(false),
                    details: None,
                });
                self.update_local_job(
                    job_id,
                    "failed",
                    "failed",
                    error.code.as_deref(),
                    Some(&error.message),
                    started_at,
                    Some(
                        job.updated_at
                            .clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339()),
                    ),
                    progress.or(Some(0.0)),
                )?;
            }
            "cancelled" => {
                self.update_local_job(
                    job_id,
                    "cancelled",
                    "cancelled",
                    Some("JOB_CANCELLED"),
                    Some("翻译任务已取消"),
                    started_at,
                    Some(
                        job.updated_at
                            .clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339()),
                    ),
                    progress.or(Some(0.0)),
                )?;
            }
            status => {
                self.update_local_job(
                    job_id, status, &stage, None, None, started_at, None, progress,
                )?;
            }
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn update_local_job(
        &self,
        job_id: &str,
        status: &str,
        stage: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
        started_at: Option<String>,
        finished_at: Option<String>,
        progress: Option<f64>,
    ) -> Result<(), AppError> {
        let connection = self.inner.storage.connection();
        translation_jobs::update_status(
            &connection,
            job_id,
            status,
            stage,
            progress.unwrap_or(0.0),
            error_code,
            error_message,
            started_at.as_deref(),
            finished_at.as_deref(),
        )?;
        Ok(())
    }

    async fn handle_engine_transport_failure(
        &self,
        job_id: &str,
        error: &AppError,
        started_at: Option<String>,
    ) -> Result<(), AppError> {
        if matches!(
            error.code,
            AppErrorCode::EngineUnavailable | AppErrorCode::EngineTimeout
        ) {
            self.inner.supervisor.record_runtime_failure().await;
        }
        self.fail_job(job_id, error, started_at)
    }

    fn fail_job(
        &self,
        job_id: &str,
        error: &AppError,
        started_at: Option<String>,
    ) -> Result<(), AppError> {
        self.update_local_job(
            job_id,
            "failed",
            "failed",
            Some(error.code.as_contract_str()),
            Some(&error.message),
            started_at,
            Some(Utc::now().to_rfc3339()),
            Some(0.0),
        )
    }

    fn lookup_job(
        &self,
        job_id: &str,
    ) -> Result<Option<translation_jobs::TranslationJobRecord>, AppError> {
        let connection = self.inner.storage.connection();
        translation_jobs::get_by_id(&connection, job_id).map_err(AppError::from)
    }
}

fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

fn default_stage_for_status(status: &str) -> &str {
    match status {
        "queued" => "queued",
        "running" => "translating",
        "completed" => "completed",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => "queued",
    }
}

fn normalize_output_mode(output_mode: String) -> Result<String, AppError> {
    match output_mode.as_str() {
        "translated" | "translated_only" => Ok("translated_only".to_string()),
        "bilingual" => Ok(output_mode),
        _ => Err(AppError::new(
            AppErrorCode::TranslationFailed,
            format!("不支持的输出模式: {output_mode}"),
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    use crate::errors::AppErrorCode;

    use super::normalize_output_mode;

    #[test]
    fn normalize_output_mode_accepts_contract_value_and_legacy_alias() {
        assert_eq!(
            normalize_output_mode("translated_only".to_string()).unwrap(),
            "translated_only"
        );
        assert_eq!(
            normalize_output_mode("translated".to_string()).unwrap(),
            "translated_only"
        );
        assert_eq!(
            normalize_output_mode("bilingual".to_string()).unwrap(),
            "bilingual"
        );
    }

    #[test]
    fn normalize_output_mode_rejects_unknown_values() {
        let error = normalize_output_mode("side_by_side".to_string()).unwrap_err();
        assert_eq!(error.code, AppErrorCode::TranslationFailed);
    }
}
