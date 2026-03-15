// Rastro 后端错误模型
// 与 src/shared/types.ts 中的 AppError / AppErrorCode 一一对应
#![allow(dead_code)]

use serde::Serialize;
use std::collections::HashMap;

/// 应用错误码（与 TypeScript AppErrorCode 对齐）
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
    // NotebookLM 相关
    NotebooklmAuthRequired,
    NotebooklmAuthExpired,
    NotebooklmEngineUnavailable,
    NotebooklmUploadFailed,
    NotebooklmGenerationFailed,
    NotebooklmDownloadFailed,
    NotebooklmRateLimited,
    NotebooklmUnknown,
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
    // 安全与校验
    InvalidProviderBaseUrl,
    ResourceOwnershipMismatch,
    // 精确语义替代
    ProviderNotConfigured,
    ChatSessionNotFound,
    // 通用
    InternalError,
}

impl AppErrorCode {
    /// 返回与 serde SCREAMING_SNAKE_CASE 序列化一致的稳定字符串，
    /// 用于数据库持久化等需要稳定格式的场景。
    pub fn as_contract_str(&self) -> &'static str {
        match self {
            Self::DocumentNotFound => "DOCUMENT_NOT_FOUND",
            Self::DocumentUnsupported => "DOCUMENT_UNSUPPORTED",
            Self::EngineUnavailable => "ENGINE_UNAVAILABLE",
            Self::EnginePortConflict => "ENGINE_PORT_CONFLICT",
            Self::EngineTimeout => "ENGINE_TIMEOUT",
            Self::PythonNotFound => "PYTHON_NOT_FOUND",
            Self::PythonVersionMismatch => "PYTHON_VERSION_MISMATCH",
            Self::PdfmathtranslateNotInstalled => "PDFMATHTRANSLATE_NOT_INSTALLED",
            Self::NotebooklmAuthRequired => "NOTEBOOKLM_AUTH_REQUIRED",
            Self::NotebooklmAuthExpired => "NOTEBOOKLM_AUTH_EXPIRED",
            Self::NotebooklmEngineUnavailable => "NOTEBOOKLM_ENGINE_UNAVAILABLE",
            Self::NotebooklmUploadFailed => "NOTEBOOKLM_UPLOAD_FAILED",
            Self::NotebooklmGenerationFailed => "NOTEBOOKLM_GENERATION_FAILED",
            Self::NotebooklmDownloadFailed => "NOTEBOOKLM_DOWNLOAD_FAILED",
            Self::NotebooklmRateLimited => "NOTEBOOKLM_RATE_LIMITED",
            Self::NotebooklmUnknown => "NOTEBOOKLM_UNKNOWN",
            Self::TranslationFailed => "TRANSLATION_FAILED",
            Self::TranslationCancelled => "TRANSLATION_CANCELLED",
            Self::ProviderKeyMissing => "PROVIDER_KEY_MISSING",
            Self::ProviderConnectionFailed => "PROVIDER_CONNECTION_FAILED",
            Self::ProviderRateLimited => "PROVIDER_RATE_LIMITED",
            Self::ProviderInsufficientCredit => "PROVIDER_INSUFFICIENT_CREDIT",
            Self::UnsupportedTranslationProvider => "UNSUPPORTED_TRANSLATION_PROVIDER",
            Self::ZoteroNotFound => "ZOTERO_NOT_FOUND",
            Self::ZoteroDbLocked => "ZOTERO_DB_LOCKED",
            Self::CacheCorrupted => "CACHE_CORRUPTED",
            Self::InvalidProviderBaseUrl => "INVALID_PROVIDER_BASE_URL",
            Self::ResourceOwnershipMismatch => "RESOURCE_OWNERSHIP_MISMATCH",
            Self::ProviderNotConfigured => "PROVIDER_NOT_CONFIGURED",
            Self::ChatSessionNotFound => "CHAT_SESSION_NOT_FOUND",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

/// 统一错误对象——所有 Command 失败时返回此类型
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[cfg(test)]
mod tests {
    use super::{AppError, AppErrorCode};

    const ALL_ERROR_CODES: &[(AppErrorCode, &str)] = &[
        (AppErrorCode::DocumentNotFound, "DOCUMENT_NOT_FOUND"),
        (AppErrorCode::DocumentUnsupported, "DOCUMENT_UNSUPPORTED"),
        (AppErrorCode::EngineUnavailable, "ENGINE_UNAVAILABLE"),
        (AppErrorCode::EnginePortConflict, "ENGINE_PORT_CONFLICT"),
        (AppErrorCode::EngineTimeout, "ENGINE_TIMEOUT"),
        (AppErrorCode::PythonNotFound, "PYTHON_NOT_FOUND"),
        (
            AppErrorCode::PythonVersionMismatch,
            "PYTHON_VERSION_MISMATCH",
        ),
        (
            AppErrorCode::PdfmathtranslateNotInstalled,
            "PDFMATHTRANSLATE_NOT_INSTALLED",
        ),
        (
            AppErrorCode::NotebooklmAuthRequired,
            "NOTEBOOKLM_AUTH_REQUIRED",
        ),
        (
            AppErrorCode::NotebooklmAuthExpired,
            "NOTEBOOKLM_AUTH_EXPIRED",
        ),
        (
            AppErrorCode::NotebooklmEngineUnavailable,
            "NOTEBOOKLM_ENGINE_UNAVAILABLE",
        ),
        (
            AppErrorCode::NotebooklmUploadFailed,
            "NOTEBOOKLM_UPLOAD_FAILED",
        ),
        (
            AppErrorCode::NotebooklmGenerationFailed,
            "NOTEBOOKLM_GENERATION_FAILED",
        ),
        (
            AppErrorCode::NotebooklmDownloadFailed,
            "NOTEBOOKLM_DOWNLOAD_FAILED",
        ),
        (
            AppErrorCode::NotebooklmRateLimited,
            "NOTEBOOKLM_RATE_LIMITED",
        ),
        (AppErrorCode::NotebooklmUnknown, "NOTEBOOKLM_UNKNOWN"),
        (AppErrorCode::TranslationFailed, "TRANSLATION_FAILED"),
        (AppErrorCode::TranslationCancelled, "TRANSLATION_CANCELLED"),
        (AppErrorCode::ProviderKeyMissing, "PROVIDER_KEY_MISSING"),
        (
            AppErrorCode::ProviderConnectionFailed,
            "PROVIDER_CONNECTION_FAILED",
        ),
        (AppErrorCode::ProviderRateLimited, "PROVIDER_RATE_LIMITED"),
        (
            AppErrorCode::ProviderInsufficientCredit,
            "PROVIDER_INSUFFICIENT_CREDIT",
        ),
        (
            AppErrorCode::UnsupportedTranslationProvider,
            "UNSUPPORTED_TRANSLATION_PROVIDER",
        ),
        (AppErrorCode::ZoteroNotFound, "ZOTERO_NOT_FOUND"),
        (AppErrorCode::ZoteroDbLocked, "ZOTERO_DB_LOCKED"),
        (AppErrorCode::CacheCorrupted, "CACHE_CORRUPTED"),
        (
            AppErrorCode::InvalidProviderBaseUrl,
            "INVALID_PROVIDER_BASE_URL",
        ),
        (
            AppErrorCode::ResourceOwnershipMismatch,
            "RESOURCE_OWNERSHIP_MISMATCH",
        ),
        (
            AppErrorCode::ProviderNotConfigured,
            "PROVIDER_NOT_CONFIGURED",
        ),
        (AppErrorCode::ChatSessionNotFound, "CHAT_SESSION_NOT_FOUND"),
        (AppErrorCode::InternalError, "INTERNAL_ERROR"),
    ];

    #[test]
    fn app_error_code_serializes_to_expected_contract_literals() {
        assert_eq!(ALL_ERROR_CODES.len(), 31);

        for (code, expected) in ALL_ERROR_CODES {
            assert_eq!(
                serde_json::to_string(code).unwrap(),
                format!("\"{expected}\"")
            );
        }
    }

    #[test]
    fn app_error_serializes_with_camel_case_and_optional_details() {
        let error = AppError::new(
            AppErrorCode::EngineTimeout,
            "translation-engine 启动超时",
            true,
        )
        .with_detail("cooldownUntil", "30s")
        .with_detail("retryAfterSeconds", 30);

        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], "ENGINE_TIMEOUT");
        assert_eq!(value["message"], "translation-engine 启动超时");
        assert_eq!(value["retryable"], true);
        assert_eq!(value["details"]["cooldownUntil"], "30s");
        assert_eq!(value["details"]["retryAfterSeconds"], 30);
        assert!(value.get("retry_able").is_none());
    }

    #[test]
    fn app_error_omits_details_when_absent_and_internal_helper_uses_internal_error_code() {
        let error = AppError::internal("数据库损坏");
        let value = serde_json::to_value(&error).unwrap();

        assert_eq!(value["code"], "INTERNAL_ERROR");
        assert_eq!(value["message"], "数据库损坏");
        assert_eq!(value["retryable"], false);
        assert!(value.get("details").is_none());
    }

    #[test]
    fn as_contract_str_matches_serde_serialization_for_all_codes() {
        for (code, expected) in ALL_ERROR_CODES {
            assert_eq!(
                code.as_contract_str(),
                *expected,
                "as_contract_str() mismatch for {:?}",
                code
            );
        }
    }
}
