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
        CreateJobRequest, CreateJobResponse, EngineJobError, GetJobResponse, ProviderAuth,
        TranslationHttpClient,
    },
    job_registry::{JobRegistry, PendingTranslationRequest, MAX_QUEUED_JOBS},
};

/// R3-H1: 翻译任务事件回调类型
/// 参数: (event_name, job_dto)
pub type TranslationEventEmitter = dyn Fn(&str, &TranslationJobDto) + Send + Sync;

const ENGINE_HOST: &str = "127.0.0.1";
const DEFAULT_ENGINE_PORT: u16 = 8890;
const DEFAULT_TIMEOUT_SECONDS: u64 = 1800;
const DEFAULT_POLL_INTERVAL_MS: u64 = 1000;
const MAX_STATUS_POLL_TRANSPORT_FAILURES: u32 = 10;
const MAX_STATUS_POLL_JOB_NOT_FOUND_FAILURES: u32 = 5;

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

        // 启动自愈：上次进程异常退出时，SQLite 可能残留 running 任务。
        // 超过单任务默认超时时间后统一转 failed，避免前端一直显示“翻译中”。
        let now = Utc::now();
        let cutoff = (now - chrono::Duration::seconds(DEFAULT_TIMEOUT_SECONDS as i64)).to_rfc3339();
        let recovered = {
            let connection = storage.connection();
            translation_jobs::mark_stale_running_as_failed(&connection, &cutoff, &now.to_rfc3339())?
        };
        if recovered > 0 {
            eprintln!("translation manager recovered {recovered} stale running job(s)");
        }

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
        F: Fn(&str, &TranslationJobDto) + Send + Sync + 'static,
    {
        *self.inner.event_emitter.lock() = Some(Arc::new(emitter));
    }

    /// 触发事件回调（如果已注入）
    fn emit_event(&self, event_name: &str, job: &TranslationJobDto) {
        if let Some(emitter) = self.inner.event_emitter.lock().as_ref() {
            emitter(event_name, job);
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
        // prepare_request 内部多次访问 SQLite 与 Keychain，整体走 spawn_blocking
        let manager_for_prepare = self.clone();
        let prepared = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
            manager_for_prepare.prepare_request(input)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

        if !prepared.force_refresh {
            // 缓存命中检查：lookup → validate → dto_from_record 全程访问 SQLite，
            // 一次性放进 spawn_blocking 减少多次切线程开销
            let storage = self.inner.storage.clone();
            let artifact_index = self.inner.artifact_index.clone();
            let cache_key_for_lookup = prepared.cache_key.clone();
            let cached_dto = tokio::task::spawn_blocking(
                move || -> Result<Option<TranslationJobDto>, AppError> {
                    let record_opt = {
                        let connection = storage.connection();
                        translation_jobs::find_latest_completed_by_cache_key(
                            &connection,
                            &cache_key_for_lookup,
                        )?
                    };
                    if let Some(record) = record_opt {
                        if artifact_index
                            .validate_completed_record(&storage, &record)
                            .is_ok()
                        {
                            return Ok(Some(artifact_index.dto_from_record(&storage, record)?));
                        }
                    }
                    Ok(None)
                },
            )
            .await
            .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

            if let Some(dto) = cached_dto {
                return Ok(dto);
            }
        }

        {
            let existing_job_id = {
                let registry = self.inner.registry.lock().await;
                registry.inflight_job_for_cache_key(&prepared.cache_key)
            };
            if let Some(existing_job_id) = existing_job_id {
                // lookup_job 内部访问 SQLite，走 spawn_blocking
                let record_opt = self.lookup_job_async(existing_job_id.clone()).await?;

                if let Some(record) = record_opt {
                    if !is_terminal_status(&record.status) {
                        return Ok(self.inner.artifact_index.dto_from_record_basic(record));
                    }
                }

                let mut registry = self.inner.registry.lock().await;
                registry.remove_cache_key_mapping(&prepared.cache_key, &existing_job_id);
            }
        }

        self.ensure_engine(None, false).await?;

        // 持有 registry 锁期间，SQLite 写入仍走 spawn_blocking 隔离，
        // 这样既保证 queue_len 检查与 register 之间没有并发漏洞，
        // 又避免在 tokio worker 上长期持有 parking_lot::Mutex。
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
            let storage_for_create = self.inner.storage.clone();
            let prepared_for_create = prepared.clone();
            let timestamp_for_create = timestamp.clone();
            let job_record = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
                let connection = storage_for_create.connection();
                Ok(translation_jobs::create(
                    &connection,
                    &translation_jobs::CreateTranslationJobParams {
                        document_id: prepared_for_create.document_id.clone(),
                        engine_job_id: None,
                        cache_key: prepared_for_create.cache_key.clone(),
                        provider: prepared_for_create.provider.clone(),
                        model: prepared_for_create.model.clone(),
                        source_lang: prepared_for_create.source_lang.clone(),
                        target_lang: prepared_for_create.target_lang.clone(),
                        status: "queued".to_string(),
                        stage: "queued".to_string(),
                        progress: 0.0,
                        created_at: timestamp_for_create,
                    },
                )?)
            })
            .await
            .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

            registry.register(job_record.job_id.clone(), prepared);
            let should_spawn = registry.try_mark_worker_running();
            (job_record, should_spawn)
        };

        if job.1 {
            let manager = self.clone();
            async_runtime::spawn(async move {
                manager.dispatch_loop().await;
            });
        }

        Ok(self.inner.artifact_index.dto_from_record_basic(job.0))
    }

    pub fn get_job(&self, job_id: String) -> Result<TranslationJobDto, AppError> {
        let record = self.lookup_job(&job_id)?.ok_or_else(|| {
            AppError::new(AppErrorCode::TranslationFailed, "未找到翻译任务", false)
                .with_detail("jobId", job_id.clone())
        })?;

        self.inner
            .artifact_index
            .dto_from_record_if_completed(&self.inner.storage, record)
    }

    pub async fn cancel_translation(&self, job_id: String) -> Result<bool, AppError> {
        // lookup_job 内部访问 SQLite，走 spawn_blocking
        let initial_record = self.lookup_job_async(job_id.clone()).await?;
        if let Some(record) = initial_record {
            if is_terminal_status(&record.status) {
                return Ok(false);
            }
        }

        // 队列内取消标记是同步操作，但 update_local_job 写入 SQLite，
        // 因此先在 registry 守卫内拿到 cancelled 标志，再走 spawn_blocking 落库。
        let cancelled_in_queue = {
            let mut registry = self.inner.registry.lock().await;
            registry.cancel_queued(&job_id)
        };
        if cancelled_in_queue {
            let manager_for_update = self.clone();
            let job_id_for_update = job_id.clone();
            let finished_at = Utc::now().to_rfc3339();
            tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                manager_for_update.update_local_job(
                    &job_id_for_update,
                    "cancelled",
                    "cancelled",
                    Some("JOB_CANCELLED"),
                    Some("用户在队列中取消了翻译任务"),
                    None,
                    Some(finished_at),
                    Some(0.0),
                )
            })
            .await
            .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;
            return Ok(true);
        }

        let maybe_engine_job_id = {
            let mut registry = self.inner.registry.lock().await;
            registry.mark_cancel_requested(&job_id).flatten()
        };

        if let Some(engine_job_id) = maybe_engine_job_id {
            let _ = self.inner.http_client.cancel_job(&engine_job_id).await;
            return Ok(true);
        }

        // lookup_job 内部访问 SQLite，走 spawn_blocking
        let final_record = self.lookup_job_async(job_id.clone()).await?;
        if let Some(record) = final_record {
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
        let skip_reference_pages = input.skip_reference_pages.unwrap_or(false);

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
            let _ = self
                .update_local_job_async(
                    job_id.clone(),
                    "cancelled".to_string(),
                    "cancelled".to_string(),
                    Some("JOB_CANCELLED".to_string()),
                    Some("任务在调度前被取消".to_string()),
                    None,
                    Some(Utc::now().to_rfc3339()),
                    Some(0.0),
                )
                .await;
            return;
        }

        let started_at = Utc::now().to_rfc3339();
        let _ = self
            .update_local_job_async(
                job_id.clone(),
                "running".to_string(),
                "preflight".to_string(),
                None,
                None,
                Some(started_at.clone()),
                None,
                Some(0.0),
            )
            .await;

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

        let create_response = match self
            .submit_engine_job(&job_id, &create_request, &started_at)
            .await
        {
            Ok(response) => response,
            Err(()) => return,
        };

        // SQLite 写入走 spawn_blocking
        {
            let storage = self.inner.storage.clone();
            let job_id_for_set = job_id.clone();
            let engine_job_id_for_set = create_response.job_id.clone();
            let _ = tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                let connection = storage.connection();
                translation_jobs::set_engine_job_id(
                    &connection,
                    &job_id_for_set,
                    Some(&engine_job_id_for_set),
                )?;
                Ok(())
            })
            .await
            .map_err(|join_err| {
                eprintln!("set_engine_job_id 任务异常退出: {join_err}");
            });
        }
        {
            let mut registry = self.inner.registry.lock().await;
            registry.set_engine_job_id(&job_id, Some(create_response.job_id.clone()));
        }

        let _ = self
            .update_local_job_async(
                job_id.clone(),
                create_response.status.clone(),
                "queued".to_string(),
                None,
                None,
                Some(started_at.clone()),
                None,
                Some(0.0),
            )
            .await;

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
        let mut consecutive_status_poll_failures = 0u32;
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
                Ok(job) => {
                    consecutive_status_poll_failures = 0;
                    job
                }
                Err(error) => {
                    if self
                        .handle_status_poll_failure(
                            &job_id,
                            &engine_job_id,
                            &error,
                            &mut consecutive_status_poll_failures,
                            started_at.clone(),
                        )
                        .await
                        .is_retryable()
                    {
                        sleep(Duration::from_millis(DEFAULT_POLL_INTERVAL_MS)).await;
                        continue;
                    }
                    return;
                }
            };

            // apply_engine_job_status 内部多处访问 SQLite，走 spawn_blocking
            let job_status = job.status.clone();
            if self
                .apply_engine_job_status_async(
                    job_id.clone(),
                    job,
                    document_id.clone(),
                    started_at.clone(),
                )
                .await
                .is_err()
            {
                return;
            }

            if is_terminal_status(&job_status) {
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
                {
                    let mut connection = self.inner.storage.connection();
                    let transaction = connection.transaction()?;
                    if let Some(result) = job.result.as_ref() {
                        self.inner.artifact_index.persist_result_with_connection(
                            &transaction,
                            job_id,
                            document_id,
                            result,
                            &finished_at,
                        )?;
                    }
                    translation_jobs::update_status(
                        &transaction,
                        job_id,
                        "completed",
                        "completed",
                        1.0,
                        None,
                        None,
                        started_at.as_deref(),
                        Some(&finished_at),
                    )?;
                    transaction.commit()?;
                }
                if let Err(error) =
                    cache_eviction::evict_if_needed_excluding(&self.inner.storage, Some(job_id))
                {
                    eprintln!("translation cache eviction failed for job {job_id}: {error}");
                }
                self.emit_completed_event(job_id)?;
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

    async fn handle_status_poll_failure(
        &self,
        job_id: &str,
        engine_job_id: &str,
        error: &AppError,
        consecutive_failures: &mut u32,
        started_at: Option<String>,
    ) -> StatusPollFailureAction {
        if matches!(
            error.code,
            AppErrorCode::EngineUnavailable | AppErrorCode::EngineTimeout
        ) {
            self.inner.supervisor.record_runtime_failure().await;
        }

        if !is_retryable_status_poll_error(error) {
            let final_error = user_facing_status_poll_error(error);
            let _ = self
                .fail_job_async(job_id.to_string(), final_error, started_at)
                .await;
            return StatusPollFailureAction::Failed;
        }

        *consecutive_failures += 1;
        let failure_limit = status_poll_failure_limit(error);
        if *consecutive_failures <= failure_limit {
            eprintln!(
                "翻译任务状态轮询暂时失败，将继续重试, job_id={job_id}, engine_job_id={engine_job_id}, attempt={}/{failure_limit}, code={}, err={}",
                *consecutive_failures,
                error.code.as_contract_str(),
                error
            );
            return StatusPollFailureAction::Retry;
        }

        let final_error = user_facing_status_poll_error(error);
        let _ = self
            .fail_job_async(job_id.to_string(), final_error, started_at)
            .await;
        StatusPollFailureAction::Failed
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
        if status != "completed" {
            if let Some(record) = translation_jobs::get_by_id(&connection, job_id)? {
                let dto = self.inner.artifact_index.dto_from_record_basic(record);
                self.emit_event("translation://job-progress", &dto);
            }
        }
        Ok(())
    }

    /// async 上下文调用 update_local_job 的统一包装：用 spawn_blocking 隔离 SQLite 同步 IO
    #[allow(clippy::too_many_arguments)]
    async fn update_local_job_async(
        &self,
        job_id: String,
        status: String,
        stage: String,
        error_code: Option<String>,
        error_message: Option<String>,
        started_at: Option<String>,
        finished_at: Option<String>,
        progress: Option<f64>,
    ) -> Result<(), AppError> {
        let manager = self.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            manager.update_local_job(
                &job_id,
                &status,
                &stage,
                error_code.as_deref(),
                error_message.as_deref(),
                started_at,
                finished_at,
                progress,
            )
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))?
    }

    /// async 上下文 lookup_job：spawn_blocking 包装
    async fn lookup_job_async(
        &self,
        job_id: String,
    ) -> Result<Option<translation_jobs::TranslationJobRecord>, AppError> {
        let manager = self.clone();
        tokio::task::spawn_blocking(move || -> Result<_, AppError> { manager.lookup_job(&job_id) })
            .await
            .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))?
    }

    /// async 上下文 apply_engine_job_status：spawn_blocking 包装
    async fn apply_engine_job_status_async(
        &self,
        job_id: String,
        job: GetJobResponse,
        document_id: String,
        started_at: Option<String>,
    ) -> Result<(), AppError> {
        let manager = self.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            manager.apply_engine_job_status(&job_id, &job, &document_id, started_at)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))?
    }

    async fn submit_engine_job(
        &self,
        job_id: &str,
        create_request: &CreateJobRequest,
        started_at: &str,
    ) -> Result<CreateJobResponse, ()> {
        match self.inner.http_client.create_job(create_request).await {
            Ok(response) => Ok(response),
            Err(error)
                if matches!(
                    error.code,
                    AppErrorCode::EngineUnavailable | AppErrorCode::EngineTimeout
                ) =>
            {
                if let Err(restart_error) = self.ensure_engine(None, false).await {
                    let _ = self
                        .handle_engine_transport_failure(
                            job_id,
                            &restart_error,
                            Some(started_at.to_string()),
                        )
                        .await;
                    return Err(());
                }

                match self.inner.http_client.create_job(create_request).await {
                    Ok(response) => Ok(response),
                    Err(retry_error) => {
                        let _ = self
                            .handle_engine_transport_failure(
                                job_id,
                                &retry_error,
                                Some(started_at.to_string()),
                            )
                            .await;
                        Err(())
                    }
                }
            }
            Err(error) => {
                let _ = self
                    .handle_engine_transport_failure(job_id, &error, Some(started_at.to_string()))
                    .await;
                Err(())
            }
        }
    }

    fn emit_completed_event(&self, job_id: &str) -> Result<(), AppError> {
        let Some(record) = self.lookup_job(job_id)? else {
            return Ok(());
        };
        let dto = self
            .inner
            .artifact_index
            .dto_from_record(&self.inner.storage, record)?;
        self.emit_event("translation://job-completed", &dto);
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
        // fail_job 内部访问 SQLite，走 spawn_blocking
        let manager = self.clone();
        let job_id_owned = job_id.to_string();
        let error_owned = error.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            manager.fail_job(&job_id_owned, &error_owned, started_at)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))?
    }

    async fn fail_job_async(
        &self,
        job_id: String,
        error: AppError,
        started_at: Option<String>,
    ) -> Result<(), AppError> {
        let manager = self.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            manager.fail_job(&job_id, &error, started_at)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))?
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

