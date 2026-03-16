PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document_summaries (
  summary_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id),
  content_md TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id)
);

CREATE TABLE IF NOT EXISTS notebooklm_artifacts (
  artifact_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN ('mindmap', 'slides', 'quiz', 'flashcards', 'audio', 'report')
  ),
  title TEXT,
  file_path TEXT,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

ALTER TABLE documents
  ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

ALTER TABLE documents
  ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_document_summaries_updated_at
  ON document_summaries(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notebooklm_artifacts_document_id
  ON notebooklm_artifacts(document_id, artifact_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notebooklm_artifacts_created_at
  ON notebooklm_artifacts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_is_favorite_last_opened_at
  ON documents(is_favorite, last_opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_is_deleted_last_opened_at
  ON documents(is_deleted, last_opened_at DESC);
