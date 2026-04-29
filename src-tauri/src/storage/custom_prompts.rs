// custom_prompts 表仓储 — 用户自定义提示词存储
#![allow(dead_code)]

use rusqlite::{params, Connection, OptionalExtension};

/// 查询自定义提示词内容，无记录返回 None
pub fn get(connection: &Connection, prompt_key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT content FROM custom_prompts WHERE prompt_key = ?1",
            params![prompt_key],
            |row| row.get(0),
        )
        .optional()
}

/// 写入或替换自定义提示词
pub fn upsert(
    connection: &Connection,
    prompt_key: &str,
    content: &str,
    updated_at: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO custom_prompts (prompt_key, content, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(prompt_key) DO UPDATE
         SET content = excluded.content,
             updated_at = excluded.updated_at",
        params![prompt_key, content, updated_at],
    )?;
    Ok(())
}

/// 删除自定义提示词，返回是否实际删除了行
pub fn delete(connection: &Connection, prompt_key: &str) -> rusqlite::Result<bool> {
    let affected = connection.execute(
        "DELETE FROM custom_prompts WHERE prompt_key = ?1",
        params![prompt_key],
    )?;
    Ok(affected > 0)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{delete, get, upsert};

    fn setup_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE custom_prompts (
                    prompt_key  TEXT PRIMARY KEY,
                    content     TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        connection
    }

    #[test]
    fn get_returns_none_when_no_record() {
        let connection = setup_connection();
        let result = get(&connection, "translation").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn upsert_then_get_returns_content() {
        let connection = setup_connection();
        upsert(
            &connection,
            "translation",
            "自定义翻译提示词",
            "2026-03-16T00:00:00Z",
        )
        .unwrap();

        let result = get(&connection, "translation").unwrap();
        assert_eq!(result, Some("自定义翻译提示词".to_string()));
    }

    #[test]
    fn upsert_overwrites_existing_content() {
        let connection = setup_connection();
        upsert(&connection, "summary", "第一版", "2026-03-16T00:00:00Z").unwrap();
        upsert(&connection, "summary", "第二版", "2026-03-16T01:00:00Z").unwrap();

        let result = get(&connection, "summary").unwrap();
        assert_eq!(result, Some("第二版".to_string()));
    }

    #[test]
    fn delete_after_upsert_returns_none() {
        let connection = setup_connection();
        upsert(&connection, "translation", "内容", "2026-03-16T00:00:00Z").unwrap();

        assert!(delete(&connection, "translation").unwrap());
        assert!(get(&connection, "translation").unwrap().is_none());
    }

    #[test]
    fn delete_nonexistent_key_returns_false() {
        let connection = setup_connection();
        assert!(!delete(&connection, "nonexistent").unwrap());
    }
}
