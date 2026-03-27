// documents 表仓储
#![allow(dead_code)]

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::models::DocumentSourceType;

/// documents 表记录
#[derive(Debug, Clone)]
pub struct DocumentRecord {
    pub document_id: String,
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: String,
    pub zotero_item_key: Option<String>,
    #[allow(dead_code)]
    pub created_at: String,
    pub last_opened_at: String,
    pub is_favorite: bool,
    pub is_deleted: bool,
}

/// 文档列表过滤条件
#[derive(Debug, Clone, Default)]
pub struct DocumentFilter {
    pub query: Option<String>,
    pub is_favorite: Option<bool>,
    pub has_translation: Option<bool>,
    pub has_summary: Option<bool>,
}

/// 文档写入参数
#[derive(Debug, Clone)]
pub struct UpsertDocumentParams {
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: DocumentSourceType,
    pub zotero_item_key: Option<String>,
    pub timestamp: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        document_id: row.get("document_id")?,
        file_path: row.get("file_path")?,
        file_sha256: row.get("file_sha256")?,
        title: row.get("title")?,
        page_count: row.get("page_count")?,
        source_type: row.get("source_type")?,
        zotero_item_key: row.get("zotero_item_key")?,
        created_at: row.get("created_at")?,
        last_opened_at: row.get("last_opened_at")?,
        is_favorite: row.get::<_, i32>("is_favorite")? != 0,
        is_deleted: row.get::<_, i32>("is_deleted")? != 0,
    })
}

fn bool_to_sql(flag: bool) -> i64 {
    if flag {
        1
    } else {
        0
    }
}

/// 按文件哈希查找文档
pub fn get_by_sha256(
    connection: &Connection,
    file_sha256: &str,
) -> rusqlite::Result<Option<DocumentRecord>> {
    connection
        .query_row(
            "SELECT * FROM documents WHERE file_sha256 = ?1",
            params![file_sha256],
            map_row,
        )
        .optional()
}

/// 按 document_id 查找文档
pub fn get_by_id(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Option<DocumentRecord>> {
    connection
        .query_row(
            "SELECT * FROM documents WHERE document_id = ?1",
            params![document_id],
            map_row,
        )
        .optional()
}

/// 写入或更新文档记录
pub fn upsert(
    connection: &Connection,
    params: &UpsertDocumentParams,
) -> rusqlite::Result<DocumentRecord> {
    if let Some(existing) = get_by_sha256(connection, &params.file_sha256)? {
        connection.execute(
            "UPDATE documents
             SET file_path = ?1,
                 title = ?2,
                 page_count = ?3,
                 source_type = ?4,
                 zotero_item_key = ?5,
                 last_opened_at = ?6,
                 is_deleted = 0
             WHERE document_id = ?7",
            params![
                params.file_path,
                params.title,
                params.page_count,
                params.source_type.as_str(),
                params.zotero_item_key,
                params.timestamp,
                existing.document_id,
            ],
        )?;

        return get_by_id(connection, &existing.document_id)
            .map(|record| record.expect("updated document should be queryable immediately"));
    }

    let document_id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO documents (
            document_id,
            file_path,
            file_sha256,
            title,
            page_count,
            source_type,
            zotero_item_key,
            created_at,
            last_opened_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            document_id,
            params.file_path,
            params.file_sha256,
            params.title,
            params.page_count,
            params.source_type.as_str(),
            params.zotero_item_key,
            params.timestamp,
            params.timestamp,
        ],
    )?;

    get_by_id(connection, &document_id)
        .map(|record| record.expect("inserted document should be queryable immediately"))
}

/// 切换收藏状态
pub fn toggle_favorite(
    connection: &Connection,
    document_id: &str,
    favorite: bool,
) -> rusqlite::Result<bool> {
    let affected_rows = connection.execute(
        "UPDATE documents
         SET is_favorite = ?1
         WHERE document_id = ?2
           AND is_favorite != ?1",
        params![bool_to_sql(favorite), document_id],
    )?;

    Ok(affected_rows > 0)
}

/// 软删除文档，保留记录供后续重新打开恢复。
pub fn soft_delete(connection: &Connection, document_id: &str) -> rusqlite::Result<bool> {
    let affected_rows = connection.execute(
        "UPDATE documents
         SET is_deleted = 1
         WHERE document_id = ?1
           AND is_deleted = 0",
        params![document_id],
    )?;

    Ok(affected_rows > 0)
}

