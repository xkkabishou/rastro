// 数据库 migration 执行器
use rusqlite::Connection;

const INIT_SQL: &str = include_str!("../../migrations/001_init.sql");

/// 执行首个 schema migration
pub fn run(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(INIT_SQL)
}
