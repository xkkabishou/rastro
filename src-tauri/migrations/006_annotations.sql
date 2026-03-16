-- 006_annotations: 文献标注表
CREATE TABLE IF NOT EXISTS annotations (
  annotation_id   TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents(document_id),
  annotation_type TEXT NOT NULL,          -- highlight / underline / note
  color           TEXT NOT NULL DEFAULT 'yellow',
  page_number     INTEGER NOT NULL,
  selected_text   TEXT NOT NULL DEFAULT '',
  note_content    TEXT,
  rects_json      TEXT NOT NULL,          -- JSON 数组，归一化 PDF 坐标矩形
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_document_id
  ON annotations(document_id);

CREATE INDEX IF NOT EXISTS idx_annotations_document_page
  ON annotations(document_id, page_number);