/// 保存精读全文到 documents 表
pub fn save_deep_read_text(
    connection: &Connection,
    document_id: &str,
    text: &str,
) -> rusqlite::Result<bool> {
    let updated = connection.execute(
        "UPDATE documents SET deep_read_text = ?1 WHERE document_id = ?2",
        params![text, document_id],
    )?;
    Ok(updated > 0)
}

/// 清除精读文本
pub fn clear_deep_read_text(connection: &Connection, document_id: &str) -> rusqlite::Result<bool> {
    let updated = connection.execute(
        "UPDATE documents SET deep_read_text = NULL WHERE document_id = ?1",
        params![document_id],
    )?;
    Ok(updated > 0)
}

/// 读取精读文本（不加载整个 DocumentRecord）
pub fn get_deep_read_text(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT deep_read_text FROM documents WHERE document_id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map(|v| v.flatten())
}

/// 最近打开文档列表
pub fn list_recent(connection: &Connection, limit: u32) -> rusqlite::Result<Vec<DocumentRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM documents
         WHERE is_deleted = 0
         ORDER BY last_opened_at DESC
         LIMIT ?1",
    )?;

    let rows = statement.query_map(params![limit], map_row)?;
    rows.collect()
}

/// 按搜索词和状态组合筛选文档列表。
pub fn list_with_filters(
    connection: &Connection,
    filter: DocumentFilter,
    limit: u32,
) -> rusqlite::Result<Vec<DocumentRecord>> {
    const TRANSLATION_EXISTS_SQL: &str =
        "EXISTS (SELECT 1 FROM translation_jobs WHERE translation_jobs.document_id = documents.document_id AND translation_jobs.status = 'completed')";
    const SUMMARY_EXISTS_SQL: &str =
        "EXISTS (SELECT 1 FROM document_summaries WHERE document_summaries.document_id = documents.document_id)";

    let mut sql = String::from(
        "SELECT * FROM documents
         WHERE is_deleted = 0",
    );
    let mut values = Vec::new();

    if let Some(query) = filter
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" AND title LIKE ?");
        values.push(Value::from(format!("%{query}%")));
    }

    if let Some(is_favorite) = filter.is_favorite {
        sql.push_str(" AND is_favorite = ?");
        values.push(Value::from(bool_to_sql(is_favorite)));
    }

    if let Some(has_translation) = filter.has_translation {
        if has_translation {
            sql.push_str(" AND ");
            sql.push_str(TRANSLATION_EXISTS_SQL);
        } else {
            sql.push_str(" AND NOT ");
            sql.push_str(TRANSLATION_EXISTS_SQL);
        }
    }

    if let Some(has_summary) = filter.has_summary {
        if has_summary {
            sql.push_str(" AND ");
            sql.push_str(SUMMARY_EXISTS_SQL);
        } else {
            sql.push_str(" AND NOT ");
            sql.push_str(SUMMARY_EXISTS_SQL);
        }
    }

    sql.push_str(
        " ORDER BY last_opened_at DESC
          LIMIT ?",
    );
    values.push(Value::from(i64::from(limit)));

    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), map_row)?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use rusqlite::{params, Connection};

    use crate::models::DocumentSourceType;

    use super::{
        clear_deep_read_text, get_by_id, get_deep_read_text, list_recent, list_with_filters,
        save_deep_read_text, soft_delete, toggle_favorite, upsert, DocumentFilter,
        UpsertDocumentParams,
    };

    fn setup_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE documents (
                  document_id TEXT PRIMARY KEY,
                  file_path TEXT NOT NULL,
                  file_sha256 TEXT NOT NULL UNIQUE,
                  title TEXT,
                  page_count INTEGER,
                  source_type TEXT NOT NULL,
                  zotero_item_key TEXT,
                  created_at TEXT NOT NULL,
                  last_opened_at TEXT NOT NULL,
                  is_favorite INTEGER NOT NULL DEFAULT 0,
                  is_deleted INTEGER NOT NULL DEFAULT 0,
                  deep_read_text TEXT
                );

                CREATE TABLE translation_jobs (
                  job_id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL,
                  status TEXT NOT NULL
                );

                CREATE TABLE document_summaries (
                  summary_id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL UNIQUE
                );
                "#,
            )
            .unwrap();
        connection
    }

    fn insert_document(
        connection: &Connection,
        suffix: &str,
        title: &str,
        timestamp: &str,
    ) -> super::DocumentRecord {
        upsert(
            connection,
            &UpsertDocumentParams {
                file_path: format!("/tmp/{suffix}.pdf"),
                file_sha256: format!("sha-{suffix}"),
                title: title.to_string(),
                page_count: 3,
                source_type: DocumentSourceType::Local,
                zotero_item_key: None,
                timestamp: timestamp.to_string(),
            },
        )
        .unwrap()
    }

    #[test]
    fn list_recent_hides_soft_deleted_documents() {
        let connection = setup_connection();
        let older = insert_document(&connection, "older", "Older", "2026-03-16T10:00:00Z");
        let newer = insert_document(&connection, "newer", "Newer", "2026-03-16T11:00:00Z");

        assert!(soft_delete(&connection, &newer.document_id).unwrap());

        let records = list_recent(&connection, 10).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].document_id, older.document_id);
    }

    #[test]
    fn toggle_favorite_updates_state_and_reports_changes() {
        let connection = setup_connection();
        let record = insert_document(&connection, "favorite", "Favorite", "2026-03-16T10:00:00Z");

        assert!(toggle_favorite(&connection, &record.document_id, true).unwrap());
        assert!(
            get_by_id(&connection, &record.document_id)
                .unwrap()
                .unwrap()
                .is_favorite
        );

        assert!(!toggle_favorite(&connection, &record.document_id, true).unwrap());
        assert!(toggle_favorite(&connection, &record.document_id, false).unwrap());
        assert!(
            !get_by_id(&connection, &record.document_id)
                .unwrap()
                .unwrap()
                .is_favorite
        );
    }

    #[test]
    fn list_with_filters_supports_combined_conditions() {
        let connection = setup_connection();
        let _now = Utc::now().to_rfc3339();

        let translated = insert_document(
            &connection,
            "attention-1",
            "Attention Is All You Need",
            "2026-03-16T10:00:00Z",
        );
        let summary_only = insert_document(
            &connection,
            "attention-2",
            "Attention Summary Only",
            "2026-03-16T11:00:00Z",
        );
        let plain = insert_document(
            &connection,
            "baseline",
            "Baseline Paper",
            "2026-03-16T12:00:00Z",
        );
        let deleted = insert_document(
            &connection,
            "attention-3",
            "Attention Deleted",
            "2026-03-16T13:00:00Z",
        );

        toggle_favorite(&connection, &translated.document_id, true).unwrap();
        toggle_favorite(&connection, &deleted.document_id, true).unwrap();

        connection
            .execute(
                "INSERT INTO translation_jobs (job_id, document_id, status) VALUES (?1, ?2, 'completed')",
                params!["job-1", translated.document_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO translation_jobs (job_id, document_id, status) VALUES (?1, ?2, 'completed')",
                params!["job-2", deleted.document_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO document_summaries (summary_id, document_id) VALUES (?1, ?2)",
                params!["summary-1", translated.document_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO document_summaries (summary_id, document_id) VALUES (?1, ?2)",
                params!["summary-2", summary_only.document_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO document_summaries (summary_id, document_id) VALUES (?1, ?2)",
                params!["summary-3", deleted.document_id],
            )
            .unwrap();
        soft_delete(&connection, &deleted.document_id).unwrap();

        let combined = list_with_filters(
            &connection,
            DocumentFilter {
                query: Some("Attention".to_string()),
                is_favorite: Some(true),
                has_translation: Some(true),
                has_summary: Some(true),
            },
            10,
        )
        .unwrap();
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0].document_id, translated.document_id);

        let empty_state = list_with_filters(
            &connection,
            DocumentFilter {
                query: None,
                is_favorite: Some(false),
                has_translation: Some(false),
                has_summary: Some(false),
            },
            10,
        )
        .unwrap();
        assert_eq!(empty_state.len(), 1);
        assert_eq!(empty_state[0].document_id, plain.document_id);
    }

    #[test]
    fn save_and_read_deep_read_text() {
        let connection = setup_connection();
        let doc = insert_document(&connection, "deep", "Deep Read", "2026-03-27T10:00:00Z");

        // 初始为 None
        assert_eq!(
            get_deep_read_text(&connection, &doc.document_id).unwrap(),
            None
        );

        // 保存全文
        assert!(save_deep_read_text(&connection, &doc.document_id, "论文全文内容").unwrap());
        assert_eq!(
            get_deep_read_text(&connection, &doc.document_id).unwrap(),
            Some("论文全文内容".to_string())
        );

        // 清除
        assert!(clear_deep_read_text(&connection, &doc.document_id).unwrap());
        assert_eq!(
            get_deep_read_text(&connection, &doc.document_id).unwrap(),
            None
        );
    }
}
