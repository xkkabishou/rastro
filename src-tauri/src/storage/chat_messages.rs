// chat_messages 表仓储
use rusqlite::{params, Connection, Row};
use uuid::Uuid;

/// chat_messages 表记录
#[derive(Debug, Clone)]
pub struct ChatMessageRecord {
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

/// 消息写入参数
#[derive(Debug, Clone)]
pub struct CreateChatMessageParams {
    pub session_id: String,
    pub role: String,
    pub content_md: String,
    pub context_quote: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated_cost: f64,
    pub created_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<ChatMessageRecord> {
    Ok(ChatMessageRecord {
        message_id: row.get("message_id")?,
        session_id: row.get("session_id")?,
        role: row.get("role")?,
        content_md: row.get("content_md")?,
        context_quote: row.get("context_quote")?,
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        estimated_cost: row.get("estimated_cost")?,
        created_at: row.get("created_at")?,
    })
}

/// 创建聊天消息
pub fn create(
    connection: &Connection,
    params: &CreateChatMessageParams,
) -> rusqlite::Result<ChatMessageRecord> {
    let message_id = Uuid::new_v4().to_string();

    connection.execute(
        "INSERT INTO chat_messages (
            message_id,
            session_id,
            role,
            content_md,
            context_quote,
            input_tokens,
            output_tokens,
            estimated_cost,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            message_id,
            params.session_id,
            params.role,
            params.content_md,
            params.context_quote,
            params.input_tokens,
            params.output_tokens,
            params.estimated_cost,
            params.created_at,
        ],
    )?;

    let mut statement = connection.prepare("SELECT * FROM chat_messages WHERE message_id = ?1")?;
    statement.query_row(params![message_id], map_row)
}

/// 按会话列出消息
pub fn list_by_session(
    connection: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<ChatMessageRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM chat_messages
         WHERE session_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = statement.query_map(params![session_id], map_row)?;
    rows.collect()
}
