-- 性能优化索引：覆盖高频查询的 WHERE 条件

-- find_latest_completed_for_document() 按 document_id + status 过滤
CREATE INDEX IF NOT EXISTS idx_translation_jobs_doc_status_finished
  ON translation_jobs(document_id, status, finished_at DESC);

-- batch_enrich_snapshots 按 document_id + artifact_kind 聚合
CREATE INDEX IF NOT EXISTS idx_translation_artifacts_doc_kind
  ON translation_artifacts(document_id, artifact_kind, created_at DESC);

-- document_summaries 按 document_id 查找（UNIQUE 约束已存在，但显式索引有助于 LEFT JOIN）
CREATE INDEX IF NOT EXISTS idx_document_summaries_doc_id
  ON document_summaries(document_id);

-- translation_jobs 按 status + finished_at 排序（缓存淘汰查询）
CREATE INDEX IF NOT EXISTS idx_translation_jobs_status_finished
  ON translation_jobs(status, finished_at DESC);
