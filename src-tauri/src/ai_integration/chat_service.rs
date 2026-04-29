// 问答流服务
use std::io::ErrorKind;

use chrono::Utc;
use futures_util::{Stream, StreamExt, TryStreamExt};
use serde_json::json;
use tauri::Emitter;
use tokio::select;
use tokio_util::{
    codec::{FramedRead, LinesCodec, LinesCodecError},
    io::StreamReader,
    sync::CancellationToken,
};
use uuid::Uuid;

use crate::{
    ai_integration::{
        provider_registry::{self, PromptMessage},
        usage_meter, AiIntegration, AskAiRequest, GenerateSummaryRequest, StreamHandleResult,
    },
    errors::{AppError, AppErrorCode},
    models::{ChatRole, ProviderId, SummaryPromptProfile, UsageFeature},
    storage::{chat_messages, chat_sessions, documents, usage_events},
};

struct PreparedStream {
    stream_id: String,
    session_id: String,
    provider: ProviderId,
    model: String,
    started_at: String,
    messages: Vec<PromptMessage>,
    document_id: String,
}

impl PreparedStream {
    /// 拼接所有消息内容用于 fallback token 估算
    fn combined_input_text(&self) -> String {
        self.messages
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[derive(Debug)]
enum StreamOutcome {
    Completed {
        text: String,
        thinking: Option<String>,
        usage: usage_meter::UsageSnapshot,
    },
    Cancelled,
}

fn build_empty_stream_error(
    prepared: &PreparedStream,
    payload_count: usize,
    last_payload_preview: Option<&str>,
) -> AppError {
    let mut error = AppError::new(
        AppErrorCode::ProviderConnectionFailed,
        format!(
            "AI 服务返回了空响应。当前配置为 provider={} / model={}，该模型或网关可能与现有流式协议不兼容，请检查设置中的 Provider、Base URL 与 Model。",
            prepared.provider.as_str(),
            prepared.model,
        ),
        false,
    )
    .with_detail("payloadCount", payload_count as u64);

    if let Some(preview) = last_payload_preview.filter(|value| !value.is_empty()) {
        error = error.with_detail("lastPayloadPreview", preview.to_string());
    }

    error
}

fn finalize_stream_outcome(
    prepared: &PreparedStream,
    full_text: String,
    full_thinking: String,
    usage: usage_meter::UsageSnapshot,
    payload_count: usize,
    last_payload_preview: Option<&str>,
) -> Result<StreamOutcome, AppError> {
    if full_text.trim().is_empty() {
        return Err(build_empty_stream_error(
            prepared,
            payload_count,
            last_payload_preview,
        ));
    }

    Ok(StreamOutcome::Completed {
        text: full_text,
        thinking: if full_thinking.trim().is_empty() {
            None
        } else {
            Some(full_thinking)
        },
        usage,
    })
}

fn fallback_usage_snapshot(
    prepared: &PreparedStream,
    full_text: &str,
) -> usage_meter::UsageSnapshot {
    usage_meter::UsageSnapshot::fallback(
        prepared.provider,
        &prepared.model,
        &prepared.combined_input_text(),
        full_text,
    )
}

fn stream_read_error_summary(error: &LinesCodecError) -> String {
    match error {
        LinesCodecError::MaxLineLengthExceeded => "单行响应超过解析上限".to_string(),
        LinesCodecError::Io(error) => {
            let message = error.to_string();
            if message.trim().is_empty() {
                "流式响应读取失败".to_string()
            } else {
                message
            }
        }
    }
}

fn is_recoverable_stream_read_error(error: &LinesCodecError) -> bool {
    let LinesCodecError::Io(error) = error else {
        return false;
    };

    if matches!(
        error.kind(),
        ErrorKind::UnexpectedEof
            | ErrorKind::ConnectionAborted
            | ErrorKind::ConnectionReset
            | ErrorKind::BrokenPipe
    ) {
        return true;
    }

    let message = error.to_string().to_ascii_lowercase();
    [
        "error decoding response body",
        "unexpected eof",
        "connection closed",
        "connection reset",
        "connection aborted",
        "early eof",
        "incomplete message",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

fn build_stream_read_error(
    prepared: &PreparedStream,
    error: &LinesCodecError,
    payload_count: usize,
    last_payload_preview: Option<&str>,
) -> AppError {
    let message = match error {
        LinesCodecError::MaxLineLengthExceeded => {
            "AI 服务返回的一行响应过长，无法继续解析。请检查 Provider 网关是否兼容流式输出。"
                .to_string()
        }
        LinesCodecError::Io(_) => {
            "AI 服务连接在读取流式响应时中断，未收到可用内容。请检查网络或 Provider 网关后重试。"
                .to_string()
        }
    };

    let mut app_error = AppError::new(AppErrorCode::ProviderConnectionFailed, message, true)
        .with_detail("provider", prepared.provider.as_str())
        .with_detail("model", prepared.model.clone())
        .with_detail("payloadCount", payload_count as u64)
        .with_detail("streamError", stream_read_error_summary(error));

    if let Some(preview) = last_payload_preview.filter(|value| !value.is_empty()) {
        app_error = app_error.with_detail("lastPayloadPreview", preview.to_string());
    }

    app_error
}

#[allow(clippy::too_many_arguments)]
fn process_sse_data_line<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    prepared: &PreparedStream,
    line: &str,
    full_text: &mut String,
    full_thinking: &mut String,
    usage: &mut Option<usage_meter::UsageSnapshot>,
    payload_count: &mut usize,
    last_payload_preview: &mut Option<String>,
) -> Result<Option<StreamOutcome>, AppError> {
    let trimmed_line = line.trim();
    let Some(data) = trimmed_line.strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim();

    if data.is_empty() {
        return Ok(None);
    }

    if data == "[DONE]" {
        let resolved_usage = usage
            .take()
            .unwrap_or_else(|| fallback_usage_snapshot(prepared, full_text));

        return finalize_stream_outcome(
            prepared,
            full_text.clone(),
            full_thinking.clone(),
            resolved_usage,
            *payload_count,
            last_payload_preview.as_deref(),
        )
        .map(Some);
    }

    *payload_count += 1;
    *last_payload_preview = Some(data.chars().take(300).collect());

    let payload: serde_json::Value = serde_json::from_str(data).map_err(|error| {
        AppError::new(
            AppErrorCode::ProviderConnectionFailed,
            format!("解析 SSE JSON 失败: {error}"),
            true,
        )
    })?;

    if let Some(thinking_delta) =
        provider_registry::extract_stream_thinking(prepared.provider, &payload)
    {
        full_thinking.push_str(&thinking_delta);
        if let Err(error) = app.emit(
            "ai://stream-chunk",
            json!({
                "streamId": prepared.stream_id,
                "delta": thinking_delta,
                "kind": "thinking",
            }),
        ) {
            eprintln!("emit ai://stream-chunk thinking failed: {error}");
        }
    }

    if let Some(delta) = provider_registry::extract_stream_delta(prepared.provider, &payload) {
        full_text.push_str(&delta);
        if let Err(error) = app.emit(
            "ai://stream-chunk",
            json!({
                "streamId": prepared.stream_id,
                "delta": delta,
                "kind": "content",
            }),
        ) {
            eprintln!("emit ai://stream-chunk content failed: {error}");
        }
    }

    if usage.is_none() {
        *usage = usage_meter::extract_usage(prepared.provider, &payload, &prepared.model);
    }

    Ok(None)
}

async fn consume_sse_lines<R, S>(
    app: &tauri::AppHandle<R>,
    prepared: &PreparedStream,
    cancellation: &CancellationToken,
    mut lines: S,
) -> Result<StreamOutcome, AppError>
where
    R: tauri::Runtime,
    S: Stream<Item = Result<String, LinesCodecError>> + Unpin,
{
    let mut full_text = String::new();
    let mut full_thinking = String::new();
    let mut usage = None;
    let mut payload_count = 0usize;
    let mut last_payload_preview: Option<String> = None;

    loop {
        select! {
            _ = cancellation.cancelled() => {
                return Ok(StreamOutcome::Cancelled);
            }
            next = lines.next() => {
                match next {
                    Some(Ok(line)) => {
                        if let Some(outcome) = process_sse_data_line(
                            app,
                            prepared,
                            &line,
                            &mut full_text,
                            &mut full_thinking,
                            &mut usage,
                            &mut payload_count,
                            &mut last_payload_preview,
                        )? {
                            return Ok(outcome);
                        }
                    }
                    Some(Err(error)) => {
                        if !full_text.trim().is_empty()
                            && is_recoverable_stream_read_error(&error)
                        {
                            eprintln!(
                                "AI 流式响应中断但已收到内容，按已生成内容完成, stream_id={}, provider={}, model={}, err={}",
                                prepared.stream_id,
                                prepared.provider.as_str(),
                                prepared.model,
                                stream_read_error_summary(&error)
                            );

                            let resolved_usage = usage
                                .unwrap_or_else(|| fallback_usage_snapshot(prepared, &full_text));

                            return finalize_stream_outcome(
                                prepared,
                                full_text,
                                full_thinking,
                                resolved_usage,
                                payload_count,
                                last_payload_preview.as_deref(),
                            );
                        }

                        return Err(build_stream_read_error(
                            prepared,
                            &error,
                            payload_count,
                            last_payload_preview.as_deref(),
                        ));
                    }
                    None => {
                        let resolved_usage = usage
                            .unwrap_or_else(|| fallback_usage_snapshot(prepared, &full_text));

                        return finalize_stream_outcome(
                            prepared,
                            full_text,
                            full_thinking,
                            resolved_usage,
                            payload_count,
                            last_payload_preview.as_deref(),
                        );
                    }
                }
            }
        }
    }
}

/// 启动普通聊天流
pub async fn start_chat<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    input: AskAiRequest,
) -> Result<StreamHandleResult, AppError> {
    let started_at = Utc::now().to_rfc3339();
    let session_title = Some(truncate_title(&input.user_message));

    // 同步段：resolve_runtime_config / build_chat_messages / 会话与消息持久化
    // 都依赖 SQLite (parking_lot::Mutex) + Keychain，统一放进 spawn_blocking 避免阻塞 tokio worker
    let ai_for_block = ai.clone();
    let input_for_block = input.clone();
    let started_at_for_block = started_at.clone();
    let session_title_for_block = session_title.clone();
    let (config, messages, session_id) = tokio::task::spawn_blocking(
        move || -> Result<(provider_registry::ProviderRuntimeConfig, Vec<PromptMessage>, String), AppError> {
            let config = provider_registry::resolve_runtime_config(
                &ai_for_block,
                input_for_block.provider,
                input_for_block.model.clone(),
            )?;
            let messages = build_chat_messages(&ai_for_block, &input_for_block)?;

            let session_id = {
                let connection = ai_for_block.storage.connection();
                if let Some(session_id) = input_for_block.session_id.clone() {
                    let Some(existing) = chat_sessions::get_by_id(&connection, &session_id)? else {
                        return Err(AppError::new(
                            AppErrorCode::ChatSessionNotFound,
                            "聊天会话不存在",
                            false,
                        ));
                    };

                    if existing.document_id != input_for_block.document_id {
                        return Err(AppError::new(
                            AppErrorCode::ChatSessionNotFound,
                            "聊天会话不属于当前文档",
                            false,
                        ));
                    }

                    session_id
                } else {
                    let session = chat_sessions::create(
                        &connection,
                        &chat_sessions::CreateChatSessionParams {
                            document_id: input_for_block.document_id.clone(),
                            provider: config.provider.as_str().to_string(),
                            model: config.model.clone(),
                            title: session_title_for_block.clone(),
                            timestamp: started_at_for_block.clone(),
                        },
                    )?;
                    session.session_id
                }
            };

            {
                let connection = ai_for_block.storage.connection();
                chat_messages::create(
                    &connection,
                    &chat_messages::CreateChatMessageParams {
                        session_id: session_id.clone(),
                        role: ChatRole::User.as_str().to_string(),
                        content_md: input_for_block.user_message.clone(),
                        thinking_md: None,
                        context_quote: input_for_block.context_quote.clone(),
                        input_tokens: 0,
                        output_tokens: 0,
                        estimated_cost: 0.0,
                        created_at: started_at_for_block.clone(),
                    },
                )?;

                chat_sessions::update_metadata(
                    &connection,
                    &session_id,
                    session_title_for_block.as_deref(),
                    &started_at_for_block,
                )?;
            }

            Ok((config, messages, session_id))
        },
    )
    .await
    .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

    start_stream(
        app,
        ai,
        config.provider,
        config.model,
        input.document_id,
        session_id,
        started_at,
        messages,
        UsageFeature::Chat,
    )
    .await
}

/// 启动总结流
pub async fn start_summary_flow<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    input: GenerateSummaryRequest,
) -> Result<StreamHandleResult, AppError> {
    let started_at = Utc::now().to_rfc3339();
    let session_title = Some(format!("Summary · {}", input.prompt_profile.as_str()));

    // resolve_runtime_config + 会话创建均涉及 SQLite + Keychain，走 spawn_blocking
    let ai_for_block = ai.clone();
    let input_provider = input.provider;
    let input_model = input.model.clone();
    let document_id_for_block = input.document_id.clone();
    let started_at_for_block = started_at.clone();
    let session_title_for_block = session_title.clone();
    let (config, session_id) = tokio::task::spawn_blocking(
        move || -> Result<(provider_registry::ProviderRuntimeConfig, String), AppError> {
            let config = provider_registry::resolve_runtime_config(
                &ai_for_block,
                input_provider,
                input_model,
            )?;
            let connection = ai_for_block.storage.connection();
            let session = chat_sessions::create(
                &connection,
                &chat_sessions::CreateChatSessionParams {
                    document_id: document_id_for_block,
                    provider: config.provider.as_str().to_string(),
                    model: config.model.clone(),
                    title: session_title_for_block,
                    timestamp: started_at_for_block,
                },
            )?;
            Ok((config, session.session_id))
        },
    )
    .await
    .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

    start_stream(
        app,
        ai,
        config.provider,
        config.model,
        input.document_id,
        session_id,
        started_at,
        vec![PromptMessage {
            role: "user".to_string(),
            content: build_summary_prompt(
                &input.file_path,
                &input.source_text,
                input.prompt_profile,
                input.custom_prompt.as_deref(),
            ),
        }],
        UsageFeature::Summary,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_stream<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    provider: ProviderId,
    model: String,
    document_id: String,
    session_id: String,
    started_at: String,
    messages: Vec<PromptMessage>,
    feature: UsageFeature,
) -> Result<StreamHandleResult, AppError> {
    let prepared = PreparedStream {
        stream_id: Uuid::new_v4().to_string(),
        session_id,
        provider,
        model,
        started_at,
        messages,
        document_id,
    };

    let cancellation = CancellationToken::new();
    ai.stream_registry
        .lock()
        .insert(prepared.stream_id.clone(), cancellation.clone());

    let handle = StreamHandleResult {
        stream_id: prepared.stream_id.clone(),
        session_id: prepared.session_id.clone(),
        provider: prepared.provider,
        model: prepared.model.clone(),
        started_at: prepared.started_at.clone(),
    };

    tokio::spawn(run_stream_task(app, ai, prepared, cancellation, feature));

    Ok(handle)
}

async fn run_stream_task<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    prepared: PreparedStream,
    cancellation: CancellationToken,
    feature: UsageFeature,
) {
    let outcome = run_stream_request(&app, &ai, &prepared, &cancellation).await;
    ai.stream_registry.lock().remove(&prepared.stream_id);

    match outcome {
        Ok(StreamOutcome::Completed {
            text,
            thinking,
            usage,
        }) => {
            // Summary 场景下对 Markdown 做后处理：
            // 1. frontmatter 规范化（剥掉 ```yaml 栅栏、删除引言套话）
            // 2. Callout 前缀规范化（补齐漏写的 `> ` 前缀）
            // 聊天等其他场景保持原文。
            let final_text = if matches!(feature, UsageFeature::Summary) {
                normalize_summary_markdown(&text)
            } else {
                text.clone()
            };
            let normalized_changed = final_text != text;

            let finished_at = Utc::now().to_rfc3339();
            // SQLite 写入 (assistant message + session 元数据 + usage event) 走 spawn_blocking
            let storage = ai.storage.clone();
            let session_id_for_block = prepared.session_id.clone();
            let final_text_for_block = final_text.clone();
            let thinking_for_block = thinking.clone();
            let usage_for_block = usage.clone();
            let document_id_for_block = prepared.document_id.clone();
            let provider_str_for_block = prepared.provider.as_str().to_string();
            let model_for_block = prepared.model.clone();
            let feature_str_for_block = feature.as_str().to_string();
            let finished_at_for_block = finished_at.clone();
            let join_outcome = tokio::task::spawn_blocking(move || {
                let connection = storage.connection();
                let message = chat_messages::create(
                    &connection,
                    &chat_messages::CreateChatMessageParams {
                        session_id: session_id_for_block.clone(),
                        role: ChatRole::Assistant.as_str().to_string(),
                        content_md: final_text_for_block,
                        thinking_md: thinking_for_block,
                        context_quote: None,
                        input_tokens: usage_for_block.input_tokens as u32,
                        output_tokens: usage_for_block.output_tokens as u32,
                        estimated_cost: usage_for_block.estimated_cost,
                        created_at: finished_at_for_block.clone(),
                    },
                );

                if message.is_ok() {
                    let _ = chat_sessions::update_metadata(
                        &connection,
                        &session_id_for_block,
                        None,
                        &finished_at_for_block,
                    );

                    let _ = usage_events::create(
                        &connection,
                        &usage_events::CreateUsageEventParams {
                            document_id: Some(document_id_for_block),
                            provider: provider_str_for_block,
                            model: model_for_block,
                            feature: feature_str_for_block,
                            input_tokens: usage_for_block.input_tokens,
                            output_tokens: usage_for_block.output_tokens,
                            estimated_cost: usage_for_block.estimated_cost,
                            currency: usage_for_block.currency,
                            created_at: finished_at_for_block,
                        },
                    );
                }

                message
            })
            .await;
            // 把 spawn_blocking JoinError 与 rusqlite::Error 统一收敛为 AppError
            let message_result: Result<chat_messages::ChatMessageRecord, AppError> =
                match join_outcome {
                    Ok(Ok(message)) => Ok(message),
                    Ok(Err(rusqlite_err)) => Err(AppError::from(rusqlite_err)),
                    Err(join_err) => {
                        eprintln!("聊天消息持久化任务异常退出: {join_err}");
                        Err(AppError::internal(format!(
                            "聊天消息持久化任务异常退出: {join_err}"
                        )))
                    }
                };

            match message_result {
                Ok(message) => {
                    // Summary 场景且后处理实际修改了内容时，在 payload 中
                    // 返回规范化后的完整 Markdown，便于前端整体替换显示。
                    let mut payload = json!({
                        "streamId": prepared.stream_id,
                        "sessionId": prepared.session_id,
                        "messageId": message.message_id,
                        "documentId": prepared.document_id,
                    });
                    if matches!(feature, UsageFeature::Summary) && normalized_changed {
                        if let Some(obj) = payload.as_object_mut() {
                            obj.insert("normalizedContent".to_string(), json!(final_text.clone()));
                        }
                    }
                    if let Err(error) = app.emit("ai://stream-finished", payload) {
                        eprintln!("emit ai://stream-finished failed: {error}");
                    }
                }
                Err(error) => {
                    if let Err(emit_error) = app.emit(
                        "ai://stream-failed",
                        json!({
                            "streamId": prepared.stream_id,
                            "error": error,
                        }),
                    ) {
                        eprintln!("emit ai://stream-failed failed: {emit_error}");
                    }
                }
            }
        }
        Ok(StreamOutcome::Cancelled) => {}
        Err(error) => {
            if let Err(emit_error) = app.emit(
                "ai://stream-failed",
                json!({
                    "streamId": prepared.stream_id,
                    "error": error,
                }),
            ) {
                eprintln!("emit ai://stream-failed failed: {emit_error}");
            }
        }
    }
}

async fn run_stream_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    ai: &AiIntegration,
    prepared: &PreparedStream,
    cancellation: &CancellationToken,
) -> Result<StreamOutcome, AppError> {
    let ai_for_config = ai.clone();
    let provider_for_config = prepared.provider;
    let model_for_config = prepared.model.clone();
    let config = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        provider_registry::resolve_runtime_config(
            &ai_for_config,
            Some(provider_for_config),
            Some(model_for_config),
        )
    })
    .await
    .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??;

    let response = provider_registry::build_stream_request(&ai.client, &config, &prepared.messages)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(provider_registry::map_provider_http_error(
            status,
            &body,
            "流式请求失败",
        ));
    }

    let byte_stream = response.bytes_stream().map_err(std::io::Error::other);
    let stream_reader = StreamReader::new(byte_stream);
    let lines = FramedRead::new(stream_reader, LinesCodec::new());

    consume_sse_lines(app, prepared, cancellation, lines).await
}

