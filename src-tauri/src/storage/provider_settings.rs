// provider_settings 表仓储
use rusqlite::{params, Connection, OptionalExtension, Row};

/// provider_settings 表记录
#[derive(Debug, Clone)]
pub struct ProviderSettingRecord {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub is_active: bool,
    pub last_test_status: Option<String>,
    pub last_tested_at: Option<String>,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<ProviderSettingRecord> {
    Ok(ProviderSettingRecord {
        provider: row.get("provider")?,
        model: row.get("model")?,
        base_url: row.get("base_url")?,
        is_active: row.get::<_, i64>("is_active")? == 1,
        last_test_status: row.get("last_test_status")?,
        last_tested_at: row.get("last_tested_at")?,
    })
}

/// 列出全部 provider 配置
pub fn list_all(connection: &Connection) -> rusqlite::Result<Vec<ProviderSettingRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM provider_settings
         ORDER BY is_active DESC, provider ASC",
    )?;

    let rows = statement.query_map([], map_row)?;
    rows.collect()
}

/// 查询指定 provider 配置
pub fn get_by_provider(
    connection: &Connection,
    provider: &str,
) -> rusqlite::Result<Option<ProviderSettingRecord>> {
    connection
        .query_row(
            "SELECT * FROM provider_settings WHERE provider = ?1",
            params![provider],
            map_row,
        )
        .optional()
}

/// 查询当前激活的 provider 配置
pub fn get_active(connection: &Connection) -> rusqlite::Result<Option<ProviderSettingRecord>> {
    connection
        .query_row(
            "SELECT * FROM provider_settings WHERE is_active = 1 LIMIT 1",
            [],
            map_row,
        )
        .optional()
}

/// 激活指定 provider 与模型
pub fn set_active(
    connection: &mut Connection,
    provider: &str,
    model: &str,
) -> rusqlite::Result<ProviderSettingRecord> {
    let transaction = connection.transaction()?;
    transaction.execute("UPDATE provider_settings SET is_active = 0", [])?;
    transaction.execute(
        "UPDATE provider_settings
         SET model = ?1,
             is_active = 1
         WHERE provider = ?2",
        params![model, provider],
    )?;
    transaction.commit()?;

    get_by_provider(connection, provider)
        .map(|record| record.expect("active provider should exist after activation"))
}

/// 更新 Provider 的连接测试状态
pub fn update_test_status(
    connection: &Connection,
    provider: &str,
    status: Option<&str>,
    tested_at: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE provider_settings
         SET last_test_status = ?1,
             last_tested_at = ?2
         WHERE provider = ?3",
        params![status, tested_at, provider],
    )?;
    Ok(())
}

/// 更新 Provider 的 base_url 和 model 配置
pub fn update_config(
    connection: &Connection,
    provider: &str,
    base_url: Option<&str>,
    model: Option<&str>,
) -> rusqlite::Result<Option<ProviderSettingRecord>> {
    let mut updates = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(url) = base_url {
        updates.push("base_url = ?");
        args.push(Box::new(url.to_string()));
    }
    if let Some(m) = model {
        updates.push("model = ?");
        args.push(Box::new(m.to_string()));
    }

    if updates.is_empty() {
        return get_by_provider(connection, provider);
    }

    // 构建动态 SQL
    let set_clause = updates.join(", ");
    let sql = format!(
        "UPDATE provider_settings SET {} WHERE provider = ?",
        set_clause
    );
    args.push(Box::new(provider.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|a| a.as_ref()).collect();
    connection.execute(&sql, params.as_slice())?;

    get_by_provider(connection, provider)
}

#[cfg(test)]
mod tests {
    use crate::storage::Storage;

    use super::{get_active, get_by_provider, list_all, set_active, update_test_status};

    #[test]
    fn set_active_switches_single_active_provider_and_updates_model() {
        let storage = Storage::new_in_memory().unwrap();

        let updated = {
            let mut connection = storage.connection();
            set_active(&mut connection, "gemini", "gemini-2.5-pro").unwrap()
        };

        assert_eq!(updated.provider, "gemini");
        assert_eq!(updated.model, "gemini-2.5-pro");
        assert!(updated.is_active);

        let connection = storage.connection();
        let active = get_active(&connection).unwrap().unwrap();
        assert_eq!(active.provider, "gemini");

        let all = list_all(&connection).unwrap();
        assert_eq!(all.iter().filter(|record| record.is_active).count(), 1);
    }

    #[test]
    fn update_test_status_persists_last_check_metadata() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        update_test_status(
            &connection,
            "openai",
            Some("ok"),
            Some("2026-03-11T12:00:00Z"),
        )
        .unwrap();

        let record = get_by_provider(&connection, "openai").unwrap().unwrap();
        assert_eq!(record.last_test_status.as_deref(), Some("ok"));
        assert_eq!(
            record.last_tested_at.as_deref(),
            Some("2026-03-11T12:00:00Z")
        );
    }
}
