# Codex S1 Prompts — 按顺序发送

> 每个 `---` 分隔的区块是一个独立的 Codex prompt，按顺序复制粘贴发送。
> 每个 prompt 已包含所有必要上下文，Codex 不需要额外阅读文档。

---

## Prompt 1: T1.1.1 — v2 数据库 Migration

```
## 任务
创建 v2 数据库 migration 文件。

## 项目背景
Tauri 桌面应用 (Rust 后端 + React 前端)，使用 SQLite。
Migration 是纯 SQL 文件，由 Rust 在启动时执行。

## 现有 migration (001_init.sql) — 关键表结构

```sql
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

CREATE TABLE IF NOT EXISTS translation_jobs (
  job_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  -- ...其他字段省略...
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
```

## 需求
v2 migration 需要做三件事：

1. **新增 `document_summaries` 表** — AI 总结持久化
```sql
CREATE TABLE IF NOT EXISTS document_summaries (
  summary_id   TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(document_id),
  content_md   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id)
);
```

2. **新增 `notebooklm_artifacts` 表** — NotebookLM 产物管理，含 `document_id` 外键
   - 字段参考 `translation_artifacts` 的风格
   - 必须有 `artifact_id` (TEXT PRIMARY KEY)、`document_id` (TEXT NOT NULL, FK → documents)、`artifact_kind` (TEXT NOT NULL, 枚举: mindmap/slides/quiz/flashcards/audio/report)、`title` (TEXT)、`file_path` (TEXT)、`file_size_bytes` (INTEGER)、`created_at` (TEXT NOT NULL)

3. **修改 `documents` 表** — 新增 `is_favorite` 和 `is_deleted` 字段
```sql
ALTER TABLE documents ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN is_deleted  INTEGER NOT NULL DEFAULT 0;
```

## 约束
- 必须兼容 SQLite (使用 `IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`)
- 必须保留现有数据（不能 DROP 任何表）
- 开头加 `PRAGMA foreign_keys = ON;`
- 为新表的常用查询字段创建索引

## 输出
一个文件: `src-tauri/migrations/v2_document_workspace.sql`

## 验收标准
- 在现有 v1 数据库上执行 migration 不报错
- 三张新表/修改都已生效
- 外键约束有效
- 已有 documents 记录的 `is_favorite=0`, `is_deleted=0`
```

---

## Prompt 2: T1.1.2 — AI 总结存储模块

```
## 任务
实现 `document_summaries` 表的 CRUD 存储模块。

## 项目背景
Tauri 应用 (Rust), 使用 rusqlite 直接操作 SQLite。
存储模块风格参考下方 `documents.rs`。

## 表 Schema
```sql
CREATE TABLE IF NOT EXISTS document_summaries (
  summary_id   TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(document_id),
  content_md   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id)
);
```

关键约束: `UNIQUE(document_id)` — 每个文档仅保存最新一份总结。同文档切换 provider/model 后，旧总结被 **替换** (upsert 语义)。

## 风格参考: documents.rs (完整)

```rust
// documents 表仓储
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::models::DocumentSourceType;

/// documents 表记录
#[derive(Debug, Clone)]
pub struct DocumentRecord {
    pub document_id: String,
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: String,
    pub zotero_item_key: Option<String>,
    #[allow(dead_code)]
    pub created_at: String,
    pub last_opened_at: String,
}

/// 文档写入参数
#[derive(Debug, Clone)]
pub struct UpsertDocumentParams {
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: DocumentSourceType,
    pub zotero_item_key: Option<String>,
    pub timestamp: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        document_id: row.get("document_id")?,
        file_path: row.get("file_path")?,
        file_sha256: row.get("file_sha256")?,
        title: row.get("title")?,
        page_count: row.get("page_count")?,
        source_type: row.get("source_type")?,
        zotero_item_key: row.get("zotero_item_key")?,
        created_at: row.get("created_at")?,
        last_opened_at: row.get("last_opened_at")?,
    })
}