enum StatusPollFailureAction {
    Retry,
    Failed,
}

impl StatusPollFailureAction {
    fn is_retryable(&self) -> bool {
        matches!(self, Self::Retry)
    }
}

fn is_retryable_status_poll_error(error: &AppError) -> bool {
    matches!(
        error.code,
        AppErrorCode::EngineUnavailable | AppErrorCode::EngineTimeout
    ) || is_engine_job_not_found(error)
}

fn status_poll_failure_limit(error: &AppError) -> u32 {
    if is_engine_job_not_found(error) {
        MAX_STATUS_POLL_JOB_NOT_FOUND_FAILURES
    } else {
        MAX_STATUS_POLL_TRANSPORT_FAILURES
    }
}

fn is_engine_job_not_found(error: &AppError) -> bool {
    error
        .details
        .as_ref()
        .and_then(|details| details.get("engineCode"))
        .and_then(|value| value.as_str())
        .is_some_and(|code| code == "JOB_NOT_FOUND")
}

fn user_facing_status_poll_error(error: &AppError) -> AppError {
    if is_engine_job_not_found(error) {
        return AppError::new(
            AppErrorCode::TranslationFailed,
            "翻译引擎重启后丢失了任务状态，请重新发起翻译",
            false,
        )
        .with_detail("engineCode", "JOB_NOT_FOUND");
    }

    if matches!(
        error.code,
        AppErrorCode::EngineUnavailable | AppErrorCode::EngineTimeout
    ) {
        return AppError::new(
            error.code,
            "翻译引擎连接持续中断，任务状态无法确认，请稍后重新发起翻译",
            true,
        );
    }

    AppError::new(error.code, error.message.clone(), error.retryable)
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
    use std::{path::PathBuf, sync::Arc};

    use chrono::Utc;
    use parking_lot::Mutex as ParkingMutex;
    use uuid::Uuid;

    use crate::{
        errors::{AppError, AppErrorCode},
        ipc::translation::TranslationEngineStatus,
        keychain::KeychainService,
        models::DocumentSourceType,
        storage::{documents, translation_jobs, Storage},
    };

    use super::{
        http_client::GetJobResponse, normalize_output_mode, StatusPollFailureAction,
        TranslationManager, MAX_STATUS_POLL_TRANSPORT_FAILURES,
    };

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

    #[tokio::test]
    async fn status_poll_transient_errors_do_not_fail_job_before_completed_status() {
        let (manager, storage, job_id, document_id) = setup_manager_with_running_job();
        let started_at = Some(Utc::now().to_rfc3339());
        let mut consecutive_failures = 0;
        let error = AppError::new(
            AppErrorCode::EngineUnavailable,
            "翻译引擎暂时无法连接，正在尝试恢复",
            true,
        );

        for _ in 0..3 {
            let action = manager
                .handle_status_poll_failure(
                    &job_id,
                    "engine-job-1",
                    &error,
                    &mut consecutive_failures,
                    started_at.clone(),
                )
                .await;
            assert!(matches!(action, StatusPollFailureAction::Retry));
            let record = lookup_test_job(&storage, &job_id);
            assert_eq!(record.status, "running");
            assert_eq!(record.stage, "preflight");
            assert!(record.error_message.is_none());
        }

        manager
            .apply_engine_job_status(
                &job_id,
                &GetJobResponse {
                    job_id: "engine-job-1".to_string(),
                    document_id: Some(document_id.clone()),
                    status: "completed".to_string(),
                    stage: Some("completed".to_string()),
                    progress: Some(1.0),
                    queue_position: None,
                    current_page: None,
                    total_pages: None,
                    provider: None,
                    model: None,
                    started_at: started_at.clone(),
                    updated_at: Some(Utc::now().to_rfc3339()),
                    result: None,
                    error: None,
                },
                &document_id,
                started_at,
            )
            .expect("completed status should apply after transient poll errors");

        let record = lookup_test_job(&storage, &job_id);
        assert_eq!(record.status, "completed");
        assert_eq!(record.stage, "completed");
        assert_eq!(record.progress, 1.0);
        assert!(record.error_message.is_none());
    }

    #[tokio::test]
    async fn status_poll_persistent_connection_errors_fail_with_clear_message() {
        let (manager, storage, job_id, _document_id) = setup_manager_with_running_job();
        let started_at = Some(Utc::now().to_rfc3339());
        let mut consecutive_failures = 0;
        let error = AppError::new(
            AppErrorCode::EngineUnavailable,
            "翻译引擎暂时无法连接，正在尝试恢复",
            true,
        )
        .with_detail(
            "transportError",
            "error sending request for url (http://127.0.0.1:8890/v1/jobs/demo)",
        );

        for _ in 0..MAX_STATUS_POLL_TRANSPORT_FAILURES {
            let action = manager
                .handle_status_poll_failure(
                    &job_id,
                    "engine-job-1",
                    &error,
                    &mut consecutive_failures,
                    started_at.clone(),
                )
                .await;
            assert!(matches!(action, StatusPollFailureAction::Retry));
        }

        let action = manager
            .handle_status_poll_failure(
                &job_id,
                "engine-job-1",
                &error,
                &mut consecutive_failures,
                started_at,
            )
            .await;
        assert!(matches!(action, StatusPollFailureAction::Failed));

        let record = lookup_test_job(&storage, &job_id);
        assert_eq!(record.status, "failed");
        assert_eq!(record.stage, "failed");
        assert_eq!(record.error_code.as_deref(), Some("ENGINE_UNAVAILABLE"));
        let message = record.error_message.expect("failed job should store message");
        assert!(message.contains("翻译引擎连接持续中断"));
        assert!(!message.contains("http://127.0.0.1"));
        assert!(!message.contains("error sending request"));
    }

    #[tokio::test]
    async fn status_poll_recent_engine_job_not_found_is_retried_before_clear_failure() {
        let (manager, storage, job_id, _document_id) = setup_manager_with_running_job();
        let started_at = Some(Utc::now().to_rfc3339());
        let mut consecutive_failures = 0;
        let error = AppError::new(AppErrorCode::TranslationFailed, "未找到任务: engine-job-1", false)
            .with_detail("engineCode", "JOB_NOT_FOUND");

        let action = manager
            .handle_status_poll_failure(
                &job_id,
                "engine-job-1",
                &error,
                &mut consecutive_failures,
                started_at.clone(),
            )
            .await;
        assert!(matches!(action, StatusPollFailureAction::Retry));
        assert_eq!(lookup_test_job(&storage, &job_id).status, "running");

        while matches!(
            manager
                .handle_status_poll_failure(
                    &job_id,
                    "engine-job-1",
                    &error,
                    &mut consecutive_failures,
                    started_at.clone(),
                )
                .await,
            StatusPollFailureAction::Retry
        ) {}

        let record = lookup_test_job(&storage, &job_id);
        assert_eq!(record.status, "failed");
        let message = record.error_message.expect("job-not-found should explain recovery");
        assert!(message.contains("丢失了任务状态"));
        assert!(!message.contains("未找到任务: engine-job-1"));
    }

    fn setup_manager_with_running_job() -> (
        TranslationManager,
        Storage,
        String,
        String,
    ) {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let data_dir = unique_test_dir();
        let status = Arc::new(ParkingMutex::new(TranslationEngineStatus {
            running: false,
            pid: None,
            port: 8890,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let manager = TranslationManager::new(
            data_dir,
            storage.clone(),
            KeychainService::default(),
            status,
        )
        .expect("manager should initialize");
        let timestamp = Utc::now().to_rfc3339();
        let document = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: format!("/tmp/{}.pdf", Uuid::new_v4()),
                    file_sha256: Uuid::new_v4().to_string(),
                    title: "Demo".to_string(),
                    page_count: 1,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .expect("document should insert")
        };
        let job = {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document.document_id.clone(),
                    engine_job_id: Some("engine-job-1".to_string()),
                    cache_key: Uuid::new_v4().to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "running".to_string(),
                    stage: "preflight".to_string(),
                    progress: 0.0,
                    created_at: timestamp,
                },
            )
            .expect("translation job should insert")
        };

        (manager, storage, job.job_id, document.document_id)
    }

    fn lookup_test_job(storage: &Storage, job_id: &str) -> translation_jobs::TranslationJobRecord {
        let connection = storage.connection();
        translation_jobs::get_by_id(&connection, job_id)
            .expect("job lookup should succeed")
            .expect("job should exist")
    }

    fn unique_test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("rastro-translation-test-{}", Uuid::new_v4()))
    }
}
