PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  zotero_item_key TEXT,
  created_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content_md TEXT NOT NULL,
  context_quote TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS translation_jobs (
  job_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  engine_job_id TEXT,
  cache_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS translation_artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES translation_jobs(job_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY,
  document_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  base_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_test_status TEXT,
  last_tested_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_last_opened_at
  ON documents(last_opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_document_id
  ON chat_sessions(document_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
  ON chat_messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_document_id
  ON translation_jobs(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_artifacts_job_id
  ON translation_artifacts(job_id, artifact_kind);

CREATE INDEX IF NOT EXISTS idx_usage_events_provider_created_at
  ON usage_events(provider, created_at DESC);

INSERT OR IGNORE INTO provider_settings (provider, model, base_url, is_active)
VALUES
  ('openai', 'gpt-4o-mini', NULL, 1),
  ('claude', 'claude-3-5-sonnet-latest', NULL, 0),
  ('gemini', 'gemini-2.0-flash', NULL, 0);
