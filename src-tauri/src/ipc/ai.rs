// D. AI 问答与总结 Command (8 个)
// 对应 rust-backend-system.md Section 7.3 D
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    ai_integration::{AskAiRequest, GenerateSummaryRequest},
    app_state::AppState,
    errors::AppError,
    models::{ChatRole, ProviderId, SummaryPromptProfile},
    storage::{chat_messages, chat_sessions, custom_prompts, document_summaries},
};

/// AI 流式句柄
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AIStreamHandle {
    pub stream_id: String,
    pub session_id: String,
    pub provider: ProviderId,
    pub model: String,
    pub started_at: String,
}

/// ask_ai 请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskAiInput {
    pub document_id: String,
    pub session_id: Option<String>,
    pub provider: Option<ProviderId>,
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
    pub source_text: String,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub prompt_profile: Option<SummaryPromptProfile>,
}

/// 聊天会话 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionDto {
    pub session_id: String,
    pub document_id: String,
    pub provider: ProviderId,
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
    pub role: ChatRole,
    pub content_md: String,
    pub thinking_md: Option<String>,
    pub context_quote: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated_cost: f64,
    pub created_at: String,
}

/// AI 总结 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AISummaryDto {
    pub summary_id: String,
    pub document_id: String,
    pub content_md: String,
    pub provider: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 取消流式响应结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAiStreamResult {
    pub stream_id: String,
    pub cancelled: bool,
}

/// 删除总结结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSummaryResult {
    pub deleted: bool,
}

/// 启动流式对话
#[tauri::command]
pub async fn ask_ai(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: AskAiInput,
) -> Result<AIStreamHandle, crate::errors::AppError> {
    let result = state
        .ai_integration
        .ask(
            app,
            AskAiRequest {
                document_id: input.document_id,
                session_id: input.session_id,
                provider: input.provider,
                model: input.model,
                user_message: input.user_message,
                context_quote: input.context_quote,
            },
        )
        .await?;

    Ok(AIStreamHandle {
        stream_id: result.stream_id,
        session_id: result.session_id,
        provider: result.provider,
        model: result.model,
        started_at: result.started_at,
    })
}

/// 取消当前 AI 流
#[tauri::command]
pub fn cancel_ai_stream(
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<CancelAiStreamResult, crate::errors::AppError> {
    let cancelled = state.ai_integration.cancel_stream(&stream_id);
    Ok(CancelAiStreamResult {
        stream_id,
        cancelled,
    })
}

/// 生成文献总结，走统一流式通道
#[tauri::command]
pub async fn generate_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GenerateSummaryInput,
) -> Result<AIStreamHandle, crate::errors::AppError> {
    // 从数据库读取用户自定义总结提示词
    let custom_prompt = {
        let connection = state.storage.connection();
        custom_prompts::get(&connection, "summary")?
    };

    let result = state
        .ai_integration
        .generate_summary(
            app,
            GenerateSummaryRequest {
                document_id: input.document_id,
                file_path: input.file_path,
                source_text: input.source_text,
                provider: input.provider,
                model: input.model,
                prompt_profile: input.prompt_profile.unwrap_or_default(),
                custom_prompt,
            },
        )
        .await?;

    Ok(AIStreamHandle {
        stream_id: result.stream_id,
        session_id: result.session_id,
        provider: result.provider,
        model: result.model,
        started_at: result.started_at,
    })
}

/// 返回当前文档的 AI 总结
#[tauri::command]
pub fn get_document_summary(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Option<AISummaryDto>, AppError> {
    let record = {
        let connection = state.storage.connection();
        document_summaries::get_by_document_id(&connection, &document_id)?
    };

    Ok(record.map(summary_dto_from_record))
}

/// 保存或覆盖当前文档的 AI 总结
#[tauri::command]
pub fn save_document_summary(
    state: State<'_, AppState>,
    document_id: String,
    content_md: String,
    provider: String,
    model: String,
) -> Result<AISummaryDto, AppError> {
    let record = {
        let connection = state.storage.connection();
        document_summaries::upsert_summary(
            &connection,
            &document_id,
            &content_md,
            &provider,
            &model,
        )?
    };

    Ok(summary_dto_from_record(record))
}

/// 删除当前文档的 AI 总结
#[tauri::command]
pub fn delete_document_summary(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeleteSummaryResult, AppError> {
    let deleted = {
        let connection = state.storage.connection();
        document_summaries::delete_by_document_id(&connection, &document_id)?
    };

    Ok(DeleteSummaryResult { deleted })
}

/// 返回当前文档的历史会话列表
#[tauri::command]
pub fn list_chat_sessions(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<ChatSessionDto>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        chat_sessions::list_by_document(&connection, &document_id)?
    };

    records
        .into_iter()
        .map(|record| {
            Ok(ChatSessionDto {
                session_id: record.session_id,
                document_id: record.document_id,
                provider: record.provider.parse()?,
                model: record.model,
                title: record.title,
                created_at: record.created_at,
                updated_at: record.updated_at,
            })
        })
        .collect()
}

fn summary_dto_from_record(record: document_summaries::SummaryRecord) -> AISummaryDto {
    AISummaryDto {
        summary_id: record.summary_id,
        document_id: record.document_id,
        content_md: record.content_md,
        provider: record.provider,
        model: record.model,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

/// 返回指定会话的历史消息
#[tauri::command]
pub fn get_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ChatMessageDto>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        chat_messages::list_by_session(&connection, &session_id)?
    };

    records
        .into_iter()
        .map(|record| {
            let role = match record.role.as_str() {
                "user" => ChatRole::User,
                "assistant" => ChatRole::Assistant,
                _ => ChatRole::System,
            };

            Ok(ChatMessageDto {
                message_id: record.message_id,
                session_id: record.session_id,
                role,
                content_md: record.content_md,
                thinking_md: record.thinking_md,
                context_quote: record.context_quote,
                input_tokens: record.input_tokens,
                output_tokens: record.output_tokens,
                estimated_cost: record.estimated_cost,
                created_at: record.created_at,
            })
        })
        .collect()
}
