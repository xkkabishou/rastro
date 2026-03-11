// 兼容旧模块名，实际迁移逻辑已迁移到 migrations.rs
use rusqlite::Connection;

/// 执行数据库 schema 迁移
#[allow(dead_code)]
pub fn run(connection: &Connection) -> rusqlite::Result<()> {
    super::migrations::run(connection)
}
