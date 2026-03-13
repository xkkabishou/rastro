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

/// 按条件过滤使用事件（将 WHERE 下推到 SQL）
pub fn list_filtered(
    connection: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    provider: Option<&str>,
) -> rusqlite::Result<Vec<UsageEventRecord>> {
    let mut conditions = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_index = 1;

    if let Some(from) = from {
        conditions.push(format!("created_at >= ?{param_index}"));
        param_values.push(Box::new(from.to_string()));
        param_index += 1;
    }
    if let Some(to) = to {
        conditions.push(format!("created_at <= ?{param_index}"));
        param_values.push(Box::new(to.to_string()));
        param_index += 1;
    }
    if let Some(provider) = provider {
        conditions.push(format!("provider = ?{param_index}"));
        param_values.push(Box::new(provider.to_string()));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM usage_events{} ORDER BY created_at DESC",
        where_clause
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(param_refs.as_slice(), map_row)?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use crate::storage::Storage;

    use super::{create, list_all, CreateUsageEventParams};

    #[test]
    fn create_and_list_all_roundtrip_usage_events_in_descending_order() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        let first = create(
            &connection,
            &CreateUsageEventParams {
                document_id: Some("doc-1".to_string()),
                provider: "openai".to_string(),
                model: "gpt-4o-mini".to_string(),
                feature: "chat".to_string(),
                input_tokens: 120,
                output_tokens: 48,
                estimated_cost: 0.12,
                currency: "USD".to_string(),
                created_at: "2026-03-11T08:00:00Z".to_string(),
            },
        )
        .unwrap();
        let second = create(
            &connection,
            &CreateUsageEventParams {
                document_id: None,
                provider: "claude".to_string(),
                model: "claude-3-5-sonnet-latest".to_string(),
                feature: "summary".to_string(),
                input_tokens: 300,
                output_tokens: 160,
                estimated_cost: 0.42,
                currency: "USD".to_string(),
                created_at: "2026-03-11T09:00:00Z".to_string(),
            },
        )
        .unwrap();

        let records = list_all(&connection).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].event_id, second.event_id);
        assert_eq!(records[1].event_id, first.event_id);
        assert_eq!(records[0].feature, "summary");
        assert_eq!(records[1].document_id.as_deref(), Some("doc-1"));
    }
}
