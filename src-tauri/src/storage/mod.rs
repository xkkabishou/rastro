// SQLite 存储模块入口
pub mod annotations;
pub mod chat_messages;
pub mod chat_sessions;
pub mod custom_prompts;
pub mod document_summaries;
pub mod documents;
pub mod migration;
pub mod migrations;
pub mod obsidian_config;
pub mod provider_settings;
pub mod title_translations;
pub mod translation_artifacts;
pub mod translation_jobs;
pub mod translation_provider_settings;
pub mod usage_events;

use std::{path::Path, sync::Arc};

use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;

use crate::errors::AppError;

/// 共享 SQLite 连接包装
#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
}

impl Storage {
    /// 打开文件数据库并执行 migration
    pub fn new_file(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let connection = Connection::open(path)?;
        // 文件库启用 WAL，降低读写互相阻塞概率；in-memory 测试库保持默认 journal。
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Self::from_connection(connection)
    }

    /// 创建内存数据库并执行 migration
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory()?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, AppError> {
        let storage = Self {
            connection: Arc::new(Mutex::new(connection)),
        };

        {
            let conn = storage.connection.lock();
            migrations::run(&conn)?;
        }

        Ok(storage)
    }

    /// 获取底层连接锁
    pub fn connection(&self) -> MutexGuard<'_, Connection> {
        self.connection.lock()
    }

    /// 执行数据库健康检查
    pub fn healthcheck(&self) -> bool {
        self.connection()
            .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
            .map(|value| value == 1)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod storage_tests {
    use chrono::Utc;

    use crate::{
        models::{ArtifactKind, DocumentSourceType},
        storage::{
            chat_messages, chat_sessions, documents, provider_settings, translation_artifacts,
            translation_jobs, usage_events, Storage,
        },
    };

    #[test]
    fn storage_crud_roundtrip() {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let timestamp = Utc::now().to_rfc3339();

        let document = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/demo.pdf".to_string(),
                    file_sha256: "sha-001".to_string(),
                    title: "Demo".to_string(),
                    page_count: 3,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .expect("document upsert should succeed")
        };

        {
            let connection = storage.connection();
            let recent = documents::list_recent(&connection, 10).expect("recent documents");
            assert_eq!(recent.len(), 1);
            assert_eq!(recent[0].document_id, document.document_id);
        }

        let session = {
            let connection = storage.connection();
            chat_sessions::create(
                &connection,
                &chat_sessions::CreateChatSessionParams {
                    document_id: document.document_id.clone(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    title: Some("Session".to_string()),
                    timestamp: timestamp.clone(),
                },
            )
            .expect("chat session create should succeed")
        };

        {
            let connection = storage.connection();
            let sessions =
                chat_sessions::list_by_document(&connection, &document.document_id).unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].session_id, session.session_id);
        }

        {
            let connection = storage.connection();
            let message = chat_messages::create(
                &connection,
                &chat_messages::CreateChatMessageParams {
                    session_id: session.session_id.clone(),
                    role: "user".to_string(),
                    content_md: "hello".to_string(),
                    thinking_md: None,
                    context_quote: None,
                    input_tokens: 1,
                    output_tokens: 0,
                    estimated_cost: 0.0,
                    created_at: timestamp.clone(),
                },
            )
            .expect("chat message create should succeed");
            assert_eq!(message.session_id, session.session_id);
        }

        let job = {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document.document_id.clone(),
                    engine_job_id: Some("engine-1".to_string()),
                    cache_key: "cache-1".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "queued".to_string(),
                    stage: "queued".to_string(),
                    progress: 0.0,
                    created_at: timestamp.clone(),
                },
            )
            .expect("translation job create should succeed")
        };

        {
            let connection = storage.connection();
            translation_jobs::update_status(
                &connection,
                &job.job_id,
                "completed",
                "completed",
                100.0,
                None,
                None,
                Some(&timestamp),
                Some(&timestamp),
            )
            .expect("translation job update should succeed");
            let cached = translation_jobs::find_latest_completed_for_document(
                &connection,
                &document.document_id,
                Some("openai"),
                Some("gpt-4o-mini"),
            )
            .expect("completed translation lookup")
            .expect("completed translation should exist");
            assert_eq!(cached.job_id, job.job_id);
        }

        {
            let connection = storage.connection();
            let artifact = translation_artifacts::create(
                &connection,
                &translation_artifacts::CreateTranslationArtifactParams {
                    job_id: job.job_id.clone(),
                    document_id: document.document_id.clone(),
                    artifact_kind: ArtifactKind::TranslatedPdf.as_str().to_string(),
                    file_path: "/tmp/out.pdf".to_string(),
                    file_sha256: "sha-artifact".to_string(),
                    file_size_bytes: 42,
                    created_at: timestamp.clone(),
                },
            )
            .expect("translation artifact create should succeed");
            assert_eq!(artifact.job_id, job.job_id);
        }

        {
            let connection = storage.connection();
            let usage = usage_events::create(
                &connection,
                &usage_events::CreateUsageEventParams {
                    document_id: Some(document.document_id.clone()),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    feature: "chat".to_string(),
                    input_tokens: 10,
                    output_tokens: 20,
                    estimated_cost: 0.12,
                    currency: "USD".to_string(),
                    created_at: timestamp.clone(),
                },
            )
            .expect("usage event create should succeed");
            assert_eq!(usage.provider, "openai");
        }

        {
            let connection = storage.connection();
            let providers = provider_settings::list_all(&connection).expect("provider list");
            assert_eq!(providers.len(), 3);
            assert!(providers.iter().any(|record| record.provider == "openai"));
        }
    }

    /// 回归测试：验证 spawn_blocking 模式下并发查询不会阻塞 tokio runtime worker。
    /// 模拟 Wave 1 的核心修复——所有 async 上下文中的 SQLite 访问应通过 spawn_blocking
    /// 隔离到 blocking 线程池，避免持有 parking_lot::Mutex 跨 tokio worker。
    ///
    /// 期望：64 个并发查询在 5 秒内全部完成（in-memory SQLite 实际只需毫秒级），
    /// 任何死锁或线程池耗尽都会让该测试超时或失败。
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_spawn_blocking_queries_do_not_block_runtime() {
        use std::time::{Duration, Instant};

        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");

        // 预先插入一份文档作为查询目标
        let timestamp = Utc::now().to_rfc3339();
        {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/concurrent.pdf".to_string(),
                    file_sha256: "sha-concurrent".to_string(),
                    title: "Concurrent".to_string(),
                    page_count: 1,
                    source_type: crate::models::DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp,
                },
            )
            .expect("upsert should succeed");
        }

        let started = Instant::now();
        let mut handles = Vec::new();
        for _ in 0..64 {
            let storage_for_task = storage.clone();
            handles.push(tokio::task::spawn_blocking(move || {
                // 在 blocking 线程池里访问 SQLite，仿照生产代码模式
                let connection = storage_for_task.connection();
                documents::list_recent(&connection, 10).map(|records| records.len())
            }));
        }

        for handle in handles {
            let count = handle
                .await
                .expect("spawn_blocking task should not panic")
                .expect("query should succeed");
            assert!(count >= 1, "至少能查到刚插入的那条文档");
        }

        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(5),
            "64 个并发查询应在 5 秒内完成，但实际耗时 {:?}（可能存在阻塞或调度问题）",
            elapsed
        );
    }
}