pub fn get_by_id(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Option<DocumentRecord>> {
    connection
        .query_row(
            "SELECT * FROM documents WHERE document_id = ?1",
            params![document_id],
            map_row,
        )
        .optional()
}

pub fn upsert(
    connection: &Connection,
    params: &UpsertDocumentParams,
) -> rusqlite::Result<DocumentRecord> {
    // ... upsert 逻辑 (先查后插/更新)
}

pub fn list_recent(connection: &Connection, limit: u32) -> rusqlite::Result<Vec<DocumentRecord>> {
    // ... ORDER BY last_opened_at DESC LIMIT ?1
}
```

## 需要实现的方法
1. `upsert_summary(conn, doc_id, content_md, provider, model)` → `SummaryRecord`
   - 使用 SQLite 的 `INSERT ... ON CONFLICT(document_id) DO UPDATE` 语法
   - 更新时同时更新 `provider`, `model`, `content_md`, `updated_at`
   - 返回写入后的完整记录
2. `get_by_document_id(conn, doc_id)` → `Option<SummaryRecord>`
3. `delete_by_document_id(conn, doc_id)` → `bool` (是否删除了记录)

## 输出
一个文件: `src-tauri/src/storage/document_summaries.rs`

遵循 `documents.rs` 的风格：
- `SummaryRecord` struct (Debug, Clone, 字段对应表列)
- `map_row` 辅助函数
- 公开函数签名统一用 `&Connection` 作为第一参数
- 使用 `uuid::Uuid::new_v4()` 生成 `summary_id`
- 时间戳用参数传入或 `chrono::Utc::now().to_rfc3339()`

## 验收标准
- `cargo check` 编译通过
- upsert 语义: 同 document_id 重复调用时旧记录被替换（不新增行）
- 替换时 `updated_at` 更新，`created_at` 保持原值
```

---

## Prompt 3: T1.1.3 — documents 表扩展

```
## 任务
在现有 `storage/documents.rs` 中增加 `is_favorite` 和 `is_deleted` 字段支持。

## 现有 documents.rs (完整)

```rust
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;
use crate::models::DocumentSourceType;

#[derive(Debug, Clone)]
pub struct DocumentRecord {
    pub document_id: String,
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: String,
    pub zotero_item_key: Option<String>,
    #[allow(dead_code)]
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertDocumentParams {
    pub file_path: String,
    pub file_sha256: String,
    pub title: String,
    pub page_count: u32,
    pub source_type: DocumentSourceType,
    pub zotero_item_key: Option<String>,
    pub timestamp: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        document_id: row.get("document_id")?,
        file_path: row.get("file_path")?,
        file_sha256: row.get("file_sha256")?,
        title: row.get("title")?,
        page_count: row.get("page_count")?,
        source_type: row.get("source_type")?,
        zotero_item_key: row.get("zotero_item_key")?,
        created_at: row.get("created_at")?,
        last_opened_at: row.get("last_opened_at")?,
    })
}

pub fn get_by_sha256(connection: &Connection, file_sha256: &str) -> rusqlite::Result<Option<DocumentRecord>> {
    connection.query_row("SELECT * FROM documents WHERE file_sha256 = ?1", params![file_sha256], map_row).optional()
}

pub fn get_by_id(connection: &Connection, document_id: &str) -> rusqlite::Result<Option<DocumentRecord>> {
    connection.query_row("SELECT * FROM documents WHERE document_id = ?1", params![document_id], map_row).optional()
}

pub fn upsert(connection: &Connection, params: &UpsertDocumentParams) -> rusqlite::Result<DocumentRecord> {
    if let Some(existing) = get_by_sha256(connection, &params.file_sha256)? {
        connection.execute(
            "UPDATE documents SET file_path = ?1, title = ?2, page_count = ?3, source_type = ?4, zotero_item_key = ?5, last_opened_at = ?6 WHERE document_id = ?7",
            params![params.file_path, params.title, params.page_count, params.source_type.as_str(), params.zotero_item_key, params.timestamp, existing.document_id],
        )?;
        return get_by_id(connection, &existing.document_id).map(|r| r.expect("updated document should be queryable"));
    }
    let document_id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO documents (document_id, file_path, file_sha256, title, page_count, source_type, zotero_item_key, created_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![document_id, params.file_path, params.file_sha256, params.title, params.page_count, params.source_type.as_str(), params.zotero_item_key, params.timestamp, params.timestamp],
    )?;
    get_by_id(connection, &document_id).map(|r| r.expect("inserted document should be queryable"))
}