/// 构建多消息数组：可选 system（精读全文）+ 历史消息 + 当前 user 消息
fn build_chat_messages(
    ai: &AiIntegration,
    input: &AskAiRequest,
) -> Result<Vec<PromptMessage>, AppError> {
    let mut messages: Vec<PromptMessage> = Vec::new();

    // 1. 精读模式：注入 system 角色的全文
    {
        let connection = ai.storage.connection();
        if let Some(full_text) = documents::get_deep_read_text(&connection, &input.document_id)? {
            messages.push(PromptMessage {
                role: "system".to_string(),
                content: format!(
                    "你是一位学术研究助手。以下是当前论文的全文内容，请基于这些内容回答用户的问题。\n\n---\n{}",
                    full_text
                ),
            });
        }
    }

    // 2. 加载历史消息（如果是已有 session）
    if let Some(ref session_id) = input.session_id {
        let connection = ai.storage.connection();
        let history = chat_messages::list_by_session(&connection, session_id)?;
        for msg in history {
            messages.push(PromptMessage {
                role: msg.role.clone(),
                content: msg.content_md.clone(),
            });
        }
    }

    // 3. 当前用户消息
    let user_content = match &input.context_quote {
        Some(quote) if !quote.trim().is_empty() => format!(
            "请基于以下引用段落回答问题。\n\n引用：\n{}\n\n问题：{}",
            quote.trim(),
            input.user_message.trim()
        ),
        _ => input.user_message.trim().to_string(),
    };
    messages.push(PromptMessage {
        role: "user".to_string(),
        content: user_content,
    });

    Ok(messages)
}

