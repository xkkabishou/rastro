// Rastro 后端错误模型
// 与 src/shared/types.ts 中的 AppError / AppErrorCode 一一对应
#![allow(dead_code)]

use serde::Serialize;
use std::collections::HashMap;

/// 应用错误码（共 17 个，与 TypeScript AppErrorCode 对齐）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    // 文档相关
    DocumentNotFound,
    DocumentUnsupported,
    // 翻译引擎相关
    EngineUnavailable,
    EnginePortConflict,
    EngineTimeout,
    // Python 环境相关 (Challenge H4)
    PythonNotFound,
    PythonVersionMismatch,
    PdfmathtranslateNotInstalled,
    // 翻译任务相关
    TranslationFailed,
    TranslationCancelled,
    // AI Provider 相关
    ProviderKeyMissing,
    ProviderConnectionFailed,
    ProviderRateLimited,
    ProviderInsufficientCredit,
    UnsupportedTranslationProvider,
    // Zotero 相关
    ZoteroNotFound,
    ZoteroDbLocked,
    // 缓存相关
    CacheCorrupted,
    // 通用
    InternalError,
}

/// 统一错误对象——所有 Command 失败时返回此类型
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    /// 错误码
    pub code: AppErrorCode,
    /// 用户可读的错误信息
    pub message: String,
    /// 是否可重试
    pub retryable: bool,
    /// 附加诊断信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,
}

impl AppError {
    /// 创建一个新的应用错误
    pub fn new(code: AppErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            details: None,
        }
    }

    /// 内部错误快捷构造
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InternalError, message, false)
    }

    /// 按需追加诊断字段
    pub fn with_detail(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        let details = self.details.get_or_insert_with(HashMap::new);
        details.insert(key.into(), value.into());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::internal(format!("SQLite 错误: {value}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::internal(format!("I/O 错误: {value}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        Self::new(
            AppErrorCode::ProviderConnectionFailed,
            format!("HTTP 请求失败: {value}"),
            true,
        )
    }
}
