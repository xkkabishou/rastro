-- 007_add_translation_tables.sql
-- 翻译 Provider 独立配置表 + 标题翻译缓存表 (ADR-301)

-- 翻译 API 独立配置（与主 AI 配置 provider_settings 隔离）
CREATE TABLE IF NOT EXISTS translation_provider_settings (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL DEFAULT '',
  base_url TEXT,
  masked_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 0
);

-- 预置三个 Provider（与主 provider_settings 一致）
INSERT OR IGNORE INTO translation_provider_settings (provider, model) VALUES ('openai', '');
INSERT OR IGNORE INTO translation_provider_settings (provider, model) VALUES ('claude', '');
INSERT OR IGNORE INTO translation_provider_settings (provider, model) VALUES ('gemini', '');

-- 标题翻译缓存
CREATE TABLE IF NOT EXISTS title_translations (
  title_hash TEXT PRIMARY KEY,
  original_title TEXT NOT NULL,
  translated_title TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
