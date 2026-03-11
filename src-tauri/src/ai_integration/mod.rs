// AI Provider 集成入口
pub mod chat_service;
pub mod provider_registry;
pub mod summary_service;
pub mod usage_meter;

use std::{collections::HashMap, sync::Arc, time::Duration};

use parking_lot::Mutex;
use reqwest::Client;
use tokio_util::sync::CancellationToken;

use crate::{
    errors::AppError,
    keychain::KeychainService,
    models::{ProviderId, SummaryPromptProfile},
    storage::Storage,
};

/// 活跃流注册表
pub type StreamRegistry = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// ask_ai 领域请求
#[derive(Debug, Clone)]
pub struct AskAiRequest {
    pub document_id: String,
    pub session_id: Option<String>,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub user_message: String,
    pub context_quote: Option<String>,
}

/// generate_summary 领域请求
#[derive(Debug, Clone)]
pub struct GenerateSummaryRequest {
    pub document_id: String,
    pub file_path: String,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub prompt_profile: SummaryPromptProfile,
}

/// 统一流式句柄
#[derive(Debug, Clone)]
pub struct StreamHandleResult {
    pub stream_id: String,
    pub session_id: String,
    pub provider: ProviderId,
    pub model: String,
    pub started_at: String,
}

/// Provider 连接测试结果
#[derive(Debug, Clone)]
pub struct ProviderConnectivityResult {
    pub provider: ProviderId,
    pub model: String,
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// AI 集成单例
#[derive(Clone)]
pub struct AiIntegration {
    pub client: Client,
    pub storage: Storage,
    pub keychain: KeychainService,
    pub stream_registry: StreamRegistry,
}

impl AiIntegration {
    /// 构建带默认超时的 HTTP client
    pub fn new(storage: Storage, keychain: KeychainService) -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("reqwest client should build");

        Self {
            client,
            storage,
            keychain,
            stream_registry: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 启动问答流
    pub async fn ask<R: tauri::Runtime + 'static>(
        &self,
        app: tauri::AppHandle<R>,
        input: AskAiRequest,
    ) -> Result<StreamHandleResult, AppError> {
        chat_service::start_chat(app, self.clone(), input).await
    }

    /// 启动总结流
    pub async fn generate_summary<R: tauri::Runtime + 'static>(
        &self,
        app: tauri::AppHandle<R>,
        input: GenerateSummaryRequest,
    ) -> Result<StreamHandleResult, AppError> {
        summary_service::start_summary(app, self.clone(), input).await
    }

    /// 取消指定流
    pub fn cancel_stream(&self, stream_id: &str) -> bool {
        if let Some(token) = self.stream_registry.lock().remove(stream_id) {
            token.cancel();
            return true;
        }

        false
    }

    /// 执行 Provider 连通性测试
    pub async fn test_connection(
        &self,
        provider: ProviderId,
        model: Option<String>,
    ) -> Result<ProviderConnectivityResult, AppError> {
        provider_registry::test_connection(self, provider, model).await
    }
}
