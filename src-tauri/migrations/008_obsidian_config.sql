-- Obsidian 集成配置表
-- 使用 key-value 模式存储 Obsidian 相关配置
CREATE TABLE IF NOT EXISTS obsidian_config (
    config_key   TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
