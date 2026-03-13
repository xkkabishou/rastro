// 问答流服务
use chrono::Utc;
use futures_util::StreamExt;
use serde_json::json;
use tauri::Emitter;
use tokio::select;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    ai_integration::{
        provider_registry, usage_meter, AiIntegration, AskAiRequest, GenerateSummaryRequest,
        StreamHandleResult,
    },
    errors::{AppError, AppErrorCode},
    models::{ChatRole, ProviderId, SummaryPromptProfile, UsageFeature},
    storage::{chat_messages, chat_sessions, usage_events},
};

struct PreparedStream {
    stream_id: String,
    session_id: String,
    provider: ProviderId,
    model: String,
    started_at: String,
    prompt: String,
    document_id: String,
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
        let resolved_usage = usage.take().unwrap_or_else(|| {
            usage_meter::UsageSnapshot::fallback(
                prepared.provider,
                &prepared.model,
                &prepared.prompt,
                full_text,
            )
        });

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
        let _ = app.emit(
            "ai://stream-chunk",
            json!({
                "streamId": prepared.stream_id,
                "delta": thinking_delta,
                "kind": "thinking",
            }),
        );
    }

    if let Some(delta) = provider_registry::extract_stream_delta(prepared.provider, &payload) {
        full_text.push_str(&delta);
        let _ = app.emit(
            "ai://stream-chunk",
            json!({
                "streamId": prepared.stream_id,
                "delta": delta,
                "kind": "content",
            }),
        );
    }

    if usage.is_none() {
        *usage = usage_meter::extract_usage(prepared.provider, &payload, &prepared.model);
    }

    Ok(None)
}

/// 启动普通聊天流
pub async fn start_chat<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    input: AskAiRequest,
) -> Result<StreamHandleResult, AppError> {
    let config =
        provider_registry::resolve_runtime_config(&ai, input.provider, input.model.clone())?;
    let started_at = Utc::now().to_rfc3339();
    let session_title = Some(truncate_title(&input.user_message));
    let prompt = build_chat_prompt(&input);

    let session_id = {
        let connection = ai.storage.connection();
        if let Some(session_id) = input.session_id.clone() {
            let Some(existing) = chat_sessions::get_by_id(&connection, &session_id)? else {
                return Err(AppError::new(
                    AppErrorCode::ChatSessionNotFound,
                    "聊天会话不存在",
                    false,
                ));
            };

            if existing.document_id != input.document_id {
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
                    document_id: input.document_id.clone(),
                    provider: config.provider.as_str().to_string(),
                    model: config.model.clone(),
                    title: session_title.clone(),
                    timestamp: started_at.clone(),
                },
            )?;
            session.session_id
        }
    };

    {
        let connection = ai.storage.connection();
        chat_messages::create(
            &connection,
            &chat_messages::CreateChatMessageParams {
                session_id: session_id.clone(),
                role: ChatRole::User.as_str().to_string(),
                content_md: input.user_message.clone(),
                thinking_md: None,
                context_quote: input.context_quote.clone(),
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0.0,
                created_at: started_at.clone(),
            },
        )?;

        chat_sessions::update_metadata(
            &connection,
            &session_id,
            session_title.as_deref(),
            &started_at,
        )?;
    }

    start_stream(
        app,
        ai,
        config.provider,
        config.model,
        input.document_id,
        session_id,
        started_at,
        prompt,
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
    let config =
        provider_registry::resolve_runtime_config(&ai, input.provider, input.model.clone())?;
    let started_at = Utc::now().to_rfc3339();
    let session_title = Some(format!("Summary · {}", input.prompt_profile.as_str()));

    let session_id = {
        let connection = ai.storage.connection();
        let session = chat_sessions::create(
            &connection,
            &chat_sessions::CreateChatSessionParams {
                document_id: input.document_id.clone(),
                provider: config.provider.as_str().to_string(),
                model: config.model.clone(),
                title: session_title.clone(),
                timestamp: started_at.clone(),
            },
        )?;
        session.session_id
    };

    start_stream(
        app,
        ai,
        config.provider,
        config.model,
        input.document_id,
        session_id,
        started_at,
        build_summary_prompt(&input.file_path, &input.source_text, input.prompt_profile),
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
    prompt: String,
    feature: UsageFeature,
) -> Result<StreamHandleResult, AppError> {
    let prepared = PreparedStream {
        stream_id: Uuid::new_v4().to_string(),
        session_id,
        provider,
        model,
        started_at,
        prompt,
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
            let finished_at = Utc::now().to_rfc3339();
            let message_result = {
                let connection = ai.storage.connection();
                let message = chat_messages::create(
                    &connection,
                    &chat_messages::CreateChatMessageParams {
                        session_id: prepared.session_id.clone(),
                        role: ChatRole::Assistant.as_str().to_string(),
                        content_md: text.clone(),
                        thinking_md: thinking.clone(),
                        context_quote: None,
                        input_tokens: usage.input_tokens as u32,
                        output_tokens: usage.output_tokens as u32,
                        estimated_cost: usage.estimated_cost,
                        created_at: finished_at.clone(),
                    },
                );

                if message.is_ok() {
                    let _ = chat_sessions::update_metadata(
                        &connection,
                        &prepared.session_id,
                        None,
                        &finished_at,
                    );

                    let _ = usage_events::create(
                        &connection,
                        &usage_events::CreateUsageEventParams {
                            document_id: Some(prepared.document_id.clone()),
                            provider: prepared.provider.as_str().to_string(),
                            model: prepared.model.clone(),
                            feature: feature.as_str().to_string(),
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                            estimated_cost: usage.estimated_cost,
                            currency: usage.currency.clone(),
                            created_at: finished_at.clone(),
                        },
                    );
                }

                message
            };

            match message_result {
                Ok(message) => {
                    let _ = app.emit(
                        "ai://stream-finished",
                        json!({
                            "streamId": prepared.stream_id,
                            "sessionId": prepared.session_id,
                            "messageId": message.message_id,
                        }),
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        "ai://stream-failed",
                        json!({
                            "streamId": prepared.stream_id,
                            "error": AppError::from(error),
                        }),
                    );
                }
            }
        }
        Ok(StreamOutcome::Cancelled) => {}
        Err(error) => {
            let _ = app.emit(
                "ai://stream-failed",
                json!({
                    "streamId": prepared.stream_id,
                    "error": error,
                }),
            );
        }
    }
}

