// macOS Keychain 凭据读写
use crate::errors::AppError;

const SERVICE_NAME: &str = "com.rastro.ai";

/// Provider API Key 管理器
#[derive(Debug, Clone, Default)]
pub struct KeychainService;

impl KeychainService {
    /// 创建 Keychain 服务实例
    pub fn new() -> Self {
        Self
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
            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (provider, api_key);
            Err(AppError::new(
                AppErrorCode::InternalError,
                "当前平台不支持 macOS Keychain",
                false,
            ))
        }
    }

    /// 读取 Provider API Key
    pub fn get_key(&self, provider: &str) -> Result<Option<String>, AppError> {
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
}
