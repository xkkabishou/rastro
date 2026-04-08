// 加密文件凭据存储（替代 macOS Keychain，避免未签名 app 反复弹窗）
//
// 使用 AES-256-GCM 加密 API Key，密钥从机器唯一标识派生。
// 凭据存储在 data_dir/credentials.json 中。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use parking_lot::Mutex;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};

use crate::errors::AppError;

/// 加密后的凭据条目
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct CredentialEntry {
    /// base64 编码的 nonce (12 bytes)
    nonce: String,
    /// base64 编码的密文 (plaintext + 16 bytes tag)
    ciphertext: String,
}

type CredentialStore = HashMap<String, CredentialEntry>;

/// Provider API Key 管理器（加密文件存储 + 内存缓存）
#[derive(Debug, Clone)]
pub struct KeychainService {
    /// 内存缓存：account → Option<api_key>
    cache: Arc<Mutex<HashMap<String, Option<String>>>>,
    /// 凭据文件路径
    credentials_path: PathBuf,
    /// AES-256 密钥（从机器 UUID 派生）
    derived_key: [u8; 32],
}

impl Default for KeychainService {
    fn default() -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            credentials_path: PathBuf::from("credentials.json"),
            derived_key: [0u8; 32],
        }
    }
}

impl KeychainService {
    /// 创建凭据服务实例
    pub fn new(data_dir: &std::path::Path) -> Self {
        let credentials_path = data_dir.join("credentials.json");
        let machine_id = get_machine_id();
        let derived_key = derive_key(&machine_id);

        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            credentials_path,
            derived_key,
        }
    }

    fn account(provider: &str) -> String {
        format!("provider:{provider}")
    }

    /// 写入 Provider API Key
    pub fn save_key(&self, provider: &str, api_key: &str) -> Result<(), AppError> {
        let account = Self::account(provider);
        let entry = self.encrypt(api_key)?;

        let mut store = self.load_store();
        store.insert(account, entry);
        self.save_store(&store)?;

        // 同步更新缓存
        self.cache
            .lock()
            .insert(provider.to_string(), Some(api_key.to_string()));

        Ok(())
    }

    /// 读取 Provider API Key（优先从内存缓存读取）
    pub fn get_key(&self, provider: &str) -> Result<Option<String>, AppError> {
        // 先查缓存
        {
            let cache = self.cache.lock();
            if let Some(cached) = cache.get(provider) {
                return Ok(cached.clone());
            }
        }

        // 缓存未命中，从文件读取
        let result = self.read_from_file(provider)?;

        // 写入缓存
        self.cache
            .lock()
            .insert(provider.to_string(), result.clone());

        Ok(result)
    }

    /// 从加密文件读取
    fn read_from_file(&self, provider: &str) -> Result<Option<String>, AppError> {
        let store = self.load_store();
        let account = Self::account(provider);

        match store.get(&account) {
            Some(entry) => {
                let plaintext = self.decrypt(entry)?;
                Ok(Some(plaintext))
            }
            None => Ok(None),
        }
    }

    /// 删除 Provider API Key
    pub fn delete_key(&self, provider: &str) -> Result<bool, AppError> {
        let account = Self::account(provider);
        let mut store = self.load_store();

        let existed = store.remove(&account).is_some();
        if existed {
            self.save_store(&store)?;
        }

        // 从缓存中移除
        self.cache.lock().remove(provider);

        Ok(existed)
    }

    /// 生成脱敏后的 Key 摘要
    pub fn mask_key(&self, api_key: &str) -> String {
        if api_key.len() <= 6 {
            return "*".repeat(api_key.len());
        }

        let prefix = &api_key[..3];
        let suffix = &api_key[api_key.len() - 3..];
        format!("{prefix}...{suffix}")
    }

    /// 返回凭据服务可用性
    pub fn is_available(&self) -> bool {
        true
    }

    /// 从 macOS Keychain 迁移已有凭据到加密文件存储（一次性）
    ///
    /// 如果 credentials.json 已有内容则跳过，避免重复迁移。
    pub fn migrate_from_macos_keychain(&self) {
        // 已有凭据文件且非空，跳过迁移
        if !self.load_store().is_empty() {
            return;
        }

        #[cfg(target_os = "macos")]
        {
            const KEYCHAIN_SERVICE: &str = "com.rastro.ai";
            // 主 provider + 翻译 provider
            let accounts = [
                "openai",
                "claude",
                "gemini",
                "translation_openai",
                "translation_claude",
                "translation_gemini",
            ];

            let mut migrated = 0u32;
            for provider in &accounts {
                let keychain_account = format!("provider:{provider}");
                match security_framework::passwords::get_generic_password(
                    KEYCHAIN_SERVICE,
                    &keychain_account,
                ) {
                    Ok(password) => {
                        let api_key = String::from_utf8_lossy(&password).to_string();
                        if let Err(e) = self.save_key(provider, &api_key) {
                            eprintln!("[keychain-migration] 迁移 {provider} 失败: {e}");
                        } else {
                            migrated += 1;
                        }
                    }
                    Err(_) => {
                        // key 不存在或读取失败，跳过
                    }
                }
            }

            if migrated > 0 {
                eprintln!("[keychain-migration] 已从 macOS Keychain 迁移 {migrated} 个凭据");
            }
        }
    }

    // ── 内部方法 ──

    fn encrypt(&self, plaintext: &str) -> Result<CredentialEntry, AppError> {
        let rng = SystemRandom::new();
        let mut nonce_bytes = [0u8; 12];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| AppError::internal("生成随机 nonce 失败"))?;

        let key = UnboundKey::new(&AES_256_GCM, &self.derived_key)
            .map_err(|_| AppError::internal("创建加密密钥失败"))?;
        let key = LessSafeKey::new(key);

        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        let mut in_out = plaintext.as_bytes().to_vec();
        key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
            .map_err(|_| AppError::internal("加密凭据失败"))?;

        Ok(CredentialEntry {
            nonce: B64.encode(nonce_bytes),
            ciphertext: B64.encode(&in_out),
        })
    }

    fn decrypt(&self, entry: &CredentialEntry) -> Result<String, AppError> {
        let nonce_bytes = B64
            .decode(&entry.nonce)
            .map_err(|_| AppError::internal("解码 nonce 失败"))?;
        let mut ciphertext = B64
            .decode(&entry.ciphertext)
            .map_err(|_| AppError::internal("解码密文失败"))?;

        let nonce_arr: [u8; 12] = nonce_bytes
            .try_into()
            .map_err(|_| AppError::internal("nonce 长度不正确"))?;

        let key = UnboundKey::new(&AES_256_GCM, &self.derived_key)
            .map_err(|_| AppError::internal("创建解密密钥失败"))?;
        let key = LessSafeKey::new(key);

        let nonce = Nonce::assume_unique_for_key(nonce_arr);
        let plaintext = key
            .open_in_place(nonce, Aad::empty(), &mut ciphertext)
            .map_err(|_| AppError::internal("解密凭据失败，密钥可能已变更"))?;

        String::from_utf8(plaintext.to_vec())
            .map_err(|_| AppError::internal("解密后的凭据不是有效 UTF-8"))
    }

    fn load_store(&self) -> CredentialStore {
        fs::read_to_string(&self.credentials_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }

    fn save_store(&self, store: &CredentialStore) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(store)
            .map_err(|e| AppError::internal(format!("序列化凭据失败: {e}")))?;
        fs::write(&self.credentials_path, json)
            .map_err(|e| AppError::internal(format!("写入凭据文件失败: {e}")))?;
        Ok(())
    }
}

