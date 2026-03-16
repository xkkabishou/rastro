-- 自定义提示词存储表
CREATE TABLE IF NOT EXISTS custom_prompts (
    prompt_key  TEXT PRIMARY KEY,   -- 'translation' | 'summary'
    content     TEXT NOT NULL,       -- 提示词正文
    updated_at  TEXT NOT NULL        -- ISO 8601 时间戳
);
