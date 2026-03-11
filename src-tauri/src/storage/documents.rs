// documents 表仓储
use rusqlite::{params, Connection, OptionalExtension, Row};
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
    })
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
                 last_opened_at = ?6
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

/// 最近打开文档列表
pub fn list_recent(connection: &Connection, limit: u32) -> rusqlite::Result<Vec<DocumentRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM documents
         ORDER BY last_opened_at DESC
         LIMIT ?1",
    )?;

    let rows = statement.query_map(params![limit], map_row)?;
    rows.collect()
}