/// 从机器唯一标识派生 AES-256 密钥
fn derive_key(machine_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"rastro-credential-key-v1:");
    hasher.update(machine_id.as_bytes());
    hasher.finalize().into()
}

/// 获取机器唯一标识
fn get_machine_id() -> String {
    #[cfg(target_os = "macos")]
    {
        // macOS: 通过 ioreg 获取 hardware UUID
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        return uuid.to_string();
                    }
                }
            }
        }
    }

    // fallback: 使用 hostname + username
    let hostname = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string());
    let user = std::env::var("USER").unwrap_or_else(|_| "unknown-user".to_string());
    format!("{hostname}:{user}")
}

#[cfg(test)]
mod tests {
    use super::KeychainService;

    #[test]
    fn mask_key_keeps_prefix_and_suffix() {
        let service = KeychainService::default();
        assert_eq!(service.mask_key("sk-test123"), "sk-...123");
        assert_eq!(service.mask_key("short"), "*****");
    }

    #[test]
    fn cache_returns_previously_set_value() {
        let service = KeychainService::default();
        service
            .cache
            .lock()
            .insert("test_provider".to_string(), Some("sk-cached".to_string()));
        let result = service.get_key("test_provider").unwrap();
        assert_eq!(result, Some("sk-cached".to_string()));
    }

    #[test]
    fn cache_returns_none_for_absent_key() {
        let service = KeychainService::default();
        service
            .cache
            .lock()
            .insert("empty_provider".to_string(), None);
        let result = service.get_key("empty_provider").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let dir = std::env::temp_dir().join("rastro-test-keychain");
        let _ = std::fs::create_dir_all(&dir);
        let service = KeychainService::new(&dir);

        service.save_key("openai", "sk-test-key-12345").unwrap();

        // 清缓存，强制从文件读
        service.cache.lock().clear();

        let result = service.get_key("openai").unwrap();
        assert_eq!(result, Some("sk-test-key-12345".to_string()));

        // 清理
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_key_removes_entry() {
        let dir = std::env::temp_dir().join("rastro-test-keychain-del");
        let _ = std::fs::create_dir_all(&dir);
        let service = KeychainService::new(&dir);

        service.save_key("gemini", "key-abc").unwrap();
        let removed = service.delete_key("gemini").unwrap();
        assert!(removed);

        service.cache.lock().clear();
        let result = service.get_key("gemini").unwrap();
        assert_eq!(result, None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
