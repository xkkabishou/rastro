// SQLite 存储模块入口
pub mod chat_messages;
pub mod chat_sessions;
pub mod documents;
pub mod migration;
pub mod migrations;
pub mod provider_settings;
pub mod translation_artifacts;
pub mod translation_jobs;
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
}
