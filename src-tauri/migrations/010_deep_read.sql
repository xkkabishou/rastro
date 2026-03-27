-- 精读模式：在 documents 表新增全文存储列
-- deep_read_text 为 NULL 表示未开启精读，有值表示已开启
ALTER TABLE documents ADD COLUMN deep_read_text TEXT;