pub fn list_recent(connection: &Connection, limit: u32) -> rusqlite::Result<Vec<DocumentRecord>> {
    let mut statement = connection.prepare("SELECT * FROM documents ORDER BY last_opened_at DESC LIMIT ?1")?;
    let rows = statement.query_map(params![limit], map_row)?;
    rows.collect()
}
```

## 需要的修改

1. **`DocumentRecord`** 增加两个字段:
   - `pub is_favorite: bool` (数据库存 INTEGER, 0/1)
   - `pub is_deleted: bool`

2. **`map_row`** 更新: 读取新字段 (`row.get::<_, i32>("is_favorite")? != 0`)

3. **`list_recent`** 修改: 默认过滤 `is_deleted=0` (`WHERE is_deleted = 0`)

4. **新增方法**:
   - `toggle_favorite(conn, doc_id, favorite: bool) -> rusqlite::Result<bool>` — UPDATE is_favorite, 返回是否有行被更新
   - `soft_delete(conn, doc_id) -> rusqlite::Result<bool>` — SET is_deleted=1
   - `list_with_filters(conn, filter: DocumentFilter, limit: u32) -> rusqlite::Result<Vec<DocumentRecord>>` — 支持按 query(标题 LIKE)、is_favorite、has_translation(需 EXISTS 子查询) 过滤

5. **新增 struct**: `DocumentFilter { query: Option<String>, is_favorite: Option<bool>, has_translation: Option<bool>, has_summary: Option<bool> }`

## 输出
修改后的完整 `src-tauri/src/storage/documents.rs`

## 验收标准
- `cargo check` 编译通过
- `list_recent` 默认不返回 `is_deleted=1` 的文档
- `toggle_favorite` 正确切换收藏状态
- `list_with_filters` 支持组合条件筛选
```

---

## Prompt 4: T1.2.1 — ArtifactAggregator

```
## 任务
创建产物聚合查询模块，跨 3 张表查询文档的所有产物。

## 项目背景
Tauri 应用 (Rust), SQLite, 使用 rusqlite。

## 相关表结构

```sql
-- 翻译产物 (已有)
CREATE TABLE translation_artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,  -- 'translated_pdf' | 'bilingual_pdf'
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- 翻译任务 (已有, 需要关联获取 provider/model)
CREATE TABLE translation_jobs (
  job_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

-- AI 总结 (v2 新增)
CREATE TABLE document_summaries (
  summary_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content_md TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id)
);

-- NotebookLM 产物 (v2 新增)
CREATE TABLE notebooklm_artifacts (
  artifact_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,  -- mindmap/slides/quiz/flashcards/audio/report
  title TEXT,
  file_path TEXT,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL
);
```

## 统一 DTO (TypeScript 定义, 你需要用 Rust 实现对等结构体)

```typescript
interface DocumentArtifactDto {
  artifactId: string;
  documentId: string;
  kind: 'original_pdf' | 'translated_pdf' | 'bilingual_pdf' | 'ai_summary'
      | 'notebooklm_mindmap' | 'notebooklm_slides' | 'notebooklm_quiz'
      | 'notebooklm_flashcards' | 'notebooklm_audio' | 'notebooklm_report';
  title: string;
  filePath?: string;
  contentPreview?: string;  // 总结的前 100 字
  provider?: string;
  model?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt: string;
}
```

## 实现要求

1. **定义 `DocumentArtifactDto`** — Rust struct with `#[derive(Debug, Serialize)]` + `#[serde(rename_all = "camelCase")]`
2. **实现 `list_artifacts_for_document(conn, doc_id) -> Vec<DocumentArtifactDto>`**:
   - 查询 `translation_artifacts` (JOIN `translation_jobs` 获取 provider/model, 仅取 status='completed' 的最新 job)
   - 查询 `document_summaries`
   - 查询 `notebooklm_artifacts`
   - 合并为统一的 `Vec<DocumentArtifactDto>`
   - 按 `created_at` 排序
3. **实现 `count_artifacts_for_document(conn, doc_id) -> ArtifactCount`**: 快速返回各类型计数（用于侧栏 icon 展示），不需要完整数据
4. **`ArtifactCount`**: `{ has_translation: bool, has_summary: bool, notebooklm_count: u32 }`