async fn run_stream_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    ai: &AiIntegration,
    prepared: &PreparedStream,
    cancellation: &CancellationToken,
) -> Result<StreamOutcome, AppError> {
    let config = provider_registry::resolve_runtime_config(
        ai,
        Some(prepared.provider),
        Some(prepared.model.clone()),
    )?;

    let response = provider_registry::build_stream_request(&ai.client, &config, &prepared.prompt)
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

    let mut full_text = String::new();
    let mut full_thinking = String::new();
    let mut buffer = String::new();
    let mut usage = None;
    let mut payload_count = 0usize;
    let mut last_payload_preview: Option<String> = None;
    let mut bytes_stream = response.bytes_stream();

    loop {
        select! {
            _ = cancellation.cancelled() => {
                return Ok(StreamOutcome::Cancelled);
            }
            next = bytes_stream.next() => {
                match next {
                    Some(Ok(chunk)) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));

                        while let Some(position) = buffer.find('\n') {
                            let line = buffer[..position].to_string();
                            buffer = buffer[position + 1..].to_string();

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
                    }
                    Some(Err(error)) => return Err(AppError::from(error)),
                    None => {
                        if let Some(outcome) = process_sse_data_line(
                            app,
                            prepared,
                            &buffer,
                            &mut full_text,
                            &mut full_thinking,
                            &mut usage,
                            &mut payload_count,
                            &mut last_payload_preview,
                        )? {
                            return Ok(outcome);
                        }

                        let usage = usage.unwrap_or_else(|| {
                            usage_meter::UsageSnapshot::fallback(
                                prepared.provider,
                                &prepared.model,
                                &prepared.prompt,
                                &full_text,
                            )
                        });

                        return finalize_stream_outcome(
                            prepared,
                            full_text,
                            full_thinking,
                            usage,
                            payload_count,
                            last_payload_preview.as_deref(),
                        );
                    }
                }
            }
        }
    }
}

fn build_chat_prompt(input: &AskAiRequest) -> String {
    match &input.context_quote {
        Some(quote) if !quote.trim().is_empty() => format!(
            "请基于以下引用段落回答问题。\n\n引用：\n{}\n\n问题：{}",
            quote.trim(),
            input.user_message.trim()
        ),
        _ => input.user_message.trim().to_string(),
    }
}

fn build_summary_prompt(
    file_path: &str,
    source_text: &str,
    profile: SummaryPromptProfile,
) -> String {
    format!(
        "请基于下面的 PDF 正文摘录生成结构化摘要。\n文档路径：{}\nPrompt Profile：{}\n说明：正文摘录来自前端对 PDF 的文本提取，可能包含少量版式噪声；请只基于摘录内容作答，不要声称你直接访问了原始 PDF。\n\n正文摘录开始：\n{}\n\n正文摘录结束。",
        file_path,
        profile.as_str(),
        source_text.trim(),
    )
}

fn truncate_title(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= 36 {
        return trimmed.to_string();
    }

    trimmed.chars().take(36).collect()
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, time::Duration};

    use axum::{
        body::Body,
        extract::State,
        http::header,
        response::sse::{Event, KeepAlive, Sse},
        routing::post,
        Json, Router,
    };
    use futures_util::{stream, Stream};
    use serde_json::Value;
    use tokio::net::TcpListener;
    use tokio_util::sync::CancellationToken;

    use crate::{
        ai_integration::{AiIntegration, AskAiRequest},
        errors::AppErrorCode,
        keychain::KeychainService,
        models::{DocumentSourceType, ProviderId},
        storage::{chat_messages, chat_sessions, documents, migration, provider_settings, Storage},
    };

    use super::{run_stream_request, PreparedStream, StreamOutcome};

    #[derive(Clone)]
    struct MockState;

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

    #[tokio::test]
    async fn mock_provider_stream_writes_usage_event() {
        let address = boot_mock_server().await;
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new();
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
        let keychain = KeychainService::new();
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
            prompt: "hello".to_string(),
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
        let keychain = KeychainService::new();
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
            prompt: "hello".to_string(),
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
    async fn start_chat_rejects_session_from_another_document() {
        let storage = Storage::new_in_memory().unwrap();
        let keychain = KeychainService::new();
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
