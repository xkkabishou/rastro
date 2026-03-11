// D. AI 问答与总结 Command (5 个)
// 对应 rust-backend-system.md Section 7.3 D
use serde::{Deserialize, Serialize};

/// AI 流式句柄
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AIStreamHandle {
    pub stream_id: String,
    pub session_id: String,
    pub provider: String,
    pub model: String,
    pub started_at: String,
}

/// ask_ai 请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskAiInput {
    pub document_id: String,
    pub session_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub user_message: String,
    pub context_quote: Option<String>,
}

/// generate_summary 请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSummaryInput {
    pub document_id: String,
    pub file_path: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub prompt_profile: Option<String>,
}

/// 聊天会话 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionDto {
    pub session_id: String,
    pub document_id: String,
    pub provider: String,
    pub model: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 聊天消息 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub content_md: String,
    pub context_quote: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated_cost: f64,
    pub created_at: String,
}

/// 取消流式响应结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAiStreamResult {
    pub stream_id: String,
    pub cancelled: bool,
}

/// 启动流式对话
#[tauri::command]
pub fn ask_ai(
    _input: AskAiInput,
) -> Result<AIStreamHandle, crate::errors::AppError> {
    todo!()
}

/// 取消当前 AI 流
#[tauri::command]
pub fn cancel_ai_stream(
    _stream_id: String,
) -> Result<CancelAiStreamResult, crate::errors::AppError> {
    todo!()
}

/// 生成文献总结，走统一流式通道
#[tauri::command]
pub fn generate_summary(
    _input: GenerateSummaryInput,
) -> Result<AIStreamHandle, crate::errors::AppError> {
    todo!()
}

/// 返回当前文档的历史会话列表
#[tauri::command]
pub fn list_chat_sessions(
    _document_id: String,
) -> Result<Vec<ChatSessionDto>, crate::errors::AppError> {
    todo!()
}

/// 返回指定会话的历史消息
#[tauri::command]
pub fn get_chat_messages(
    _session_id: String,
) -> Result<Vec<ChatMessageDto>, crate::errors::AppError> {
    todo!()
}
