// SQLite schema 版本化迁移执行器
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

const VERSION_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
"#;

const INIT_SQL: &str = include_str!("../../migrations/001_init.sql");
const ADD_CHAT_MESSAGE_THINKING_SQL: &str =
    include_str!("../../migrations/002_add_chat_message_thinking.sql");
const DOCUMENT_WORKSPACE_SQL: &str = include_str!("../../migrations/v2_document_workspace.sql");
const PROVIDER_MASKED_KEY_SQL: &str = include_str!("../../migrations/004_provider_masked_key.sql");
const CUSTOM_PROMPTS_SQL: &str = include_str!("../../migrations/005_custom_prompts.sql");
const ANNOTATIONS_SQL: &str = include_str!("../../migrations/006_annotations.sql");

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init",
        sql: INIT_SQL,
    },
    Migration {
        version: 2,
        name: "add_chat_message_thinking",
        sql: ADD_CHAT_MESSAGE_THINKING_SQL,
    },
    Migration {
        version: 3,
        name: "document_workspace",
        sql: DOCUMENT_WORKSPACE_SQL,
    },
    Migration {
        version: 4,
        name: "provider_masked_key",
        sql: PROVIDER_MASKED_KEY_SQL,
    },
    Migration {
        version: 5,
        name: "custom_prompts",
        sql: CUSTOM_PROMPTS_SQL,
    },
    Migration {
        version: 6,
        name: "annotations",
        sql: ANNOTATIONS_SQL,
    },
];

/// 执行全部未应用的 schema migration。
pub fn run(connection: &Connection) -> rusqlite::Result<()> {
    ensure_version_table(connection)?;
    let current_version = current_version(connection)?;

    let pending = MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current_version)
        .collect::<Vec<_>>();

    if pending.is_empty() {
        return Ok(());
    }

    let transaction = connection.unchecked_transaction()?;
    ensure_version_table(&transaction)?;

    for migration in pending {
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, ?3)",
            params![migration.version, migration.name, Utc::now().to_rfc3339()],
        )?;
    }

    transaction.commit()
}

fn ensure_version_table(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(VERSION_TABLE_SQL)
}

fn current_version(connection: &Connection) -> rusqlite::Result<i64> {
    connection
        .query_row(
            "SELECT version
             FROM schema_migrations
             ORDER BY version DESC
             LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{current_version, run, INIT_SQL};

    #[test]
    fn run_creates_schema_and_marks_current_schema_as_latest() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 6);
        assert_eq!(
            table_exists(&connection, "documents"),
            true,
            "documents table should exist after migration"
        );
        assert_eq!(
            provider_setting_count(&connection),
            3,
            "default provider rows should be seeded"
        );
        assert!(
            column_exists(&connection, "chat_messages", "thinking_md"),
            "chat_messages.thinking_md should exist after migration"
        );
        assert!(
            column_exists(&connection, "documents", "is_favorite"),
            "documents.is_favorite should exist after migration"
        );
        assert!(
            column_exists(&connection, "documents", "is_deleted"),
            "documents.is_deleted should exist after migration"
        );
        assert!(
            table_exists(&connection, "document_summaries"),
            "document_summaries should exist after migration"
        );
        assert!(
            table_exists(&connection, "notebooklm_artifacts"),
            "notebooklm_artifacts should exist after migration"
        );
        assert!(
            column_exists(&connection, "provider_settings", "masked_key"),
            "provider_settings.masked_key should exist after migration"
        );
        assert!(
            table_exists(&connection, "custom_prompts"),
            "custom_prompts should exist after migration"
        );
        assert!(
            table_exists(&connection, "annotations"),
            "annotations should exist after migration"
        );
    }

    #[test]
    fn run_is_idempotent_when_schema_is_already_at_latest_version() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();
        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 6);
        assert_eq!(
            migration_row_count(&connection),
            6,
            "latest migrations should only be recorded once"
        );
    }

    #[test]
    fn run_marks_legacy_v1_schema_without_recreating_seed_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(INIT_SQL).unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 6);
        assert_eq!(
            provider_setting_count(&connection),
            3,
            "legacy schema should keep a single copy of default providers"
        );
        assert!(
            column_exists(&connection, "chat_messages", "thinking_md"),
            "legacy schema should be upgraded with thinking column"
        );
        assert!(
            column_exists(&connection, "documents", "is_favorite"),
            "legacy schema should be upgraded with is_favorite"
        );
        assert!(
            column_exists(&connection, "documents", "is_deleted"),
            "legacy schema should be upgraded with is_deleted"
        );
    }

    fn table_exists(connection: &Connection, table_name: &str) -> bool {
        connection
            .query_row(
                "SELECT 1
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name = ?1",
                [table_name],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value == 1)
            .unwrap_or(false)
    }

    fn column_exists(connection: &Connection, table_name: &str, column_name: &str) -> bool {
        connection
            .prepare(&format!("PRAGMA table_info({table_name})"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .any(|value| value == column_name)
    }

    fn provider_setting_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM provider_settings", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn migration_row_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap()
    }
}