fn build_summary_prompt(
    file_path: &str,
    source_text: &str,
    profile: SummaryPromptProfile,
    custom_prompt: Option<&str>,
) -> String {
    // 优先使用自定义提示词，否则按 profile 选择默认值
    let system_instruction = match custom_prompt {
        Some(prompt) if !prompt.trim().is_empty() => prompt,
        _ => match profile {
            SummaryPromptProfile::Default => crate::ipc::settings::DEFAULT_SUMMARY_PROMPT,
            SummaryPromptProfile::PaperReview => crate::ipc::settings::PAPER_REVIEW_SUMMARY_PROMPT,
        },
    };
    format!(
        "{}\n\n文档路径：{}\n\n正文摘录开始：\n{}\n\n正文摘录结束。",
        system_instruction,
        file_path,
        source_text.trim(),
    )
}

pub(crate) fn normalize_summary_markdown(md: &str) -> String {
    let step1 = normalize_one_line_frontmatter(md);
    let step2 = repair_markdown_block_boundaries(&step1);
    let step3 = normalize_frontmatter_fencing(&step2);
    normalize_callout_prefixes(&step3)
}

fn truncate_title(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= 36 {
        return trimmed.to_string();
    }

    trimmed.chars().take(36).collect()
}

/// 合法的 Obsidian Callout 类型（全小写）
const CALLOUT_TYPES: &[&str] = &[
    "abstract",
    "summary",
    "tldr",
    "info",
    "todo",
    "tip",
    "hint",
    "important",
    "success",
    "check",
    "done",
    "question",
    "help",
    "faq",
    "warning",
    "caution",
    "attention",
    "failure",
    "fail",
    "missing",
    "danger",
    "error",
    "bug",
    "example",
    "quote",
    "cite",
    "note",
];

const FRONTMATTER_KEYS: &[&str] = &[
    "title",
    "authors",
    "author",
    "year",
    "date",
    "tags",
    "source",
    "aliases",
    "cssclasses",
    "publisher",
    "doi",
    "abstract",
    "keywords",
];

const ONE_LINE_FRONTMATTER_KEYS: &[&str] =
    &["title", "authors", "author", "year", "source", "tags"];

fn normalize_one_line_frontmatter(md: &str) -> String {
    let Some(start) = md.find(|ch: char| !ch.is_whitespace()) else {
        return md.to_string();
    };
    let mut content = &md[start..];
    // 兼容 `--- title: ... authors: ... --- # 标题` 这种被压成单行的 YAML。
    // 标准 `---\n...` frontmatter 仍交给 normalize_frontmatter_fencing 保持幂等。
    if content.starts_with("---")
        && !content.starts_with("---\n")
        && !content.starts_with("---\r\n")
    {
        content = content.trim_start_matches('-').trim_start();
    }
    if !content
        .get(..content.len().min("title:".len()))
        .is_some_and(|value| value.eq_ignore_ascii_case("title:"))
    {
        return md.to_string();
    }

    let positions = find_frontmatter_key_positions(content);
    if positions.len() < 2 || positions[0].0 != 0 {
        return md.to_string();
    }

    let mut fields = Vec::with_capacity(positions.len());
    let mut body_tail = String::new();
    for (idx, (position, key)) in positions.iter().enumerate() {
        let value_start = position + key.len() + 1;
        let value_end = positions
            .get(idx + 1)
            .map(|(next_position, _)| *next_position)
            .unwrap_or(content.len());
        let raw_value = content[value_start..value_end].trim();
        if idx + 1 == positions.len() {
            let (field_value, tail) = split_frontmatter_value_tail(raw_value);
            fields.push((*key, clean_one_line_frontmatter_value(field_value)));
            body_tail = clean_one_line_frontmatter_tail(tail);
        } else {
            fields.push((*key, clean_one_line_frontmatter_value(raw_value)));
        }
    }

    if fields.iter().filter(|(_, value)| !value.is_empty()).count() < 2 {
        return md.to_string();
    }

    let mut output = String::new();
    output.push_str("---\n");
    for (key, value) in fields {
        output.push_str(key);
        output.push_str(": ");
        output.push_str(value.trim());
        output.push('\n');
    }
    output.push_str("---");
    if !body_tail.is_empty() {
        output.push_str("\n\n");
        output.push_str(&body_tail);
    }
    output
}

