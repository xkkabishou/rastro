// document_summaries 表仓储
#![allow(dead_code)]

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// document_summaries 表记录
#[derive(Debug, Clone)]
pub struct SummaryRecord {
    pub summary_id: String,
    pub document_id: String,
    pub content_md: String,
    pub provider: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<SummaryRecord> {
    Ok(SummaryRecord {
        summary_id: row.get("summary_id")?,
        document_id: row.get("document_id")?,
        content_md: row.get("content_md")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 按 document_id 查询总结
pub fn get_by_document_id(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Option<SummaryRecord>> {
    connection
        .query_row(
            "SELECT * FROM document_summaries WHERE document_id = ?1",
            params![document_id],
            map_row,
        )
        .optional()
}

/// 写入或替换文档最新总结
pub fn upsert_summary(
    connection: &Connection,
    document_id: &str,
    content_md: &str,
    provider: &str,
    model: &str,
) -> rusqlite::Result<SummaryRecord> {
    let summary_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();

    connection.execute(
        "INSERT INTO document_summaries (
            summary_id,
            document_id,
            content_md,
            provider,
            model,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(document_id) DO UPDATE
        SET content_md = excluded.content_md,
            provider = excluded.provider,
            model = excluded.model,
            updated_at = excluded.updated_at",
        params![
            summary_id,
            document_id,
            content_md,
            provider,
            model,
            timestamp,
            timestamp,
        ],
    )?;

    get_by_document_id(connection, document_id)
        .map(|record| record.expect("upserted summary should be queryable immediately"))
}

/// 按 document_id 删除总结
pub fn delete_by_document_id(connection: &Connection, document_id: &str) -> rusqlite::Result<bool> {
    let affected_rows = connection.execute(
        "DELETE FROM document_summaries WHERE document_id = ?1",
        params![document_id],
    )?;

    Ok(affected_rows > 0)
}

#[cfg(test)]
mod tests {
    use std::{thread, time::Duration};

    use rusqlite::{params, Connection};

    use super::{delete_by_document_id, get_by_document_id, upsert_summary};

    fn setup_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE documents (
                  document_id TEXT PRIMARY KEY
                );

                CREATE TABLE document_summaries (
                  summary_id   TEXT PRIMARY KEY,
                  document_id  TEXT NOT NULL REFERENCES documents(document_id),
                  content_md   TEXT NOT NULL,
                  provider     TEXT NOT NULL,
                  model        TEXT NOT NULL,
                  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
                  UNIQUE(document_id)
                );
                "#,
            )
            .unwrap();
        connection
    }

    #[test]
    fn upsert_summary_replaces_existing_row_for_same_document() {
        let connection = setup_connection();
        connection
            .execute(
                "INSERT INTO documents (document_id) VALUES (?1)",
                params!["doc-1"],
            )
            .unwrap();

        let first = upsert_summary(&connection, "doc-1", "first", "openai", "gpt-4o-mini").unwrap();
        thread::sleep(Duration::from_millis(5));
        let second = upsert_summary(
            &connection,
            "doc-1",
            "second",
            "claude",
            "claude-3-5-sonnet",
        )
        .unwrap();

        let row_count = connection
            .query_row(
                "SELECT COUNT(*) FROM document_summaries WHERE document_id = ?1",
                params!["doc-1"],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();

        assert_eq!(row_count, 1);
        assert_eq!(second.summary_id, first.summary_id);
        assert_eq!(second.document_id, "doc-1");
        assert_eq!(second.content_md, "second");
        assert_eq!(second.provider, "claude");
        assert_eq!(second.model, "claude-3-5-sonnet");
        assert_eq!(second.created_at, first.created_at);
        assert_ne!(second.updated_at, first.updated_at);

        let stored = get_by_document_id(&connection, "doc-1").unwrap().unwrap();
        assert_eq!(stored.content_md, "second");
        assert_eq!(stored.provider, "claude");
        assert_eq!(stored.model, "claude-3-5-sonnet");
    }

    #[test]
    fn delete_by_document_id_reports_whether_row_existed() {
        let connection = setup_connection();
        connection
            .execute(
                "INSERT INTO documents (document_id) VALUES (?1)",
                params!["doc-2"],
            )
            .unwrap();
        upsert_summary(&connection, "doc-2", "summary", "openai", "gpt-4o-mini").unwrap();

        assert!(delete_by_document_id(&connection, "doc-2").unwrap());
        assert!(!delete_by_document_id(&connection, "doc-2").unwrap());
        assert!(get_by_document_id(&connection, "doc-2").unwrap().is_none());
    }
}
