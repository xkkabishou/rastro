// 全局应用状态
#![allow(dead_code)]

use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};

use parking_lot::Mutex;

use crate::{
    ai_integration::AiIntegration,
    errors::AppError,
    ipc::{translation::TranslationEngineStatus, zotero::ZoteroStatusDto},
    keychain::KeychainService,
    storage::Storage,
    translation_manager::TranslationManager,
};

/// Tauri 全局状态
#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub storage: Storage,
    pub keychain: KeychainService,
    pub ai_integration: AiIntegration,
    pub translation_manager: TranslationManager,
    pub translation_status: Arc<Mutex<TranslationEngineStatus>>,
    pub zotero_status: Arc<Mutex<ZoteroStatusDto>>,
    pub runtime_flags: Arc<Mutex<HashMap<String, String>>>,
}

impl AppState {
    /// 初始化应用运行所需的目录、数据库和服务单例
    pub fn initialize() -> Result<Self, AppError> {
        let data_dir = dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("com.rastro.app");

        fs::create_dir_all(&data_dir)?;

        let storage = Storage::new_file(data_dir.join("app.db"))?;
        let keychain = KeychainService::new();
        let ai_integration = AiIntegration::new(storage.clone(), keychain.clone());
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
        )?;

        Ok(Self {
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
        })
    }

    /// 返回应用数据库文件路径
    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("app.db")
    }
}