fn clean_one_line_frontmatter_value(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .strip_suffix("---")
        .unwrap_or(trimmed)
        .trim_end()
        .to_string()
}

fn clean_one_line_frontmatter_tail(tail: &str) -> String {
    tail.trim_start()
        .trim_start_matches('-')
        .trim_start()
        .to_string()
}

fn find_frontmatter_key_positions(content: &str) -> Vec<(usize, &'static str)> {
    let lower = content.to_ascii_lowercase();
    let mut positions = Vec::new();
    for key in ONE_LINE_FRONTMATTER_KEYS {
        let pattern = format!("{key}:");
        if let Some(position) = lower.find(&pattern) {
            positions.push((position, *key));
        }
    }
    positions.sort_by_key(|(position, _)| *position);
    positions.dedup_by_key(|(position, _)| *position);
    positions
}

fn split_frontmatter_value_tail(value: &str) -> (&str, &str) {
    let markers = [
        "\n# ", "\n## ", "# ", "## ", " ---# ", " ---## ", "---# ", "---## ", "> [!", "[!",
    ];
    let split_at = markers.iter().filter_map(|marker| value.find(marker)).min();
    match split_at {
        Some(index) => value.split_at(index),
        None => (value, ""),
    }
}

fn repair_markdown_block_boundaries(md: &str) -> String {
    let step1 = insert_missing_block_boundaries(md);
    let step2 = split_compacted_table_rows(&step1);
    split_inline_list_markers(&step2)
}

fn insert_missing_block_boundaries(md: &str) -> String {
    let mut output = String::with_capacity(md.len() + 16);
    let mut index = 0;

    while index < md.len() {
        if starts_markdown_block(md, index) && !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
            output.push('\n');
        }

        let ch = md[index..].chars().next().expect("valid char boundary");
        output.push(ch);
        index += ch.len_utf8();
    }

    output
}

fn starts_markdown_block(md: &str, index: usize) -> bool {
    starts_heading(md, index) || starts_callout(md, index) || starts_probable_table(md, index)
}

fn starts_heading(md: &str, index: usize) -> bool {
    let rest = &md[index..];
    let level = rest.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) || !rest[level..].starts_with(' ') {
        return false;
    }

    // 前一个字符不能是 #（防止把 "###" 的第二个 "#" 误判为 "## 标题"）
    if index > 0 && md[..index].ends_with('#') {
        return false;
    }

    if level == 1 {
        let previous = md[..index].chars().next_back();
        return match previous {
            Some(ch) => !ch.is_ascii_alphanumeric(),
            None => true,
        };
    }

    true
}

fn starts_callout(md: &str, index: usize) -> bool {
    let rest = &md[index..];
    if rest.starts_with("[!") {
        if md[..index]
            .chars()
            .rev()
            .find(|ch| !ch.is_whitespace())
            .is_some_and(|ch| ch == '>')
        {
            return false;
        }
        let line_prefix = md[..index].rsplit('\n').next().unwrap_or_default();
        if line_prefix.trim_start().starts_with('>') {
            return false;
        }
    }
    (rest.starts_with("> [!") || rest.starts_with("[!")) && detect_callout_type(rest).is_some()
}

fn starts_probable_table(md: &str, index: usize) -> bool {
    if !md[index..].starts_with('|') {
        return false;
    }
    let line_prefix = md[..index].rsplit('\n').next().unwrap_or_default();
    if line_prefix.contains('|') {
        return false;
    }
    let rest = &md[index..];
    let line_end = rest.find('\n').unwrap_or(rest.len());
    let current_line = &rest[..line_end.min(500)];
    let pipe_count = current_line.matches('|').count();
    if pipe_count < 2 {
        return false;
    }
    // 当前行是分隔行（如 |---|:---|）直接通过
    if line_has_table_separator(current_line) {
        return true;
    }
    // 当前行是表头行（如 |Header1|Header2|），检查下一行是否是分隔行
    if line_end < rest.len() {
        let next_rest = rest[line_end..].trim_start_matches('\n');
        let next_end = next_rest.find('\n').unwrap_or(next_rest.len());
        let next_line = &next_rest[..next_end.min(500)];
        return next_line.starts_with('|') && line_has_table_separator(next_line);
    }
    false
}

