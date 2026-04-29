// 翻译 Provider 配置表仓储（与主 provider_settings 隔离）
use rusqlite::{params, Connection, OptionalExtension, Row};

/// translation_provider_settings 表记录
#[derive(Debug, Clone)]
pub struct TranslationProviderSettingRecord {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub is_active: bool,
    pub masked_key: Option<String>,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<TranslationProviderSettingRecord> {
    Ok(TranslationProviderSettingRecord {
        provider: row.get("provider")?,
        model: row.get("model")?,
        base_url: row.get("base_url")?,
        is_active: row.get::<_, i64>("is_active")? == 1,
        masked_key: row.get("masked_key")?,
    })
}

/// 列出全部翻译 Provider 配置
pub fn list_all(
    connection: &Connection,
) -> rusqlite::Result<Vec<TranslationProviderSettingRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM translation_provider_settings
         ORDER BY is_active DESC, provider ASC",
    )?;
    let rows = statement.query_map([], map_row)?;
    rows.collect()
}

/// 查询指定翻译 Provider 配置
pub fn get_by_provider(
    connection: &Connection,
    provider: &str,
) -> rusqlite::Result<Option<TranslationProviderSettingRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_provider_settings WHERE provider = ?1",
            params![provider],
            map_row,
        )
        .optional()
}

/// 查询当前激活的翻译 Provider 配置
pub fn get_active(
    connection: &Connection,
) -> rusqlite::Result<Option<TranslationProviderSettingRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_provider_settings WHERE is_active = 1 LIMIT 1",
            [],
            map_row,
        )
        .optional()
}

/// 激活指定翻译 Provider 与模型
pub fn set_active(
    connection: &mut Connection,
    provider: &str,
    model: &str,
) -> rusqlite::Result<TranslationProviderSettingRecord> {
    let transaction = connection.transaction()?;
    transaction.execute("UPDATE translation_provider_settings SET is_active = 0", [])?;
    transaction.execute(
        "UPDATE translation_provider_settings
         SET model = ?1, is_active = 1
         WHERE provider = ?2",
        params![model, provider],
    )?;
    transaction.commit()?;

    get_by_provider(connection, provider).map(|record| record.expect("激活的翻译 Provider 应存在"))
}

/// 更新翻译 Provider 的脱敏 Key
pub fn update_masked_key(
    connection: &Connection,
    provider: &str,
    masked_key: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE translation_provider_settings SET masked_key = ?1 WHERE provider = ?2",
        params![masked_key, provider],
    )?;
    Ok(())
}

/// 更新翻译 Provider 的 base_url 和 model 配置
pub fn update_config(
    connection: &Connection,
    provider: &str,
    base_url: Option<&str>,
    model: Option<&str>,
) -> rusqlite::Result<Option<TranslationProviderSettingRecord>> {
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

    let set_clause = updates.join(", ");
    let sql = format!(
        "UPDATE translation_provider_settings SET {} WHERE provider = ?",
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

    use super::{get_active, get_by_provider, list_all, set_active, update_masked_key};

    #[test]
    fn list_all_returns_three_default_providers() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();
        let all = list_all(&connection).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|r| r.provider == "openai"));
        assert!(all.iter().any(|r| r.provider == "claude"));
        assert!(all.iter().any(|r| r.provider == "gemini"));
    }

    #[test]
    fn set_active_switches_provider_and_model() {
        let storage = Storage::new_in_memory().unwrap();
        let updated = {
            let mut connection = storage.connection();
            set_active(&mut connection, "openai", "gpt-4o-mini").unwrap()
        };
        assert_eq!(updated.provider, "openai");
        assert_eq!(updated.model, "gpt-4o-mini");
        assert!(updated.is_active);

        let connection = storage.connection();
        let active = get_active(&connection).unwrap().unwrap();
        assert_eq!(active.provider, "openai");

        // 确保只有一个激活
        let all = list_all(&connection).unwrap();
        assert_eq!(all.iter().filter(|r| r.is_active).count(), 1);
    }

    #[test]
    fn update_masked_key_persists_value() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        update_masked_key(&connection, "openai", Some("sk-...abc")).unwrap();
        let record = get_by_provider(&connection, "openai").unwrap().unwrap();
        assert_eq!(record.masked_key.as_deref(), Some("sk-...abc"));

        // 清除
        update_masked_key(&connection, "openai", None).unwrap();
        let record = get_by_provider(&connection, "openai").unwrap().unwrap();
        assert_eq!(record.masked_key, None);
    }
}
