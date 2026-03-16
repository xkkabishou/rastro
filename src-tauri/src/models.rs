// 领域枚举与共享类型约束
#![allow(dead_code)]

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppErrorCode};

/// AI 服务商标识
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Openai,
    Claude,
    Gemini,
}

impl ProviderId {
    /// 返回 Provider 的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ProviderId {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "openai" => Ok(Self::Openai),
            "claude" => Ok(Self::Claude),
            "gemini" => Ok(Self::Gemini),
            other => Err(AppError::new(
                AppErrorCode::UnsupportedTranslationProvider,
                format!("不支持的 Provider: {other}"),
                false,
            )),
        }
    }
}

/// 文档来源类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentSourceType {
    Local,
    Zotero,
}

impl DocumentSourceType {
    /// 返回来源类型的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Zotero => "zotero",
        }
    }
}

impl fmt::Display for DocumentSourceType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for DocumentSourceType {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "local" => Ok(Self::Local),
            "zotero" => Ok(Self::Zotero),
            other => Err(AppError::new(
                AppErrorCode::DocumentUnsupported,
                format!("不支持的文档来源: {other}"),
                false,
            )),
        }
    }
}

/// 聊天消息角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
    System,
}

impl ChatRole {
    /// 返回消息角色的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
        }
    }
}

impl fmt::Display for ChatRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 翻译任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl TranslationJobStatus {
    /// 返回状态的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for TranslationJobStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 翻译阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranslationStage {
    Preflight,
    Queued,
    Extracting,
    Translating,
    Postprocessing,
    Packaging,
    Completed,
    Failed,
    Cancelled,
}

impl TranslationStage {
    /// 返回阶段的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preflight => "preflight",
            Self::Queued => "queued",
            Self::Extracting => "extracting",
            Self::Translating => "translating",
            Self::Postprocessing => "postprocessing",
            Self::Packaging => "packaging",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for TranslationStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 翻译产物类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    TranslatedPdf,
    BilingualPdf,
    FigureReport,
    Manifest,
}

impl ArtifactKind {
    /// 返回产物类型的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TranslatedPdf => "translated_pdf",
            Self::BilingualPdf => "bilingual_pdf",
            Self::FigureReport => "figure_report",
            Self::Manifest => "manifest",
        }
    }
}

impl fmt::Display for ArtifactKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 总结 prompt 配置
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum SummaryPromptProfile {
    #[serde(rename = "default")]
    #[default]
    Default,
    #[serde(rename = "paper-review")]
    PaperReview,
}

impl SummaryPromptProfile {
    /// 返回 prompt profile 的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::PaperReview => "paper-review",
        }
    }
}

/// 使用统计功能维度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UsageFeature {
    Chat,
    Summary,
    Translation,
}

impl UsageFeature {
    /// 返回功能维度的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Summary => "summary",
            Self::Translation => "translation",
        }
    }
}

impl fmt::Display for UsageFeature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 标注类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationType {
    Highlight,
    Underline,
    Note,
}

impl AnnotationType {
    /// 返回标注类型的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Highlight => "highlight",
            Self::Underline => "underline",
            Self::Note => "note",
        }
    }
}

impl fmt::Display for AnnotationType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AnnotationType {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "highlight" => Ok(Self::Highlight),
            "underline" => Ok(Self::Underline),
            "note" => Ok(Self::Note),
            other => Err(AppError::new(
                AppErrorCode::InternalError,
                format!("不支持的标注类型: {other}"),
                false,
            )),
        }
    }
}

/// 标注颜色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationColor {
    Yellow,
    Red,
    Green,
    Blue,
    Purple,
    Magenta,
    Orange,
    Gray,
}

impl AnnotationColor {
    /// 返回标注颜色的稳定字符串值
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yellow => "yellow",
            Self::Red => "red",
            Self::Green => "green",
            Self::Blue => "blue",
            Self::Purple => "purple",
            Self::Magenta => "magenta",
            Self::Orange => "orange",
            Self::Gray => "gray",
        }
    }
}

impl fmt::Display for AnnotationColor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AnnotationColor {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "yellow" => Ok(Self::Yellow),
            "red" => Ok(Self::Red),
            "green" => Ok(Self::Green),
            "blue" => Ok(Self::Blue),
            "purple" => Ok(Self::Purple),
            "magenta" => Ok(Self::Magenta),
            "orange" => Ok(Self::Orange),
            "gray" => Ok(Self::Gray),
            other => Err(AppError::new(
                AppErrorCode::InternalError,
                format!("不支持的标注颜色: {other}"),
                false,
            )),
        }
    }
}

/// 标注矩形（PDF 归一化坐标）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub page_number: i64,
}
