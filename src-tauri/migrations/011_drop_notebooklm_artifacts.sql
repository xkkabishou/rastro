-- 删除 NotebookLM 相关表和索引（v11 清理：移除 NotebookLM 功能）
-- v2_document_workspace 创建了 notebooklm_artifacts 表，但生产代码从未写入，
-- 因移除 NotebookLM 功能，此处 DROP 清理遗留空表与索引。
DROP INDEX IF EXISTS idx_notebooklm_artifacts_document_id;
DROP INDEX IF EXISTS idx_notebooklm_artifacts_created_at;
DROP TABLE IF EXISTS notebooklm_artifacts;
