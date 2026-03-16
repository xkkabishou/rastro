// macOS Keychain 凭据读写（带内存缓存，避免开发模式重复弹窗）
use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::errors::AppError;

const SERVICE_NAME: &str = "com.rastro.ai";

/// Provider API Key 管理器（内存缓存 + Keychain）
///
/// 开发模式下每次 `tauri dev` 重编译会改变二进制签名，
/// 导致 macOS Keychain 反复弹出授权对话框。
/// 通过内存缓存，每个 key 在一次应用生命周期内只读取 Keychain 一次。
#[derive(Debug, Clone, Default)]
pub struct KeychainService {
    /// 内存缓存：provider → Option<api_key>
    /// None 表示尚未从 Keychain 读取，Some(None) 表示确认不存在
    cache: Arc<Mutex<HashMap<String, Option<String>>>>,
}

impl KeychainService {
    /// 创建 Keychain 服务实例
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn account(provider: &str) -> String {
        format!("provider:{provider}")
    }

    /// 写入 Provider API Key
    pub fn save_key(&self, provider: &str, api_key: &str) -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            security_framework::passwords::set_generic_password(
                SERVICE_NAME,
                &Self::account(provider),
                api_key.as_bytes(),
            )
            .map_err(|error| {
                AppError::internal(format!("写入 Keychain 失败: {error}"))
                    .with_detail("provider", provider)
            })?;

            // 同步更新缓存
            self.cache
                .lock()
                .insert(provider.to_string(), Some(api_key.to_string()));

            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (provider, api_key);
            Err(AppError::new(
                crate::errors::AppErrorCode::InternalError,
                "当前平台不支持 macOS Keychain",
                false,
            ))
        }
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

        // 缓存未命中，从 Keychain 读取
        let result = self.read_from_keychain(provider)?;

        // 写入缓存
        self.cache
            .lock()
            .insert(provider.to_string(), result.clone());

        Ok(result)
    }

    /// 直接从 Keychain 读取（不走缓存）
    fn read_from_keychain(&self, provider: &str) -> Result<Option<String>, AppError> {
        #[cfg(target_os = "macos")]
        {
            match security_framework::passwords::get_generic_password(
                SERVICE_NAME,
                &Self::account(provider),
            ) {
                Ok(password) => Ok(Some(String::from_utf8_lossy(&password).to_string())),
                Err(error) => {
                    let message = error.to_string();
                    let lower = message.to_lowercase();
                    if message.contains("-25300")
                        || lower.contains("not found")
                        || lower.contains("could not be found")
                    {
                        Ok(None)
                    } else {
                        Err(AppError::internal(format!("读取 Keychain 失败: {error}"))
                            .with_detail("provider", provider))
                    }
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = provider;
            Ok(None)
        }
    }

    /// 删除 Provider API Key
    pub fn delete_key(&self, provider: &str) -> Result<bool, AppError> {
        #[cfg(target_os = "macos")]
        {
            if self.get_key(provider)?.is_none() {
                return Ok(false);
            }

            security_framework::passwords::delete_generic_password(
                SERVICE_NAME,
                &Self::account(provider),
            )
            .map_err(|error| {
                AppError::internal(format!("删除 Keychain 项失败: {error}"))
                    .with_detail("provider", provider)
            })?;

            // 从缓存中移除
            self.cache.lock().remove(provider);

            Ok(true)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = provider;
            Ok(false)
        }
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

    /// 返回当前平台的 Keychain 可用性
    pub fn is_available(&self) -> bool {
        cfg!(target_os = "macos")
    }
}

#[cfg(test)]
mod tests {
    use super::KeychainService;

    #[test]
    fn mask_key_keeps_prefix_and_suffix() {
        let service = KeychainService::new();
        assert_eq!(service.mask_key("sk-test123"), "sk-...123");
        assert_eq!(service.mask_key("short"), "*****");
    }

    #[test]
    fn cache_returns_previously_set_value() {
        let service = KeychainService::new();
        // 手动写入缓存模拟
        service
            .cache
            .lock()
            .insert("test_provider".to_string(), Some("sk-cached".to_string()));
        let result = service.get_key("test_provider").unwrap();
        assert_eq!(result, Some("sk-cached".to_string()));
    }

    #[test]
    fn cache_returns_none_for_absent_key() {
        let service = KeychainService::new();
        service
            .cache
            .lock()
            .insert("empty_provider".to_string(), None);
        let result = service.get_key("empty_provider").unwrap();
        assert_eq!(result, None);
    }
}
