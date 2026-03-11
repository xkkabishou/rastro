// chat_sessions 表仓储
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// chat_sessions 表记录
#[derive(Debug, Clone)]
pub struct ChatSessionRecord {
    pub session_id: String,
    pub document_id: String,
    pub provider: String,
    pub model: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 会话创建参数
#[derive(Debug, Clone)]
pub struct CreateChatSessionParams {
    pub document_id: String,
    pub provider: String,
    pub model: String,
    pub title: Option<String>,
    pub timestamp: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<ChatSessionRecord> {
    Ok(ChatSessionRecord {
        session_id: row.get("session_id")?,
        document_id: row.get("document_id")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        title: row.get("title")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 创建聊天会话
pub fn create(
    connection: &Connection,
    params: &CreateChatSessionParams,
) -> rusqlite::Result<ChatSessionRecord> {
    let session_id = Uuid::new_v4().to_string();

    connection.execute(
        "INSERT INTO chat_sessions (
            session_id,
            document_id,
            provider,
            model,
            title,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session_id,
            params.document_id,
            params.provider,
            params.model,
            params.title,
            params.timestamp,
            params.timestamp,
        ],
    )?;

    get_by_id(connection, &session_id)
        .map(|record| record.expect("inserted chat session should be queryable immediately"))
}

/// 按会话 ID 查询
pub fn get_by_id(
    connection: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<ChatSessionRecord>> {
    connection
        .query_row(
            "SELECT * FROM chat_sessions WHERE session_id = ?1",
            params![session_id],
            map_row,
        )
        .optional()
}

/// 按文档列出会话
pub fn list_by_document(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Vec<ChatSessionRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM chat_sessions
         WHERE document_id = ?1
         ORDER BY updated_at DESC, created_at DESC",
    )?;

    let rows = statement.query_map(params![document_id], map_row)?;
    rows.collect()
}

/// 更新会话标题和更新时间
pub fn update_metadata(
    connection: &Connection,
    session_id: &str,
    title: Option<&str>,
    updated_at: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE chat_sessions
         SET title = COALESCE(?1, title),
             updated_at = ?2
         WHERE session_id = ?3",
        params![title, updated_at, session_id],
    )?;
    Ok(())
}
