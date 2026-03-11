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