## 风格约束
- 函数签名用 `&Connection` 第一参数
- 使用 `rusqlite::params!` 宏
- `kind` 字段映射: `translation_artifacts.artifact_kind` → `"translated_pdf"/"bilingual_pdf"`, `document_summaries` → `"ai_summary"`, `notebooklm_artifacts.artifact_kind` 加 `"notebooklm_"` 前缀

## 输出
一个文件: `src-tauri/src/artifact_aggregator.rs`

## 验收标准
- `cargo check` 编译通过
- 聚合结果包含所有三类产物来源
- `contentPreview` 对 AI 总结取 `content_md` 前 100 字符
- 空文档（无任何产物）返回空 Vec，不报错
```

---

## Prompt 5: T1.2.2 — 产物管理 IPC Commands

```
## 任务
注册 2 个新的 Tauri IPC Commands: `list_document_artifacts`, `delete_translation_cache`

## 项目背景
Tauri 2.x 应用 (Rust), IPC 通过 `#[tauri::command]` 宏注册。

## 风格参考: ipc/document.rs (关键模式)

```rust
use serde::Serialize;
use tauri::State;
use crate::{app_state::AppState, errors::AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub document_id: String,
    // ...
}

#[tauri::command]
pub fn list_recent_documents(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<DocumentSnapshot>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        documents::list_recent(&connection, limit.unwrap_or(10).clamp(1, 50))?
    };
    // ... map records to DTOs
}
```

## 需要实现

### 1. `list_document_artifacts` (放在 `ipc/document.rs`)
```rust
#[tauri::command]
pub fn list_document_artifacts(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<DocumentArtifactDto>, AppError>
```
- 调用 `artifact_aggregator::list_artifacts_for_document()`
- `DocumentArtifactDto` 来自 `artifact_aggregator` 模块

### 2. `delete_translation_cache` (放在 `ipc/translation.rs`)
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCacheResult {
    pub deleted: bool,
    pub freed_bytes: u64,
}

