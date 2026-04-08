// 全局应用状态

use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};

use parking_lot::Mutex;

use crate::{
    ai_integration::AiIntegration,
    errors::AppError,
    ipc::{
        notebooklm::NotebookLMEngineStatus, translation::TranslationEngineStatus,
        zotero::ZoteroStatusDto,
    },
    keychain::KeychainService,
    notebooklm_manager::NotebookLMManager,
    storage::Storage,
    translation_manager::TranslationManager,
};

/// Tauri 全局状态
#[derive(Clone)]
pub struct AppState {
    #[allow(dead_code)] // initialize() 中设置，后续功能将使用
    pub data_dir: PathBuf,
    pub storage: Storage,
    pub keychain: KeychainService,
    pub ai_integration: AiIntegration,
    pub translation_manager: TranslationManager,
    pub translation_status: Arc<Mutex<TranslationEngineStatus>>,
    pub notebooklm_manager: NotebookLMManager,
    #[allow(dead_code)] // 为 NotebookLM 引擎管理预留
    pub notebooklm_status: Arc<Mutex<NotebookLMEngineStatus>>,
    pub zotero_status: Arc<Mutex<ZoteroStatusDto>>,
    #[allow(dead_code)] // 运行时动态标志位，后续功能将使用
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
        let keychain = KeychainService::new(&data_dir);
        keychain.migrate_from_macos_keychain();
        let ai_integration = AiIntegration::new(storage.clone(), keychain.clone())?;
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
        let notebooklm_status = Arc::new(Mutex::new(NotebookLMEngineStatus {
            running: false,
            pid: None,
            port: 8891,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let notebooklm_manager =
            NotebookLMManager::new(data_dir.clone(), notebooklm_status.clone())?;

        Ok(Self {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            notebooklm_manager,
            notebooklm_status,
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
    #[allow(dead_code)] // 调试工具方法
    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("app.db")
    }
}