fn split_compacted_table_rows(md: &str) -> String {
    md.lines()
        .flat_map(|line| {
            if line_has_table_separator(line) {
                split_compacted_table_line(line)
            } else {
                vec![line.to_string()]
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_has_table_separator(line: &str) -> bool {
    let compact = line.replace(' ', "");
    compact.contains("|---") || compact.contains("|:---") || compact.contains("|---:")
}

fn split_compacted_table_line(line: &str) -> Vec<String> {
    if let Some(rows) = split_compacted_table_line_by_separator(line) {
        return rows;
    }
    split_compacted_table_line_fallback(line)
}

fn split_compacted_table_line_by_separator(line: &str) -> Option<Vec<String>> {
    if !line.trim_start().starts_with('|') {
        return None;
    }

    let normalized_cells: Vec<String> = line
        .split('|')
        .skip(1)
        .filter_map(|cell| {
            let trimmed = cell.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();
    if normalized_cells.len() < 4 {
        return None;
    }

    let separator_start = normalized_cells
        .iter()
        .position(|cell| is_markdown_table_separator_cell(cell))?;
    let separator_len = normalized_cells[separator_start..]
        .iter()
        .take_while(|cell| is_markdown_table_separator_cell(cell))
        .count();
    if separator_len < 2 || separator_start < separator_len {
        return None;
    }

    let column_count = separator_len;
    let header_start = separator_start - column_count;
    let header_cells = &normalized_cells[header_start..separator_start];
    let separator_cells = &normalized_cells[separator_start..separator_start + column_count];
    let data_cells = &normalized_cells[separator_start + column_count..];
    if data_cells.len() < column_count {
        return None;
    }

    let data_row_count = data_cells.len() / column_count;
    let tail_cells = &data_cells[data_row_count * column_count..];
    if tail_cells.len() > 1 {
        return None;
    }

    let mut rows = Vec::with_capacity(2 + data_row_count + tail_cells.len());
    rows.push(build_markdown_table_row(header_cells, false));
    rows.push(build_markdown_table_row(separator_cells, true));
    for row_cells in data_cells[..data_row_count * column_count].chunks(column_count) {
        rows.push(build_markdown_table_row(row_cells, false));
    }
    if let Some(tail) = tail_cells.first() {
        rows.push(tail.to_string());
    }

    Some(rows)
}

fn is_markdown_table_separator_cell(cell: &str) -> bool {
    let trimmed = cell.trim();
    trimmed.chars().filter(|ch| *ch == '-').count() >= 3
        && trimmed
            .chars()
            .all(|ch| matches!(ch, '-' | ':' | ' '))
}

fn build_markdown_table_row(cells: &[String], is_separator: bool) -> String {
    if is_separator {
        format!("|{}|", cells.join("|"))
    } else {
        format!("| {} |", cells.join(" | "))
    }
}

fn split_compacted_table_line_fallback(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut rows = Vec::new();
    let mut current = String::new();
    let mut index = 0;

    while index < chars.len() {
        if chars[index] == '|' {
            if current.matches('|').count() >= 2
                && chars
                    .get(index + 1)
                    .is_some_and(|next| !next.is_whitespace() && *next != '|')
                && !chars[index + 1..].contains(&'|')
            {
                current.push('|');
                rows.push(current.trim_end().to_string());
                current.clear();
                index += 1;
                continue;
            }
            let mut next = index + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if next < chars.len() && chars[next] == '|' && current.matches('|').count() >= 2 {
                current.push('|');
                rows.push(current.trim_end().to_string());
                current.clear();
                current.push('|');
                index = next + 1;
                continue;
            }
        }

        current.push(chars[index]);
        index += 1;
    }

    if !current.trim().is_empty() {
        rows.push(current.trim_end().to_string());
    }

    rows
}

fn split_inline_list_markers(md: &str) -> String {
    md.lines()
        .map(|line| {
            if line.trim_start().starts_with('|') {
                line.to_string()
            } else {
                split_inline_list_markers_in_line(line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_inline_list_markers_in_line(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut output = String::with_capacity(line.len() + 8);
    let mut segment_start = 0usize;
    let mut index = 0usize;
    let mut in_inline_list = false;

    while index < chars.len() {
        if should_split_inline_list_marker(&chars, index, segment_start, in_inline_list) {
            if !output.ends_with('\n') {
                output.push('\n');
            }
            output.push_str("- ");
            index += 1;
            while index < chars.len() && chars[index].is_whitespace() {
                index += 1;
            }
            segment_start = index;
            in_inline_list = true;
            continue;
        }

        output.push(chars[index]);
        index += 1;
    }

    output
}

fn should_split_inline_list_marker(
    chars: &[char],
    index: usize,
    segment_start: usize,
    in_inline_list: bool,
) -> bool {
    if chars[index] != '-' || index == 0 || chars[index - 1].is_whitespace() {
        return false;
    }
    let Some(next) = chars.get(index + 1).copied() else {
        return false;
    };
    if !(next.is_whitespace() || next.is_alphanumeric()) {
        return false;
    }
    if in_inline_list && next.is_whitespace() {
        return true;
    }
    if matches!(chars[index - 1], ':' | '：') {
        return true;
    }

    let prefix = chars[segment_start..index]
        .iter()
        .collect::<String>()
        .trim()
        .to_string();
    if prefix.ends_with("清单") || prefix.ends_with("列表") || prefix.ends_with("要点") {
        return true;
    }
    false
}

/// 检测某一行是否是 Callout 起始行（形如 `[!info] 标题` 或 `> [!info] 标题`）
///
/// 返回 Some("info") / Some("note") 等 callout 类型（若命中），否则 None
fn detect_callout_type(line: &str) -> Option<&'static str> {
    // 去掉开头可能已有的 "> " 前缀（幂等性检查）
    let without_prefix = line.trim_start_matches("> ").trim_start_matches('>');
    let trimmed = without_prefix.trim_start();
    if !trimmed.starts_with("[!") {
        return None;
    }
    // 查找 "]" 结束符
    let close_bracket = trimmed.find(']')?;
    let inner = &trimmed[2..close_bracket]; // 取出 [!xxx] 中的 xxx
    let inner_lower = inner.to_ascii_lowercase();
    CALLOUT_TYPES
        .iter()
        .copied()
        .find(|ty| *ty == inner_lower.as_str())
}

/// 判断某一行是否会"终止"当前 callout 的延续：
/// 空行 / ATX 标题 (`# ...`) / 新的 callout 起始 / 表格行（`|` 开头） /
/// 分隔线 (`---` / `***` / `===`) / frontmatter 边界
fn line_terminates_callout(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return true;
    }
    // ATX 标题（#, ##, ### ...）
    if trimmed.starts_with('#') {
        return true;
    }
    // 表格行（以 | 开头或仅由 | - 空格组成的表格分隔行）
    if trimmed.starts_with('|') {
        return true;
    }
    // 水平分隔线
    if trimmed == "---" || trimmed == "***" || trimmed == "===" {
        return true;
    }
    // 新 callout 起始
    if detect_callout_type(line).is_some() {
        return true;
    }
    false
}

/// 规范化 Markdown 中的 Obsidian Callout 前缀
///
/// LLM 生成 callout 时经常丢失 `> ` 前缀，导致 `[!info] 标题` 变成普通段落。
/// 本函数扫描整个文档，将未加前缀的 callout 起始行及其后续正文行补上 `> ` 前缀，
/// 直到遇到终止条件（空行 / 标题 / 新 callout / 表格 / 分隔线 / frontmatter 边界）。
///
/// 已经带有 `> ` 前缀的行保持不变，保证幂等性。
pub(crate) fn normalize_callout_prefixes(md: &str) -> String {
    let mut lines: Vec<String> = md.lines().map(|l| l.to_string()).collect();
    let mut i = 0;

    // 跳过 frontmatter（首行 `---` 到对应的闭合 `---`）
    if !lines.is_empty() && lines[0].trim() == "---" {
        i = 1;
        while i < lines.len() && lines[i].trim() != "---" {
            i += 1;
        }
        if i < lines.len() {
            i += 1; // 跳过闭合的 ---
        }
    }

    while i < lines.len() {
        let current = lines[i].clone();
        // 检测是否是 callout 起始行（无论当前是否已有 `> ` 前缀）
        if detect_callout_type(&current).is_some() {
            // 如果当前行没有以 `>` 开头，补上 `> ` 前缀
            if !current.trim_start().starts_with('>') {
                lines[i] = format!("> {}", current);
            }
            // 向下扫描后续正文行，补前缀直到遇到终止条件
            let mut j = i + 1;
            while j < lines.len() {
                let next = &lines[j];
                if line_terminates_callout(next) {
                    break;
                }
                if !next.trim_start().starts_with('>') {
                    lines[j] = format!("> {}", next);
                }
                j += 1;
            }
            // 若本次 callout 的终止原因是"紧邻一个新 callout 起始"，
            // 则在两者之间插入一个空行，防止 Markdown parser 把它们
            // 合并为同一个 blockquote（否则前端 CalloutBlockquote
            // 无法正确拆分渲染多个 callout）。
            if j < lines.len() && detect_callout_type(&lines[j]).is_some() {
                lines.insert(j, String::new());
                // 新插入的空行占据索引 j，真正的下一个 callout 起始
                // 现在位于 j + 1，下次循环从 j + 1 开始处理。
                i = j + 1;
            } else {
                i = j;
            }
            continue;
        }
        i += 1;
    }

    lines.join("\n")
}

/// 判断一段候选 frontmatter 内容是否像真实的 frontmatter（至少含 2 个常见字段）
fn content_looks_like_frontmatter(content: &[String]) -> bool {
    let mut hit_count = 0;
    for line in content {
        let trimmed = line.trim();
        if let Some(colon_idx) = trimmed.find(':') {
            let key = trimmed[..colon_idx].trim().to_ascii_lowercase();
            if FRONTMATTER_KEYS.contains(&key.as_str()) {
                hit_count += 1;
                if hit_count >= 2 {
                    return true;
                }
            }
        }
    }
    false
}

/// 规范化 Markdown 文档的 frontmatter 包装格式
///
/// LLM 有时会把 YAML frontmatter 输出成 `` ```yaml ... ``` `` 代码块，
/// 而不是 Obsidian / Jekyll / Hugo 等工具需要的裸 `---...---` 边界。
/// 本函数检测文档开头（可能带引言套话）是否存在 `` ```yaml `` 代码块，
/// 若代码块内容看起来像 frontmatter（至少 2 个常见字段），则：
///
/// 1. 剥掉 `` ``` `` 栅栏
/// 2. 用 `---...---` 包围内容
/// 3. 删除代码块前的所有引言文本（如"这是一份..."套话）
///
/// 若文档已经是标准 `---...---` 格式、或没有 frontmatter、或代码块内容不像
/// frontmatter，则保持原样返回（幂等性）。
pub(crate) fn normalize_frontmatter_fencing(md: &str) -> String {
    let lines: Vec<&str> = md.lines().collect();
    if lines.is_empty() {
        return md.to_string();
    }

    // 情况 A：已经是标准 `---...---` 格式（首个非空行是 `---`），不处理
    let first_non_empty = lines.iter().position(|l| !l.trim().is_empty());
    if let Some(idx) = first_non_empty {
        if lines[idx].trim() == "---" {
            return md.to_string();
        }
    }

    // 情况 B：扫描前若干行（最多前 20 行），查找 ```yaml 代码块开头
    let mut fence_start: Option<usize> = None;
    let scan_limit = lines.len().min(20);
    for (i, line) in lines.iter().enumerate().take(scan_limit) {
        let trimmed = line.trim();
        // 允许 ```yaml 或 ```yml（不区分大小写）
        if trimmed.eq_ignore_ascii_case("```yaml") || trimmed.eq_ignore_ascii_case("```yml") {
            fence_start = Some(i);
            break;
        }
        // 遇到 H1 标题（# xxx）说明已经进入正文，停止扫描
        if trimmed.starts_with("# ") {
            break;
        }
    }

    let fence_start = match fence_start {
        Some(i) => i,
        None => return md.to_string(), // 没找到 ```yaml，不处理
    };

    // 查找对应的闭合 ```
    let mut fence_end: Option<usize> = None;
    for (offset, line) in lines.iter().enumerate().skip(fence_start + 1) {
        if line.trim() == "```" {
            fence_end = Some(offset);
            break;
        }
    }
    let fence_end = match fence_end {
        Some(i) => i,
        None => return md.to_string(), // 代码块未闭合，不处理
    };

    // 提取代码块内容
    let content: Vec<String> = lines[fence_start + 1..fence_end]
        .iter()
        .map(|s| s.to_string())
        .collect();

    // 内容必须看起来像 frontmatter（至少 2 个常见字段）
    if !content_looks_like_frontmatter(&content) {
        return md.to_string();
    }

    // 构建新文档：--- + frontmatter 内容 + --- + 代码块后的所有内容
    let mut result: Vec<String> = Vec::with_capacity(lines.len() + 2);
    result.push("---".to_string());
    for line in &content {
        result.push(line.clone());
    }
    result.push("---".to_string());
    for line in lines.iter().skip(fence_end + 1) {
        result.push(line.to_string());
    }

    result.join("\n")
}

#[cfg(test)]
mod tests {
    use std::{io, net::SocketAddr, time::Duration};

    use axum::{
        body::Body,
        extract::State,
        http::{header, StatusCode},
        response::sse::{Event, KeepAlive, Sse},
        routing::post,
        Json, Router,
    };
    use futures_util::{stream, Stream};
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio_util::{codec::LinesCodecError, sync::CancellationToken};

    use crate::{
        ai_integration::{AiIntegration, AskAiRequest},
        errors::AppErrorCode,
        keychain::KeychainService,
        models::{DocumentSourceType, ProviderId},
        storage::{chat_messages, chat_sessions, documents, migration, provider_settings, Storage},
    };

    use super::{
        consume_sse_lines, is_recoverable_stream_read_error, normalize_callout_prefixes,
        normalize_frontmatter_fencing, normalize_summary_markdown, run_stream_request,
        PreparedStream, StreamOutcome,
    };
    use crate::ai_integration::provider_registry::PromptMessage;

    #[derive(Clone)]
    struct MockState;

    // ---------- normalize_callout_prefixes 测试 ----------

    #[test]
    fn normalize_adds_prefix_to_single_line_callout() {
        let input = "[!info] 原料来源\n胎土以高岭土为主。";
        let expected = "> [!info] 原料来源\n> 胎土以高岭土为主。";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_handles_multiline_callout_until_blank_line() {
        let input = "[!info] 烧成温度\n第一行内容。\n第二行内容。\n\n## 下一节";
        let expected = "> [!info] 烧成温度\n> 第一行内容。\n> 第二行内容。\n\n## 下一节";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_handles_adjacent_callouts() {
        let input = "[!info] 原料\n胎土高岭。\n[!info] 成型\n盘筑。";
        // 相邻 callout 之间应自动插入空行，防止被 Markdown parser 合并
        let expected = "> [!info] 原料\n> 胎土高岭。\n\n> [!info] 成型\n> 盘筑。";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_inserts_blank_line_between_callouts_already_prefixed() {
        // 即使 LLM 已经写了 `> ` 前缀，但相邻 callout 之间没有空行，
        // 也应该被自动插入空行（避免前端合并渲染 bug）
        let input = "> [!question] 第一个问题？\n> [!question] 第二个问题？";
        let expected = "> [!question] 第一个问题？\n\n> [!question] 第二个问题？";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_handles_three_adjacent_callouts() {
        let input = "[!info] A\n[!info] B\n[!info] C";
        let expected = "> [!info] A\n\n> [!info] B\n\n> [!info] C";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_preserves_existing_blank_line_between_callouts() {
        // 已有空行分隔的相邻 callout 不应该被加第二个空行（幂等性）
        let input = "> [!info] A\n> 正文。\n\n> [!info] B\n> 正文。";
        assert_eq!(normalize_callout_prefixes(input), input);
    }

    #[test]
    fn normalize_is_idempotent_when_prefix_already_present() {
        let input = "> [!info] 原料\n> 胎土高岭。\n\n其他文本。";
        let output = normalize_callout_prefixes(input);
        assert_eq!(output, input);
    }

    #[test]
    fn normalize_stops_at_heading_boundary() {
        let input = "[!info] 原料\n胎土高岭。\n## 下一节\n正文";
        let expected = "> [!info] 原料\n> 胎土高岭。\n## 下一节\n正文";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_skips_frontmatter() {
        let input = "---\ntitle: 测试\ntags:\n  - x\n---\n\n# 标题\n\n[!abstract] 结论\n一句话。";
        let expected =
            "---\ntitle: 测试\ntags:\n  - x\n---\n\n# 标题\n\n> [!abstract] 结论\n> 一句话。";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_stops_at_table_row() {
        let input = "[!info] 样品\n样品来自某遗址。\n| 列1 | 列2 |\n|---|---|\n| a | b |";
        let output = normalize_callout_prefixes(input);
        // 表格行应该终止 callout，不被补前缀
        assert!(output.starts_with("> [!info] 样品\n> 样品来自某遗址。\n| 列1 | 列2 |"));
    }

    #[test]
    fn normalize_handles_mixed_case_callout_type() {
        // [!Info] 大写形式也应被识别
        let input = "[!Info] 标题\n内容。";
        let expected = "> [!Info] 标题\n> 内容。";
        assert_eq!(normalize_callout_prefixes(input), expected);
    }

    #[test]
    fn normalize_ignores_unknown_bracket_tag() {
        // [!foo] 不是合法 callout 类型，不应被处理
        let input = "[!foo] 未知类型\n内容。";
        let output = normalize_callout_prefixes(input);
        assert_eq!(output, input);
    }

    #[test]
    fn normalize_preserves_non_callout_content() {
        let input = "# 标题\n\n普通段落。\n\n- 列表项\n\n更多段落。";
        let output = normalize_callout_prefixes(input);
        assert_eq!(output, input);
    }

    #[test]
    fn normalize_handles_empty_input() {
        assert_eq!(normalize_callout_prefixes(""), "");
    }

    // ---------- normalize_frontmatter_fencing 测试 ----------

    #[test]
    fn frontmatter_strips_yaml_fence_and_preamble() {
        let input = "这是一份基于所提供论文摘录的科技考古精读笔记。\n\n```yaml\ntitle: \"测试论文\"\nauthors: \"张三, 李四\"\nyear: 2026\ntags: [\"黑陶\"]\n```\n\n# 标题\n\n正文内容。";
        let output = normalize_frontmatter_fencing(input);
        assert!(output.starts_with("---\ntitle: \"测试论文\""));
        assert!(output.contains("authors: \"张三, 李四\""));
        assert!(output.contains("\n---\n"));
        assert!(output.contains("# 标题"));
        assert!(!output.contains("```yaml"));
        // 引言套话应该被删除
        assert!(!output.contains("这是一份基于"));
    }

    #[test]
    fn frontmatter_is_idempotent_when_already_dashed() {
        let input = "---\ntitle: \"已规范\"\nauthors: \"张三\"\n---\n\n# 标题";
        assert_eq!(normalize_frontmatter_fencing(input), input);
    }

    #[test]
    fn frontmatter_does_not_touch_document_without_frontmatter() {
        let input = "# 论文标题\n\n正文第一段。\n\n## 二级标题\n\n更多内容。";
        assert_eq!(normalize_frontmatter_fencing(input), input);
    }

    #[test]
    fn frontmatter_ignores_unrelated_yaml_code_block() {
        // 代码块内容不像 frontmatter（只是示例 yaml 配置），不应被改动
        let input =
            "# 标题\n\n参考下面的配置：\n\n```yaml\nport: 8080\nhost: localhost\n```\n\n说明。";
        assert_eq!(normalize_frontmatter_fencing(input), input);
    }

    #[test]
    fn frontmatter_strips_yml_variant_fence() {
        // ```yml 也应该被识别（部分工具用这个扩展名）
        let input = "```yml\ntitle: \"测试\"\nauthors: \"张三\"\n```\n\n# 标题";
        let output = normalize_frontmatter_fencing(input);
        assert!(output.starts_with("---\ntitle: \"测试\""));
        assert!(!output.contains("```yml"));
    }

    #[test]
    fn frontmatter_requires_two_known_fields() {
        // 只有 1 个已知字段的代码块不应被改动
        let input = "```yaml\ntitle: \"只有一个字段\"\n```\n\n# 标题";
        assert_eq!(normalize_frontmatter_fencing(input), input);
    }

    #[test]
    fn frontmatter_preserves_body_content() {
        let input = "```yaml\ntitle: \"测试\"\nyear: 2026\ntags: [\"a\"]\n```\n\n# 标题\n\n## 章节 A\n\n> [!info] 注释\n> 正文内容\n\n| 列1 | 列2 |\n|---|---|\n| a | b |";
        let output = normalize_frontmatter_fencing(input);
        // 正文部分应该完整保留
        assert!(output.contains("# 标题"));
        assert!(output.contains("## 章节 A"));
        assert!(output.contains("> [!info] 注释"));
        assert!(output.contains("| 列1 | 列2 |"));
    }

    #[test]
    fn frontmatter_handles_empty_input() {
        assert_eq!(normalize_frontmatter_fencing(""), "");
    }

    #[test]
    fn frontmatter_pipeline_with_callout_normalization() {
        // 模拟真实 LLM 输出：引言 + yaml 代码块 + 漏 `> ` 前缀的 callout
        let input = "这是一份笔记。\n\n```yaml\ntitle: \"测试\"\nauthors: \"张三\"\nyear: 2026\n```\n\n# 标题\n\n[!abstract] 结论\n一句话说明。\n\n## 下一节";
        let step1 = normalize_frontmatter_fencing(input);
        let step2 = normalize_callout_prefixes(&step1);
        // 第一步：去掉引言和栅栏
        assert!(step2.starts_with("---\ntitle: \"测试\""));
        assert!(!step2.contains("这是一份笔记"));
        assert!(!step2.contains("```yaml"));
        // 第二步：callout 补前缀
        assert!(step2.contains("> [!abstract] 结论"));
        assert!(step2.contains("> 一句话说明。"));
    }

    #[test]
    fn summary_normalizer_repairs_compacted_frontmatter_callout_table_and_list() {
        let input = "title: 科技考古论文精读 authors: 李口, 王口 year:2025source: Journal tags: [archaeometry, ceramic]# 标题> [!abstract] 摘要\n本研究讨论样品。## 数据表| 项目 | 结论 | |------|------| | 胎土 | 高岭土 |清单- 能量色散- 拉曼解读：-李口遗址显示连续生产。";
        let output = normalize_summary_markdown(input);

        assert!(output.starts_with("---\ntitle: 科技考古论文精读\n"));
        assert!(output.contains("\nauthors: 李口, 王口\n"));
        assert!(output.contains("\nyear: 2025\n"));
        assert!(output.contains("\nsource: Journal\n"));
        assert!(output.contains("\ntags: [archaeometry, ceramic]\n---\n\n# 标题\n\n"));
        assert!(output.contains("> [!abstract] 摘要\n> 本研究讨论样品。"));
        assert!(output.contains("\n## 数据表\n"));
        assert!(output.contains("| 项目 | 结论 |\n|------|------|\n| 胎土 | 高岭土 |"));
        assert!(output.contains("清单\n- 能量色散\n- 拉曼"));
        assert!(output.contains("解读：\n- 李口遗址显示连续生产。"));
    }

    #[test]
    fn summary_normalizer_splits_heading_from_table_header_when_separator_on_next_line() {
        // 用户实际场景：标题和表头行在同一行，分隔行独立存在
        let input = "## 🏺样品信息速览|遗址 |地理位置 |年代 |样品类型 |样品数量 |保存状况 |\n|------|----------|------|----------|----------|----------|\n|大朱庄 |河南省永城市裴桥镇大朱庄村西北侧 |龙山文化期（2300–1800 BCE） |细泥灰陶、细泥褐陶 |15件 |未具体说明 |";
        let output = normalize_summary_markdown(input);

        assert!(output.contains("## 🏺样品信息速览\n\n"), "标题后应有空行: {output}");
        assert!(output.contains("|遗址 |地理位置 |年代 |样品类型 |样品数量 |保存状况 |\n|------|----------|------|----------|----------|----------|\n|大朱庄"), "表格应有表头、分隔行、数据行");
    }

    #[test]
    fn summary_normalizer_splits_heading_from_table_with_mixed_heading_levels() {
        // 三级标题 + 表头 压缩
        let input = "### 化学成分对比|氧化物 |大朱庄 |李口 |\n|---|---|---|\n| SiO₂ |67.93 |67.10 |";
        let output = normalize_summary_markdown(input);

        assert!(output.contains("### 化学成分对比\n\n"), "三级标题后应有空行");
        assert!(output.contains("|氧化物 |大朱庄 |李口 |\n|---|---|---|\n| SiO₂ |67.93 |67.10 |"), "表格结构应保持");
    }

    #[test]
    fn summary_normalizer_is_idempotent_for_well_formed_markdown() {
        let input = "---\ntitle: 已规范\nauthors: 张三\nyear: 2026\n---\n\n# 标题\n\n> [!abstract] 摘要\n> 正文。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- 条目";
        assert_eq!(normalize_summary_markdown(input), input);
    }

    #[test]
    fn summary_normalizer_preserves_ordinary_text_and_chemical_formulae() {
        let input = "# 标题\n\nC-14 测年与 Fe-O 键、Mg-Al 组合均应保持原样。\n普通正文-不是列表，也不应该被拆开。";
        assert_eq!(normalize_summary_markdown(input), input);
    }

    #[test]
    fn summary_normalizer_preserves_table_cell_hyphens() {
        let input = "| 项目 | 结论 |\n|---|---|\n| 化学式 | Fe-O 与 C-14 未变化 |";
        assert_eq!(normalize_summary_markdown(input), input);
    }

    async fn openai_stream(
        State(_state): State<MockState>,
        Json(_body): Json<Value>,
    ) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
        let events = vec![
            Ok(Event::default().data(
                r#"{"choices":[{"delta":{"content":"Hello"}}]}"#,
            )),
            Ok(Event::default().data(
                r#"{"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}"#,
            )),
            Ok(Event::default().data("[DONE]")),
        ];

        Sse::new(stream::iter(events)).keep_alive(KeepAlive::new().interval(Duration::from_secs(1)))
    }

    async fn empty_stream(
        State(_state): State<MockState>,
        Json(_body): Json<Value>,
    ) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
        let events = vec![
            Ok(Event::default().data(
                r#"{"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":1}}"#,
            )),
            Ok(Event::default().data("[DONE]")),
        ];

        Sse::new(stream::iter(events)).keep_alive(KeepAlive::new().interval(Duration::from_secs(1)))
    }

    async fn stream_without_trailing_newline(
        State(_state): State<MockState>,
        Json(_body): Json<Value>,
    ) -> impl axum::response::IntoResponse {
        (
            [(header::CONTENT_TYPE, "text/event-stream")],
            Body::from(r#"data: {"choices":[{"delta":{"content":"Tail"}}]}"#),
        )
    }

    async fn provider_rate_limited(
        State(_state): State<MockState>,
        Json(_body): Json<Value>,
    ) -> impl axum::response::IntoResponse {
        (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded")
    }

    async fn boot_mock_server() -> SocketAddr {
        let router = Router::new()
            .route("/chat/completions", post(openai_stream))
            .route("/v1/chat/completions", post(openai_stream))
            .with_state(MockState);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        address
    }

    async fn boot_empty_stream_server() -> SocketAddr {
        let router = Router::new()
            .route("/chat/completions", post(empty_stream))
            .route("/v1/chat/completions", post(empty_stream))
            .with_state(MockState);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        address
    }

    async fn boot_stream_without_trailing_newline_server() -> SocketAddr {
        let router = Router::new()
            .route("/chat/completions", post(stream_without_trailing_newline))
            .route(
                "/v1/chat/completions",
                post(stream_without_trailing_newline),
            )
            .with_state(MockState);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        address
    }

    async fn boot_provider_http_error_server() -> SocketAddr {
        let router = Router::new()
            .route("/chat/completions", post(provider_rate_limited))
            .route("/v1/chat/completions", post(provider_rate_limited))
            .with_state(MockState);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        address
    }

    fn test_prepared_stream(stream_id: &str) -> PreparedStream {
        PreparedStream {
            stream_id: stream_id.to_string(),
            session_id: format!("session-{stream_id}"),
            provider: ProviderId::Openai,
            model: "gpt-4o-mini".to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            messages: vec![PromptMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            document_id: format!("document-{stream_id}"),
        }
    }

    async fn run_openai_stream_request_against(
        address: SocketAddr,
        stream_id: &str,
    ) -> Result<StreamOutcome, crate::errors::AppError> {
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();

        {
            let connection = storage.connection();
            migration::run(&connection).unwrap();
            connection
                .execute(
                    "UPDATE provider_settings SET base_url = ?1, is_active = 1, model = 'gpt-4o-mini' WHERE provider = 'openai'",
                    rusqlite::params![format!("http://{}", address)],
                )
                .unwrap();
        }

        let app = tauri::test::mock_app();
        let cancellation = CancellationToken::new();
        let prepared = test_prepared_stream(stream_id);

        run_stream_request(&app.handle().clone(), &ai, &prepared, &cancellation).await
    }

    async fn boot_truncated_raw_sse_server(body: &'static str) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            let _ = socket.read(&mut request).await;

            let declared_length = body.len() + 1024;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {declared_length}\r\nconnection: close\r\n\r\n{body}",
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            let _ = socket.shutdown().await;
        });

        address
    }

    #[tokio::test]
    async fn mock_provider_stream_writes_usage_event() {
        let address = boot_mock_server().await;
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();

        {
            let connection = storage.connection();
            migration::run(&connection).unwrap();
            let document = documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/mock.pdf".to_string(),
                    file_sha256: "sha".to_string(),
                    title: "Mock".to_string(),
                    page_count: 1,
                    source_type: crate::models::DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            )
            .unwrap();

            provider_settings::update_test_status(&connection, "openai", Some("ready"), None)
                .unwrap();
            connection
                .execute(
                    "UPDATE provider_settings SET base_url = ?1, is_active = 1, model = 'gpt-4o-mini' WHERE provider = 'openai'",
                    rusqlite::params![format!("http://{}", address)],
                )
                .unwrap();

            drop(document);
        }

        let app = tauri::test::mock_app();
        let _handle = ai
            .ask(
                app.handle().clone(),
                AskAiRequest {
                    document_id: {
                        let connection = storage.connection();
                        documents::list_recent(&connection, 1)
                            .unwrap()
                            .remove(0)
                            .document_id
                    },
                    session_id: None,
                    provider: Some(ProviderId::Openai),
                    model: Some("gpt-4o-mini".to_string()),
                    user_message: "hello".to_string(),
                    context_quote: None,
                },
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn run_stream_request_returns_error_when_provider_finishes_without_text() {
        let address = boot_empty_stream_server().await;
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();

        {
            let connection = storage.connection();
            migration::run(&connection).unwrap();
            connection
                .execute(
                    "UPDATE provider_settings SET base_url = ?1, is_active = 1, model = 'claude-sonnet-4-6' WHERE provider = 'openai'",
                    rusqlite::params![format!("http://{}", address)],
                )
                .unwrap();
        }

        let app = tauri::test::mock_app();
        let cancellation = CancellationToken::new();
        let prepared = PreparedStream {
            stream_id: "stream-empty".to_string(),
            session_id: "session-empty".to_string(),
            provider: ProviderId::Openai,
            model: "claude-sonnet-4-6".to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            messages: vec![PromptMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            document_id: "document-empty".to_string(),
        };

        let error = run_stream_request(&app.handle().clone(), &ai, &prepared, &cancellation)
            .await
            .unwrap_err();

        assert_eq!(
            error.code,
            crate::errors::AppErrorCode::ProviderConnectionFailed
        );
        assert!(error.message.contains("空响应"));
        assert_eq!(
            error.details.as_ref().unwrap()["payloadCount"],
            serde_json::json!(1)
        );
    }

    #[tokio::test]
    async fn run_stream_request_consumes_last_sse_payload_without_trailing_newline() {
        let address = boot_stream_without_trailing_newline_server().await;
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();

        {
            let connection = storage.connection();
            migration::run(&connection).unwrap();
            connection
                .execute(
                    "UPDATE provider_settings SET base_url = ?1, is_active = 1, model = 'gpt-4o-mini' WHERE provider = 'openai'",
                    rusqlite::params![format!("http://{}", address)],
                )
                .unwrap();
        }

        let app = tauri::test::mock_app();
        let cancellation = CancellationToken::new();
        let prepared = PreparedStream {
            stream_id: "stream-tail".to_string(),
            session_id: "session-tail".to_string(),
            provider: ProviderId::Openai,
            model: "gpt-4o-mini".to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            messages: vec![PromptMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            document_id: "document-tail".to_string(),
        };

        let outcome = run_stream_request(&app.handle().clone(), &ai, &prepared, &cancellation)
            .await
            .unwrap();

        match outcome {
            StreamOutcome::Completed { text, thinking, .. } => {
                assert_eq!(text, "Tail");
                assert!(thinking.is_none());
            }
            StreamOutcome::Cancelled => panic!("EOF without trailing newline should not cancel"),
        }
    }

    #[tokio::test]
    async fn run_stream_request_preserves_partial_content_when_body_decode_fails_after_delta() {
        let address = boot_truncated_raw_sse_server(
            r#"data: {"choices":[{"delta":{"content":"Partial"}}]}

"#,
        )
        .await;

        let outcome = run_openai_stream_request_against(address, "stream-truncated")
            .await
            .unwrap();

        match outcome {
            StreamOutcome::Completed { text, thinking, .. } => {
                assert_eq!(text, "Partial");
                assert!(thinking.is_none());
            }
            StreamOutcome::Cancelled => panic!("body decode failure after content should finish"),
        }
    }

    #[tokio::test]
    async fn run_stream_request_fails_cleanly_when_body_decode_fails_before_content() {
        let address = boot_truncated_raw_sse_server(
            r#"data: {"choices":[{"delta":{}}]}

"#,
        )
        .await;

        let error = run_openai_stream_request_against(address, "stream-empty-truncated")
            .await
            .unwrap_err();

        assert_eq!(error.code, AppErrorCode::ProviderConnectionFailed);
        assert!(error.retryable);
        assert!(error.message.contains("未收到可用内容"));
        assert!(!error.message.contains("解析 SSE 行失败"));
        assert!(!error.message.contains("SSE 字节流读取失败"));
        assert_eq!(
            error.details.as_ref().unwrap()["payloadCount"],
            serde_json::json!(1)
        );
    }

    #[tokio::test]
    async fn run_stream_request_preserves_provider_http_error_mapping() {
        let address = boot_provider_http_error_server().await;

        let error = run_openai_stream_request_against(address, "stream-rate-limited")
            .await
            .unwrap_err();

        assert_eq!(error.code, AppErrorCode::ProviderRateLimited);
        assert!(error.retryable);
        assert!(error.message.contains("HTTP 429"));
        assert!(error.message.contains("rate limit exceeded"));
        assert!(!error.message.contains("未收到可用内容"));
        assert!(!error.message.contains("解析 SSE 行失败"));
        assert!(!error.message.contains("SSE 字节流读取失败"));
    }

    #[tokio::test]
    async fn consume_sse_lines_preserves_partial_content_for_recoverable_read_errors() {
        let cases = [
            (
                "decode",
                LinesCodecError::Io(io::Error::other("error decoding response body")),
            ),
            (
                "eof",
                LinesCodecError::Io(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "unexpected EOF while reading body",
                )),
            ),
            (
                "closed",
                LinesCodecError::Io(io::Error::new(
                    io::ErrorKind::ConnectionReset,
                    "connection closed before message completed",
                )),
            ),
        ];

        for (label, error) in cases {
            assert!(
                is_recoverable_stream_read_error(&error),
                "{label} should be recognized as recoverable"
            );

            let app = tauri::test::mock_app();
            let cancellation = CancellationToken::new();
            let prepared = test_prepared_stream(&format!("stream-{label}"));
            let lines = stream::iter(vec![
                Ok(r#"data: {"choices":[{"delta":{"content":"Partial"}}]}"#.to_string()),
                Err(error),
            ]);

            let outcome = consume_sse_lines(&app.handle().clone(), &prepared, &cancellation, lines)
                .await
                .unwrap();

            match outcome {
                StreamOutcome::Completed { text, thinking, .. } => {
                    assert_eq!(text, "Partial");
                    assert!(thinking.is_none());
                }
                StreamOutcome::Cancelled => panic!("{label} should finish with partial content"),
            }
        }
    }

    #[tokio::test]
    async fn start_chat_rejects_session_from_another_document() {
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new(&std::env::temp_dir());
        let ai = AiIntegration::new(storage.clone(), keychain.clone()).unwrap();
        let timestamp = chrono::Utc::now().to_rfc3339();

        let (document_id, other_document_id, session_id) = {
            let connection = storage.connection();
            migration::run(&connection).unwrap();

            let document = documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/one.pdf".to_string(),
                    file_sha256: "sha-one".to_string(),
                    title: "One".to_string(),
                    page_count: 1,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap();
            let other_document = documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/two.pdf".to_string(),
                    file_sha256: "sha-two".to_string(),
                    title: "Two".to_string(),
                    page_count: 1,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap();

            connection
                .execute(
                    "UPDATE provider_settings SET base_url = 'http://127.0.0.1:9', is_active = 1, model = 'gpt-4o-mini' WHERE provider = 'openai'",
                    [],
                )
                .unwrap();

            let session = chat_sessions::create(
                &connection,
                &chat_sessions::CreateChatSessionParams {
                    document_id: document.document_id.clone(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    title: Some("Existing session".to_string()),
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap();

            (
                document.document_id,
                other_document.document_id,
                session.session_id,
            )
        };

        let app = tauri::test::mock_app();
        let error = ai
            .ask(
                app.handle().clone(),
                AskAiRequest {
                    document_id: other_document_id,
                    session_id: Some(session_id.clone()),
                    provider: Some(ProviderId::Openai),
                    model: Some("gpt-4o-mini".to_string()),
                    user_message: "hello".to_string(),
                    context_quote: None,
                },
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, AppErrorCode::ChatSessionNotFound);
        assert_eq!(error.message, "聊天会话不属于当前文档");

        let messages = {
            let connection = storage.connection();
            chat_messages::list_by_session(&connection, &session_id).unwrap()
        };
        assert!(messages.is_empty());

        let session_document_id = {
            let connection = storage.connection();
            chat_sessions::get_by_id(&connection, &session_id)
                .unwrap()
                .unwrap()
                .document_id
        };
        assert_eq!(session_document_id, document_id);
    }
}