#[tauri::command]
pub fn delete_translation_cache(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeleteCacheResult, AppError>
```
- 查询 `translation_artifacts` 表中该 document_id 的所有产物记录
- 删除文件系统上的翻译 PDF 文件 (`std::fs::remove_file`)
- 删除数据库记录 (DELETE FROM translation_artifacts WHERE document_id = ?)
- 删除关联的 translation_jobs 记录
- 返回删除的总字节数

## 输出
- 修改 `src-tauri/src/ipc/document.rs` — 增加 `list_document_artifacts` command
- 修改 `src-tauri/src/ipc/translation.rs` — 增加 `delete_translation_cache` command
- 修改 `src-tauri/src/main.rs` — 在 `tauri::generate_handler![]` 中注册两个新 command

## 验收标准
- `cargo check` 编译通过
- IPC 符合 Tauri 2.x 的 `#[tauri::command]` 约定
- 错误用 `AppError` 统一返回
```

---

## Prompt 6: T1.2.3 — AI 总结管理 IPC Commands

```
## 任务
在 `ipc/ai.rs` 中注册 3 个新的 AI 总结管理 Commands。

## 风格参考: ipc/ai.rs (现有 command 模式)

```rust
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::{app_state::AppState, models::ProviderId, storage::chat_sessions};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionDto { /* ... */ }

#[tauri::command]
pub fn list_chat_sessions(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<ChatSessionDto>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        chat_sessions::list_by_document(&connection, &document_id)?
    };
    records.into_iter().map(|record| Ok(ChatSessionDto { /* map fields */ })).collect()
}
```

## 需要实现的 3 个 Commands

### DTO
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AISummaryDto {
    pub summary_id: String,
    pub document_id: String,
    pub content_md: String,
    pub provider: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}
```

### 1. `get_document_summary`
```rust
#[tauri::command]
pub fn get_document_summary(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Option<AISummaryDto>, AppError>
```
- 调用 `document_summaries::get_by_document_id()`

### 2. `save_document_summary`
```rust
#[tauri::command]
pub fn save_document_summary(
    state: State<'_, AppState>,
    document_id: String,
    content_md: String,
    provider: String,
    model: String,
) -> Result<AISummaryDto, AppError>
```
- 调用 `document_summaries::upsert_summary()`

### 3. `delete_document_summary`
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSummaryResult {
    pub deleted: bool,
}

#[tauri::command]
pub fn delete_document_summary(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeleteSummaryResult, AppError>
```
- 调用 `document_summaries::delete_by_document_id()`

## 输出
- 修改 `src-tauri/src/ipc/ai.rs`
- 修改 `src-tauri/src/main.rs` — 注册 3 个新 command

## 验收标准
- `cargo check` 编译通过
- upsert 语义: save 同一 document_id 两次，第二次覆盖第一次
- get 不存在的 document_id 返回 `None` 而非报错
```

---

## Prompt 7: T1.2.4 — 文档管理 IPC Commands

```
## 任务
注册 3 个新 Command + 修改 2 个现有 Command 的签名。

## 风格参考
同 Prompt 5/6 的模式。

## 新增 3 个 Commands (放在 ipc/document.rs)

### 1. `remove_recent_document`
```rust
#[tauri::command]
pub fn remove_recent_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<serde_json::Value, AppError>
// 调用 documents::soft_delete(conn, &document_id)
// 返回 { "removed": true }
```

### 2. `toggle_document_favorite`
```rust
#[tauri::command]
pub fn toggle_document_favorite(
    state: State<'_, AppState>,
    document_id: String,
    favorite: bool,
) -> Result<serde_json::Value, AppError>
// 调用 documents::toggle_favorite(conn, &document_id, favorite)
// 返回 { "updated": true }
```

### 3. `reveal_in_finder`
```rust
#[tauri::command]
pub fn reveal_in_finder(file_path: String) -> Result<(), AppError>
// macOS: 使用 `Command::new("open").args(["-R", &file_path]).spawn()`
```

## 修改 2 个现有 Commands

### `list_recent_documents` — 增加参数
```rust
#[tauri::command]
pub fn list_recent_documents(
    state: State<'_, AppState>,
    limit: Option<u32>,
    query: Option<String>,       // 新增: 标题搜索
    filter: Option<DocumentFilterInput>,  // 新增: 筛选条件
) -> Result<Vec<DocumentSnapshot>, AppError>
```
- `DocumentFilterInput`: `{ has_translation: Option<bool>, has_summary: Option<bool>, is_favorite: Option<bool> }`
- 调用 `documents::list_with_filters()` 替代 `documents::list_recent()`

### `get_document_snapshot` — 返回值增加字段
`DocumentSnapshot` struct 新增:
```rust
pub has_summary: bool,
pub is_favorite: bool,
pub artifact_count: u32,
```
- `has_summary`: 查询 `document_summaries` 表是否有记录
- `is_favorite`: 从 `DocumentRecord.is_favorite` 获取
- `artifact_count`: 调用 `artifact_aggregator::count_artifacts_for_document()`

## 输出
- 修改 `src-tauri/src/ipc/document.rs`
- 修改 `src-tauri/src/main.rs` — 注册 3 个新 command

## 验收标准
- `cargo check` 编译通过
- `list_recent_documents` 默认行为不变 (query=None, filter=None 时等同原来)
- `reveal_in_finder` 仅在 macOS 下有实际效果
- `DocumentSnapshot` 序列化后的 JSON 包含 `hasSummary`, `isFavorite`, `artifactCount` 字段 (camelCase)
```

---

## 发送顺序总结

| 序号 | Prompt | 依赖 | 估时 |
|:----:|--------|------|:----:|
| 1 | T1.1.1 Migration SQL | 无 | 4h |
| 2 | T1.1.2 `document_summaries.rs` | #1 产出 | 3h |
| 3 | T1.1.3 `documents.rs` 扩展 | #1 产出 | 3h |
| 4 | T1.2.1 ArtifactAggregator | #2, #3 产出 | 5h |
| 5 | T1.2.2 产物管理 IPC | #4 产出 | 4h |
| 6 | T1.2.3 AI 总结 IPC | #4 产出 | 3h |
| 7 | T1.2.4 文档管理 IPC | #4 产出 | 5h |

> **Prompt 2 和 3 可以并行发** — 它们只依赖 #1，互不依赖。
> **Prompt 5、6、7 可以并行发** — 它们只依赖 #4，互不依赖。
