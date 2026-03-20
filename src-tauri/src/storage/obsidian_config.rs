// obsidian_config 表仓储 — Obsidian 配置管理
#![allow(dead_code)]

use rusqlite::{params, Connection, OptionalExtension};

/// 读取配置值，无记录时返回 None
pub fn get(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT config_value FROM obsidian_config WHERE config_key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
}

/// 写入或替换配置值
pub fn upsert(
    connection: &Connection,
    key: &str,
    value: &str,
    updated_at: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO obsidian_config (config_key, config_value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(config_key) DO UPDATE
         SET config_value = excluded.config_value,
             updated_at = excluded.updated_at",
        params![key, value, updated_at],
    )?;
    Ok(())
}

/// 获取 Vault 路径
pub fn get_vault_path(connection: &Connection) -> rusqlite::Result<Option<String>> {
    get(connection, "vault_path")
}

/// 获取自动同步开关（默认 false）
pub fn get_auto_sync(connection: &Connection) -> rusqlite::Result<bool> {
    get(connection, "auto_sync").map(|v| v.map_or(false, |s| s == "true"))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{get, get_auto_sync, get_vault_path, upsert};

    fn setup_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE obsidian_config (
                    config_key   TEXT PRIMARY KEY,
                    config_value TEXT NOT NULL,
                    updated_at   TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        connection
    }

    #[test]
    fn get_returns_none_when_no_record() {
        let connection = setup_connection();
        let result = get(&connection, "vault_path").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn upsert_then_get_returns_value() {
        let connection = setup_connection();
        upsert(
            &connection,
            "vault_path",
            "/Users/test/vault",
            "2026-03-20T00:00:00Z",
        )
        .unwrap();

        let result = get_vault_path(&connection).unwrap();
        assert_eq!(result, Some("/Users/test/vault".to_string()));
    }

    #[test]
    fn auto_sync_defaults_to_false() {
        let connection = setup_connection();
        assert!(!get_auto_sync(&connection).unwrap());
    }

    #[test]
    fn auto_sync_returns_true_when_set() {
        let connection = setup_connection();
        upsert(
            &connection,
            "auto_sync",
            "true",
            "2026-03-20T00:00:00Z",
        )
        .unwrap();
        assert!(get_auto_sync(&connection).unwrap());
    }
}
