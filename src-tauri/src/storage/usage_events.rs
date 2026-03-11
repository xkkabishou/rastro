// usage_events 表仓储
#![allow(dead_code)]

use rusqlite::{params, Connection, Row};
use uuid::Uuid;

/// usage_events 表记录
#[derive(Debug, Clone)]
pub struct UsageEventRecord {
    pub event_id: String,
    pub document_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub feature: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
    pub currency: String,
    pub created_at: String,
}

/// 新建使用事件参数
#[derive(Debug, Clone)]
pub struct CreateUsageEventParams {
    pub document_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub feature: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
    pub currency: String,
    pub created_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<UsageEventRecord> {
    Ok(UsageEventRecord {
        event_id: row.get("event_id")?,
        document_id: row.get("document_id")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        feature: row.get("feature")?,
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        estimated_cost: row.get("estimated_cost")?,
        currency: row.get("currency")?,
        created_at: row.get("created_at")?,
    })
}

/// 创建使用事件
pub fn create(
    connection: &Connection,
    params: &CreateUsageEventParams,
) -> rusqlite::Result<UsageEventRecord> {
    let event_id = Uuid::new_v4().to_string();

    connection.execute(
        "INSERT INTO usage_events (
            event_id,
            document_id,
            provider,
            model,
            feature,
            input_tokens,
            output_tokens,
            estimated_cost,
            currency,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            event_id,
            params.document_id,
            params.provider,
            params.model,
            params.feature,
            params.input_tokens,
            params.output_tokens,
            params.estimated_cost,
            params.currency,
            params.created_at,
        ],
    )?;

    let mut statement = connection.prepare("SELECT * FROM usage_events WHERE event_id = ?1")?;
    statement.query_row(params![event_id], map_row)
}

/// 读取全部使用事件
pub fn list_all(connection: &Connection) -> rusqlite::Result<Vec<UsageEventRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM usage_events
         ORDER BY created_at DESC",
    )?;

    let rows = statement.query_map([], map_row)?;
    rows.collect()
}
