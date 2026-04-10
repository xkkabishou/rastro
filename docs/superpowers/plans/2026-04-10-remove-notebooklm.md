# 移除 NotebookLM 集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性删除 NotebookLM 相关的前端组件、Rust 模块、Python 引擎、数据库表与配置文件，同时保留 AI 问答与 AI 总结功能。

**Architecture:** 先删除完全独立的 Python 引擎与 Rust `notebooklm_manager`/`ipc::notebooklm` 模块，再自顶向下清理 `main.rs`、`app_state.rs`、`errors.rs`、`artifact_aggregator.rs` 以及两个 IPC 测试夹具；数据库层面新增 `011_drop_notebooklm_artifacts.sql` migration 删除空表；前端删除 4 个专属文件后，逐个修改 8 个混合文件中的 NotebookLM 引用；最后更新 3 份文档。每个阶段独立提交以便回滚。

**Tech Stack:** Rust (Tauri 2, rusqlite 0.37, parking_lot 0.12) · TypeScript (React 19, Zustand 5) · Python 3.12 · SQLite

**Spec 对应：** `docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md`

---

## 重要修正（相对于 spec）

spec §5.1 将新 migration 的版本号写为 `003`，但实际代码库中 version 3 已被 `v2_document_workspace` 占用（见 `src-tauri/src/storage/migrations.rs:43-47`），当前最新版本是 10。**本计划使用版本 11，文件名 `011_drop_notebooklm_artifacts.sql`**，与现有 004-010 的命名约定对齐。

---

## 文件结构概览

### 完整删除的文件/目录

| 路径 | 类型 |
|------|------|
| `rastro_notebooklm_engine/` | Python 包（整个目录） |
| `src-tauri/src/notebooklm_manager/` | Rust 模块（整个目录） |
| `src-tauri/src/ipc/notebooklm.rs` | Rust IPC 定义文件 |
| `src/components/notebooklm/` | React 组件目录 |
| `src/stores/useNotebookLMStore.ts` | Zustand store |
| `src/lib/notebooklm-client.ts` | 前端 HTTP 客户端 |
| `src/lib/notebooklm-automation.ts` | 前端自动化工具 |

### 新增文件

| 路径 | 用途 |
|------|------|
| `src-tauri/migrations/011_drop_notebooklm_artifacts.sql` | DROP 空表 |

### 编辑修改的文件

**Rust 后端（8 个）**：
- `src-tauri/src/main.rs`（移除 `mod notebooklm_manager;`, J 分组 11 个 command 注册）
- `src-tauri/src/ipc/mod.rs`（移除 `pub mod notebooklm;`）
- `src-tauri/src/app_state.rs`（移除 `notebooklm_manager` / `notebooklm_status` 字段 + 初始化）
- `src-tauri/src/errors.rs`（8 个错误码枚举 + 8 个 as_contract_str 分支 + 8 个测试元组 + 1 个长度断言）
- `src-tauri/src/artifact_aggregator.rs`（`notebooklm_count` 字段 + 2 处 SQL 查询 + `notebooklm_title` 函数 + 测试夹具与断言）
- `src-tauri/src/ipc/document.rs`（批量查询 `notebooklm_counts` + `artifact_count` 计算 + 测试夹具）
- `src-tauri/src/ipc/translation.rs`（测试夹具）
- `src-tauri/src/storage/migrations.rs`（注册新 migration + 更新 2 处版本断言 + 1 处 table_exists 断言）

**前端 TypeScript（10 个）**：
- `src/shared/types.ts`（`ArtifactKind` 联合类型中 6 个 notebooklm 字面量 + `AppErrorCode` 8 个 + C2 整节 12 个类型/接口 + `IPC_COMMANDS` 11 个常量 + 1 条注释）
- `src/lib/ipc-client.ts`（9 个类型 import + C2 整节 11 个方法 + 1 条注释）
- `src/components/panel/RightPanel.tsx`（1 个 import + `PanelTab` 联合类型 + 1 个 tab 按钮 + 1 个渲染分支）
- `src/components/sidebar/DocumentContextMenu.tsx`（3 个 `ContextMenuAction` 字面量 + 1 个 `kind.startsWith('notebooklm_')` 分支）
- `src/components/sidebar/DocumentNode.tsx`（🧠 NotebookLM icon 推断逻辑 + 注释）
- `src/components/sidebar/ArtifactNode.tsx`（6 个 `notebooklm_*` emoji case）
- `src/components/sidebar/ZoteroList.tsx`（1 个 `notebooklm_mindmap` case）
- `src/components/sidebar/Sidebar.tsx`（2 条注释 `NotebookLM`）

**Python / 配置（3 个）**：
- `requirements.txt`（删除 `notebooklm-py==0.3.4` 和 `browser-cookie3==0.20.1`）
- `src-tauri/tauri.conf.json`（删除 `resources` 数组中 `../rastro_notebooklm_engine/**/*.py`）
- `.gitignore`（删除 `rastro_notebooklm_engine/` 行）

**文档（3 个）**：
- `CLAUDE.md`（根目录）
- `src/CLAUDE.md`
- `src-tauri/CLAUDE.md`
- `genesis/v2/06_CHANGELOG.md`

---

## 执行顺序

**A. Python 与配置清理** → **B. Rust 后端删除** → **C. 数据库 Migration** → **D. Rust 验证** → **E. 前端删除** → **F. 前端验证** → **G. 文档更新** → **H. 最终验证**

每个任务结束时以独立 commit 落地，便于回滚；如 spec §2.1 要求单 commit，在 Task H3 中可选 squash。

---

## Task A1: Python 引擎与配置清理

**Files:**
- Delete: `rastro_notebooklm_engine/`
- Modify: `requirements.txt`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.gitignore`

- [ ] **Step 1: 删除 Python 引擎目录**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
rm -rf rastro_notebooklm_engine
```

Expected: 目录消失；`ls rastro_notebooklm_engine` 报错 "No such file"。

- [ ] **Step 2: 从 `requirements.txt` 删除 NotebookLM 依赖**

当前 `requirements.txt`（第 13-15 行）：
```
# NotebookLM 本地服务依赖
notebooklm-py==0.3.4
browser-cookie3==0.20.1
```

目标内容：删除第 13-15 行，文件以 `babeldoc>=0.5.0` 结尾（保留末尾换行）。

使用 Edit 工具替换。完整的 `old_string`:
```

# NotebookLM 本地服务依赖
notebooklm-py==0.3.4
browser-cookie3==0.20.1
```
完整的 `new_string`:
```
```
（空字符串 — 即只删除这四行）

- [ ] **Step 3: 从 `src-tauri/tauri.conf.json` 删除引擎资源项**

当前第 59-63 行：
```json
    "resources": [
      "../antigravity_translate/**/*.py",
      "../rastro_translation_engine/**/*.py",
      "../rastro_notebooklm_engine/**/*.py"
    ]
```

使用 Edit 工具。`old_string`:
```
    "resources": [
      "../antigravity_translate/**/*.py",
      "../rastro_translation_engine/**/*.py",
      "../rastro_notebooklm_engine/**/*.py"
    ]
```
`new_string`:
```
    "resources": [
      "../antigravity_translate/**/*.py",
      "../rastro_translation_engine/**/*.py"
    ]
```

- [ ] **Step 4: 从 `.gitignore` 删除 `rastro_notebooklm_engine/` 行**

使用 Edit 工具。`old_string`:
```
# Python 引擎（独立部署，不随主项目发布）
antigravity_translate/
rastro_notebooklm_engine/
rastro_translation_engine/
```
`new_string`:
```
# Python 引擎（独立部署，不随主项目发布）
antigravity_translate/
rastro_translation_engine/
```

- [ ] **Step 5: 提交**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git add rastro_notebooklm_engine requirements.txt src-tauri/tauri.conf.json .gitignore
git commit -m "chore: 删除 rastro_notebooklm_engine Python 包与相关配置"
```

Expected: `rastro_notebooklm_engine` 整个目录作为 delete 操作出现在 commit 中。

---

## Task B1: 删除 Rust notebooklm_manager 目录与 ipc 文件

**Files:**
- Delete: `src-tauri/src/notebooklm_manager/`
- Delete: `src-tauri/src/ipc/notebooklm.rs`

- [ ] **Step 1: 删除整个 notebooklm_manager 目录**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
rm -rf src-tauri/src/notebooklm_manager
```

- [ ] **Step 2: 删除 ipc/notebooklm.rs**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
rm src-tauri/src/ipc/notebooklm.rs
```

- [ ] **Step 3: 暂不编译，先完成下游所有引用清理（Task B2-B7），最后在 Task D1 统一 cargo check**

- [ ] **Step 4: 不单独提交，与 Task B2-B7 合并为一个 Rust 删除的逻辑 commit，在 Task D1 完成 cargo check 后统一提交**

---

## Task B2: 清理 main.rs 与 ipc/mod.rs

**Files:**
- Modify: `src-tauri/src/main.rs:12`
- Modify: `src-tauri/src/main.rs:105-116`
- Modify: `src-tauri/src/ipc/mod.rs:7`

- [ ] **Step 1: 删除 main.rs 中 `mod notebooklm_manager;`**

使用 Edit 工具在 `src-tauri/src/main.rs`：
`old_string`:
```rust
mod keychain;
mod models;
mod notebooklm_manager;
mod storage;
```
`new_string`:
```rust
mod keychain;
mod models;
mod storage;
```

- [ ] **Step 2: 删除 main.rs 中 J 组 11 个 command 注册**

使用 Edit 工具：
`old_string`:
```rust
            ipc::zotero::export_md_to_zotero,
            ipc::zotero::export_pdf_to_zotero,
            // J. NotebookLM 集成 (11 个)
            ipc::notebooklm::notebooklm_get_status,
            ipc::notebooklm::notebooklm_begin_login,
            ipc::notebooklm::notebooklm_open_external,
            ipc::notebooklm::notebooklm_logout,
            ipc::notebooklm::notebooklm_list_notebooks,
            ipc::notebooklm::notebooklm_create_notebook,
            ipc::notebooklm::notebooklm_attach_current_pdf,
            ipc::notebooklm::notebooklm_generate_artifact,
            ipc::notebooklm::notebooklm_get_task,
            ipc::notebooklm::notebooklm_list_artifacts,
            ipc::notebooklm::notebooklm_download_artifact,
            // K. 标注 (5 个)
```
`new_string`:
```rust
            ipc::zotero::export_md_to_zotero,
            ipc::zotero::export_pdf_to_zotero,
            // J. 标注 (5 个)
```

注意：同时将 K 分组的字母降位为 J，保持分组字母连续。

- [ ] **Step 3: 依次更新后续分组字母（L→K, M→L, N→M, O→N）**

使用 Edit 工具，4 次替换：

替换 1（L → K）：
`old_string`:
```rust
            // L. 翻译 Provider 配置与翻译 (6 个)
```
`new_string`:
```rust
            // K. 翻译 Provider 配置与翻译 (6 个)
```

替换 2（M → L）：
`old_string`:
```rust
            // M. 标题翻译缓存 (2 个)
```
`new_string`:
```rust
            // L. 标题翻译缓存 (2 个)
```

替换 3（N → M）：
`old_string`:
```rust
            // N. Obsidian 笔记同步 (6 个)
```
`new_string`:
```rust
            // M. Obsidian 笔记同步 (6 个)
```

替换 4（O → N）：
`old_string`:
```rust
            // O. 精读模式 (3 个)
```
`new_string`:
```rust
            // N. 精读模式 (3 个)
```

- [ ] **Step 4: 修改第 2 行顶部注释**

`old_string`:
```rust
// Rastro 后端入口
// 注册所有 25 个 #[tauri::command] 到 Tauri Builder
```
`new_string`:
```rust
// Rastro 后端入口
// 注册所有 #[tauri::command] 到 Tauri Builder
```

（移除写死的 25 这个过时数字）

- [ ] **Step 5: 删除 ipc/mod.rs 中 `pub mod notebooklm;`**

`src-tauri/src/ipc/mod.rs` 当前内容：
```rust
// IPC 模块注册
// 每个子模块对应 rust-backend-system.md Section 7.3 的一个 Command 分类
pub mod ai;
pub mod annotations;
pub mod deep_read;
pub mod document;
pub mod notebooklm;
pub mod obsidian;
pub mod settings;
pub mod title_translation;
pub mod translation;
pub mod translation_settings;
pub mod zotero;

```

使用 Edit 工具：
`old_string`:
```rust
pub mod document;
pub mod notebooklm;
pub mod obsidian;
```
`new_string`:
```rust
pub mod document;
pub mod obsidian;
```

---

## Task B3: 清理 app_state.rs

**Files:**
- Modify: `src-tauri/src/app_state.rs`

- [ ] **Step 1: 删除 `use` 中的 NotebookLM 引用**

使用 Edit 工具：
`old_string`:
```rust
use crate::{
    ai_integration::AiIntegration,
    errors::AppError,
    ipc::{
        notebooklm::NotebookLMEngineStatus, translation::TranslationEngineStatus,
        zotero::ZoteroStatusDto,
    },
    keychain::KeychainService,
    notebooklm_manager::NotebookLMManager,
    storage::Storage,
    translation_manager::TranslationManager,
};
```
`new_string`:
```rust
use crate::{
    ai_integration::AiIntegration,
    errors::AppError,
    ipc::{translation::TranslationEngineStatus, zotero::ZoteroStatusDto},
    keychain::KeychainService,
    storage::Storage,
    translation_manager::TranslationManager,
};
```

- [ ] **Step 2: 删除 AppState struct 中的两个字段**

`old_string`:
```rust
    pub translation_manager: TranslationManager,
    pub translation_status: Arc<Mutex<TranslationEngineStatus>>,
    pub notebooklm_manager: NotebookLMManager,
    #[allow(dead_code)] // 为 NotebookLM 引擎管理预留
    pub notebooklm_status: Arc<Mutex<NotebookLMEngineStatus>>,
    pub zotero_status: Arc<Mutex<ZoteroStatusDto>>,
```
`new_string`:
```rust
    pub translation_manager: TranslationManager,
    pub translation_status: Arc<Mutex<TranslationEngineStatus>>,
    pub zotero_status: Arc<Mutex<ZoteroStatusDto>>,
```

- [ ] **Step 3: 删除 `initialize()` 中 notebooklm 的初始化代码**

`old_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )?;
        let notebooklm_status = Arc::new(Mutex::new(NotebookLMEngineStatus {
            running: false,
            pid: None,
            port: 8891,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let notebooklm_manager =
            NotebookLMManager::new(data_dir.clone(), notebooklm_status.clone())?;

        Ok(Self {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            notebooklm_manager,
            notebooklm_status,
            zotero_status: Arc::new(Mutex::new(ZoteroStatusDto {
```
`new_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )?;

        Ok(Self {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            zotero_status: Arc::new(Mutex::new(ZoteroStatusDto {
```

---

## Task B4: 清理 errors.rs（8 个错误码 + 8 个 match arm + 8 个测试条目 + 长度断言）

**Files:**
- Modify: `src-tauri/src/errors.rs`

- [ ] **Step 1: 删除 AppErrorCode 枚举中 8 个 Notebooklm 变体**

`old_string`:
```rust
    PdfmathtranslateNotInstalled,
    // NotebookLM 相关
    NotebooklmAuthRequired,
    NotebooklmAuthExpired,
    NotebooklmEngineUnavailable,
    NotebooklmUploadFailed,
    NotebooklmGenerationFailed,
    NotebooklmDownloadFailed,
    NotebooklmRateLimited,
    NotebooklmUnknown,
    // 翻译任务相关
```
`new_string`:
```rust
    PdfmathtranslateNotInstalled,
    // 翻译任务相关
```

- [ ] **Step 2: 删除 as_contract_str 方法中 8 个 match arm**

`old_string`:
```rust
            Self::PdfmathtranslateNotInstalled => "PDFMATHTRANSLATE_NOT_INSTALLED",
            Self::NotebooklmAuthRequired => "NOTEBOOKLM_AUTH_REQUIRED",
            Self::NotebooklmAuthExpired => "NOTEBOOKLM_AUTH_EXPIRED",
            Self::NotebooklmEngineUnavailable => "NOTEBOOKLM_ENGINE_UNAVAILABLE",
            Self::NotebooklmUploadFailed => "NOTEBOOKLM_UPLOAD_FAILED",
            Self::NotebooklmGenerationFailed => "NOTEBOOKLM_GENERATION_FAILED",
            Self::NotebooklmDownloadFailed => "NOTEBOOKLM_DOWNLOAD_FAILED",
            Self::NotebooklmRateLimited => "NOTEBOOKLM_RATE_LIMITED",
            Self::NotebooklmUnknown => "NOTEBOOKLM_UNKNOWN",
            Self::TranslationFailed => "TRANSLATION_FAILED",
```
`new_string`:
```rust
            Self::PdfmathtranslateNotInstalled => "PDFMATHTRANSLATE_NOT_INSTALLED",
            Self::TranslationFailed => "TRANSLATION_FAILED",
```

- [ ] **Step 3: 删除测试数组中 8 个元组条目**

`old_string`:
```rust
        (
            AppErrorCode::PdfmathtranslateNotInstalled,
            "PDFMATHTRANSLATE_NOT_INSTALLED",
        ),
        (
            AppErrorCode::NotebooklmAuthRequired,
            "NOTEBOOKLM_AUTH_REQUIRED",
        ),
        (
            AppErrorCode::NotebooklmAuthExpired,
            "NOTEBOOKLM_AUTH_EXPIRED",
        ),
        (
            AppErrorCode::NotebooklmEngineUnavailable,
            "NOTEBOOKLM_ENGINE_UNAVAILABLE",
        ),
        (
            AppErrorCode::NotebooklmUploadFailed,
            "NOTEBOOKLM_UPLOAD_FAILED",
        ),
        (
            AppErrorCode::NotebooklmGenerationFailed,
            "NOTEBOOKLM_GENERATION_FAILED",
        ),
        (
            AppErrorCode::NotebooklmDownloadFailed,
            "NOTEBOOKLM_DOWNLOAD_FAILED",
        ),
        (
            AppErrorCode::NotebooklmRateLimited,
            "NOTEBOOKLM_RATE_LIMITED",
        ),
        (AppErrorCode::NotebooklmUnknown, "NOTEBOOKLM_UNKNOWN"),
        (AppErrorCode::TranslationFailed, "TRANSLATION_FAILED"),
```
`new_string`:
```rust
        (
            AppErrorCode::PdfmathtranslateNotInstalled,
            "PDFMATHTRANSLATE_NOT_INSTALLED",
        ),
        (AppErrorCode::TranslationFailed, "TRANSLATION_FAILED"),
```

- [ ] **Step 4: 更新测试断言 32 → 24**

原 AppErrorCode 总数 32，删除 8 个后为 24。

`old_string`:
```rust
    #[test]
    fn app_error_code_serializes_to_expected_contract_literals() {
        assert_eq!(ALL_ERROR_CODES.len(), 32);
```
`new_string`:
```rust
    #[test]
    fn app_error_code_serializes_to_expected_contract_literals() {
        assert_eq!(ALL_ERROR_CODES.len(), 24);
```

---

## Task B5: 清理 artifact_aggregator.rs

**Files:**
- Modify: `src-tauri/src/artifact_aggregator.rs`

- [ ] **Step 1: 删除 `ArtifactCount` 结构体中的 `notebooklm_count` 字段**

`old_string`:
```rust
/// 文档产物数量概览
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactCount {
    pub has_translation: bool,
    pub translation_count: u32,
    pub has_summary: bool,
    pub notebooklm_count: u32,
}

impl ArtifactCount {
    /// 返回文档在侧栏中可见的总产物数。
    pub fn total_count(&self) -> u32 {
        self.translation_count + u32::from(self.has_summary) + self.notebooklm_count
    }
}
```
`new_string`:
```rust
/// 文档产物数量概览
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactCount {
    pub has_translation: bool,
    pub translation_count: u32,
    pub has_summary: bool,
}

impl ArtifactCount {
    /// 返回文档在侧栏中可见的总产物数。
    pub fn total_count(&self) -> u32 {
        self.translation_count + u32::from(self.has_summary)
    }
}
```

- [ ] **Step 2: 删除函数注释与 `list_artifacts_for_document` 中 NotebookLM 查询代码段**

`old_string`:
```rust
/// 聚合返回文档原件、翻译缓存、AI 总结与 NotebookLM 产物。
pub fn list_artifacts_for_document(
```
`new_string`:
```rust
/// 聚合返回文档原件、翻译缓存与 AI 总结。
pub fn list_artifacts_for_document(
```

然后删除 NotebookLM 查询块。

`old_string`:
```rust
    if let Some(summary) =
        document_summaries::get_by_document_id(connection, &document.document_id)?
    {
        artifacts.push(DocumentArtifactDto {
            artifact_id: summary.summary_id,
            document_id: summary.document_id,
            kind: "ai_summary".to_string(),
            title: "AI 总结".to_string(),
            file_path: None,
            content_preview: Some(summary_preview(&summary.content_md)),
            provider: Some(summary.provider),
            model: Some(summary.model),
            file_size: None,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
        });
    }

    let mut statement = connection.prepare(
        "SELECT artifact_id, document_id, artifact_kind, title, file_path, file_size_bytes, created_at
         FROM notebooklm_artifacts
         WHERE document_id = ?1
         ORDER BY created_at DESC",
    )?;
    let notebooklm_rows = statement.query_map(params![document.document_id], |row| {
        Ok(DocumentArtifactDto {
            artifact_id: row.get("artifact_id")?,
            document_id: row.get("document_id")?,
            kind: format!("notebooklm_{}", row.get::<_, String>("artifact_kind")?),
            title: row
                .get::<_, Option<String>>("title")?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    notebooklm_title(&row.get::<_, String>("artifact_kind").unwrap_or_default())
                        .to_string()
                }),
            file_path: row.get("file_path")?,
            content_preview: None,
            provider: None,
            model: None,
            file_size: row.get("file_size_bytes")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("created_at")?,
        })
    })?;
    artifacts.extend(notebooklm_rows.collect::<Result<Vec<_>, _>>()?);

    artifacts.sort_by(|left, right| {
```
`new_string`:
```rust
    if let Some(summary) =
        document_summaries::get_by_document_id(connection, &document.document_id)?
    {
        artifacts.push(DocumentArtifactDto {
            artifact_id: summary.summary_id,
            document_id: summary.document_id,
            kind: "ai_summary".to_string(),
            title: "AI 总结".to_string(),
            file_path: None,
            content_preview: Some(summary_preview(&summary.content_md)),
            provider: Some(summary.provider),
            model: Some(summary.model),
            file_size: None,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
        });
    }

    artifacts.sort_by(|left, right| {
```

- [ ] **Step 3: 清理 `count_artifacts_for_document` 中的 NotebookLM COUNT 查询**

`old_string`:
```rust
/// 统计文档的翻译 / 总结 / NotebookLM 产物数量。
pub fn count_artifacts_for_document(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<ArtifactCount> {
    let translation_count = if let Some(job) =
        translation_jobs::find_latest_completed_for_document(connection, document_id, None, None)?
    {
        let artifacts = translation_artifacts::list_by_job(connection, &job.job_id)?;
        artifacts
            .into_iter()
            .filter(|artifact| {
                matches!(
                    artifact.artifact_kind.as_str(),
                    "translated_pdf" | "bilingual_pdf"
                )
            })
            .count() as u32
    } else {
        0
    };

    let has_summary = document_summaries::get_by_document_id(connection, document_id)?.is_some();
    let notebooklm_count = connection.query_row(
        "SELECT COUNT(*)
         FROM notebooklm_artifacts
         WHERE document_id = ?1",
        params![document_id],
        |row| row.get::<_, i64>(0),
    )?;

    Ok(ArtifactCount {
        has_translation: translation_count > 0,
        translation_count,
        has_summary,
        notebooklm_count: u32::try_from(notebooklm_count).unwrap_or(u32::MAX),
    })
}
```
`new_string`:
```rust
/// 统计文档的翻译与总结产物数量。
pub fn count_artifacts_for_document(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<ArtifactCount> {
    let translation_count = if let Some(job) =
        translation_jobs::find_latest_completed_for_document(connection, document_id, None, None)?
    {
        let artifacts = translation_artifacts::list_by_job(connection, &job.job_id)?;
        artifacts
            .into_iter()
            .filter(|artifact| {
                matches!(
                    artifact.artifact_kind.as_str(),
                    "translated_pdf" | "bilingual_pdf"
                )
            })
            .count() as u32
    } else {
        0
    };

    let has_summary = document_summaries::get_by_document_id(connection, document_id)?.is_some();

    Ok(ArtifactCount {
        has_translation: translation_count > 0,
        translation_count,
        has_summary,
    })
}
```

- [ ] **Step 4: 删除 `notebooklm_title` 辅助函数**

`old_string`:
```rust
fn notebooklm_title(kind: &str) -> &'static str {
    match kind {
        "mindmap" => "NotebookLM 思维导图",
        "slides" => "NotebookLM 演示文稿",
        "quiz" => "NotebookLM 测验",
        "flashcards" => "NotebookLM 闪卡",
        "audio" => "NotebookLM 音频概览",
        "report" => "NotebookLM 报告",
        _ => "NotebookLM 产物",
    }
}

fn summary_preview(content_md: &str) -> String {
```
`new_string`:
```rust
fn summary_preview(content_md: &str) -> String {
```

- [ ] **Step 5: 清理单元测试中的 `INSERT INTO notebooklm_artifacts` 夹具**

`old_string`:
```rust
            document_summaries::upsert_summary(
                &connection,
                &document.document_id,
                &"A".repeat(120),
                "openai",
                "gpt-4o",
            )
            .unwrap();
            connection
                .execute(
                    "INSERT INTO notebooklm_artifacts (
                        artifact_id,
                        document_id,
                        artifact_kind,
                        title,
                        file_path,
                        file_size_bytes,
                        created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        "nb-1",
                        document.document_id,
                        "mindmap",
                        "Mindmap",
                        "/tmp/mindmap.html",
                        256_u64,
                        timestamp,
                    ],
                )
                .unwrap();
        }
```
`new_string`:
```rust
            document_summaries::upsert_summary(
                &connection,
                &document.document_id,
                &"A".repeat(120),
                "openai",
                "gpt-4o",
            )
            .unwrap();
        }
```

- [ ] **Step 6: 删除测试中对 `notebooklm_mindmap` 的断言**

`old_string`:
```rust
        assert!(kinds.contains(&"original_pdf"));
        assert!(kinds.contains(&"translated_pdf"));
        assert!(kinds.contains(&"ai_summary"));
        assert!(kinds.contains(&"notebooklm_mindmap"));
```
`new_string`:
```rust
        assert!(kinds.contains(&"original_pdf"));
        assert!(kinds.contains(&"translated_pdf"));
        assert!(kinds.contains(&"ai_summary"));
```

- [ ] **Step 7: 删除测试中未使用的 `params` import（验证阶段按需调整）**

如果删除夹具后 `rusqlite::params` 在测试中不再使用，cargo check 会报 unused_imports 警告。届时用 Edit 工具从 tests 模块顶部的 `use rusqlite::params;` 删除这一行。此步骤在 Task D1 cargo check 阶段根据实际警告决定。

---

## Task B6: 清理 ipc/document.rs

**Files:**
- Modify: `src-tauri/src/ipc/document.rs:399-420`（production）
- Modify: `src-tauri/src/ipc/document.rs:454-456`
- Modify: `src-tauri/src/ipc/document.rs:496-508`（test imports）
- Modify: `src-tauri/src/ipc/document.rs:626-645`（test fixture）

- [ ] **Step 1: 删除生产代码中的 notebooklm_counts 批量查询**

`old_string`:
```rust
    // 批量查询 notebooklm 产物数量
    let mut notebooklm_counts: HashMap<String, u32> = HashMap::new();
    {
        let sql = format!(
            "SELECT document_id, COUNT(*) as cnt
             FROM notebooklm_artifacts
             WHERE document_id IN ({})
             GROUP BY document_id",
            placeholders
        );
        let mut statement = connection.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = doc_ids.iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = statement.query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
        })?;
        for row_result in rows {
            let (doc_id, count) = row_result?;
            notebooklm_counts.insert(doc_id, count);
        }
    }

    // 富化快照：加载最新 job 的产物详情
```
`new_string`:
```rust
    // 富化快照：加载最新 job 的产物详情
```

- [ ] **Step 2: 简化 artifact_count 计算**

`old_string`:
```rust
        let has_summary = summary_doc_ids.contains(&record.document_id);
        let translation_count = translation_artifact_counts.get(&record.document_id).copied().unwrap_or(0);
        let notebooklm_count = notebooklm_counts.get(&record.document_id).copied().unwrap_or(0);
        let artifact_count = translation_count + u32::from(has_summary) + notebooklm_count;
```
`new_string`:
```rust
        let has_summary = summary_doc_ids.contains(&record.document_id);
        let translation_count = translation_artifact_counts.get(&record.document_id).copied().unwrap_or(0);
        let artifact_count = translation_count + u32::from(has_summary);
```

- [ ] **Step 3: 删除测试代码中的 NotebookLM imports**

`old_string`:
```rust
    use crate::{
        ai_integration::AiIntegration,
        app_state::AppState,
        ipc::{
            notebooklm::NotebookLMEngineStatus, translation::TranslationEngineStatus,
            zotero::ZoteroStatusDto,
        },
        keychain::KeychainService,
        models::DocumentSourceType,
        notebooklm_manager::NotebookLMManager,
        storage::Storage,
        translation_manager::TranslationManager,
    };
```
`new_string`:
```rust
    use crate::{
        ai_integration::AiIntegration,
        app_state::AppState,
        ipc::{translation::TranslationEngineStatus, zotero::ZoteroStatusDto},
        keychain::KeychainService,
        models::DocumentSourceType,
        storage::Storage,
        translation_manager::TranslationManager,
    };
```

- [ ] **Step 4: 删除测试 `build_test_state` 中 notebooklm 初始化与 AppState 字段**

`old_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )
        .unwrap();
        let notebooklm_status = Arc::new(Mutex::new(NotebookLMEngineStatus {
            running: false,
            pid: None,
            port: 8891,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let notebooklm_manager =
            NotebookLMManager::new(data_dir.clone(), notebooklm_status.clone()).unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            notebooklm_manager,
            notebooklm_status,
            zotero_status: Arc::new(Mutex::new(ZoteroStatusDto {
```
`new_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )
        .unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            zotero_status: Arc::new(Mutex::new(ZoteroStatusDto {
```

---

## Task B7: 清理 ipc/translation.rs（仅测试夹具）

**Files:**
- Modify: `src-tauri/src/ipc/translation.rs:261-269`（test imports）
- Modify: `src-tauri/src/ipc/translation.rs:421-442`（test fixture）

- [ ] **Step 1: 删除测试 imports 中的 NotebookLM 引用**

`old_string`:
```rust
    use crate::{
        ai_integration::AiIntegration,
        app_state::AppState,
        keychain::KeychainService,
        models::{ArtifactKind, DocumentSourceType},
        notebooklm_manager::NotebookLMManager,
        storage::{documents, translation_artifacts, translation_jobs, Storage},
        translation_manager::TranslationManager,
    };
```
`new_string`:
```rust
    use crate::{
        ai_integration::AiIntegration,
        app_state::AppState,
        keychain::KeychainService,
        models::{ArtifactKind, DocumentSourceType},
        storage::{documents, translation_artifacts, translation_jobs, Storage},
        translation_manager::TranslationManager,
    };
```

- [ ] **Step 2: 删除 build_test_state 中 notebooklm 初始化与 AppState 字段**

`old_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )
        .unwrap();
        let notebooklm_status = Arc::new(ParkingMutex::new(
            crate::ipc::notebooklm::NotebookLMEngineStatus {
                running: false,
                pid: None,
                port: 8891,
                engine_version: None,
                circuit_breaker_open: false,
                last_health_check: None,
            },
        ));
        let notebooklm_manager =
            NotebookLMManager::new(data_dir.clone(), notebooklm_status.clone()).unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            notebooklm_manager,
            notebooklm_status,
            zotero_status: Arc::new(ParkingMutex::new(crate::ipc::zotero::ZoteroStatusDto {
```
`new_string`:
```rust
        let translation_manager = TranslationManager::new(
            data_dir.clone(),
            storage.clone(),
            keychain.clone(),
            translation_status.clone(),
        )
        .unwrap();

        AppState {
            data_dir,
            storage,
            keychain,
            ai_integration,
            translation_manager,
            translation_status,
            zotero_status: Arc::new(ParkingMutex::new(crate::ipc::zotero::ZoteroStatusDto {
```

---

## Task C1: 创建 Migration 011 — Drop NotebookLM Artifacts

**Files:**
- Create: `src-tauri/migrations/011_drop_notebooklm_artifacts.sql`

- [ ] **Step 1: 创建新 migration 文件**

使用 Write 工具创建 `src-tauri/migrations/011_drop_notebooklm_artifacts.sql`，内容：

```sql
-- 删除 NotebookLM 相关表和索引（v11 清理：移除 NotebookLM 功能）
-- v2_document_workspace 创建了 notebooklm_artifacts 表，但生产代码从未写入，
-- 因移除 NotebookLM 功能，此处 DROP 清理遗留空表与索引。
DROP INDEX IF EXISTS idx_notebooklm_artifacts_document_id;
DROP INDEX IF EXISTS idx_notebooklm_artifacts_created_at;
DROP TABLE IF EXISTS notebooklm_artifacts;
```

---

## Task C2: 注册 Migration 011 + 更新 migrations.rs 测试

**Files:**
- Modify: `src-tauri/src/storage/migrations.rs`

- [ ] **Step 1: 添加 migration 的 const 声明**

`old_string`:
```rust
const DEEP_READ_SQL: &str = include_str!("../../migrations/010_deep_read.sql");
```
`new_string`:
```rust
const DEEP_READ_SQL: &str = include_str!("../../migrations/010_deep_read.sql");
const DROP_NOTEBOOKLM_ARTIFACTS_SQL: &str =
    include_str!("../../migrations/011_drop_notebooklm_artifacts.sql");
```

- [ ] **Step 2: 将新 migration 追加到 MIGRATIONS 数组末尾**

`old_string`:
```rust
    Migration {
        version: 10,
        name: "deep_read",
        sql: DEEP_READ_SQL,
    },
];
```
`new_string`:
```rust
    Migration {
        version: 10,
        name: "deep_read",
        sql: DEEP_READ_SQL,
    },
    Migration {
        version: 11,
        name: "drop_notebooklm_artifacts",
        sql: DROP_NOTEBOOKLM_ARTIFACTS_SQL,
    },
];
```

- [ ] **Step 3: 更新测试中的版本号 10 → 11（第一处）**

`old_string`:
```rust
    #[test]
    fn run_creates_schema_and_marks_current_schema_as_latest() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 10);
```
`new_string`:
```rust
    #[test]
    fn run_creates_schema_and_marks_current_schema_as_latest() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 11);
```

- [ ] **Step 4: 更新 `notebooklm_artifacts` 表的断言（从存在改为不存在）**

`old_string`:
```rust
        assert!(
            table_exists(&connection, "document_summaries"),
            "document_summaries should exist after migration"
        );
        assert!(
            table_exists(&connection, "notebooklm_artifacts"),
            "notebooklm_artifacts should exist after migration"
        );
        assert!(
            column_exists(&connection, "provider_settings", "masked_key"),
```
`new_string`:
```rust
        assert!(
            table_exists(&connection, "document_summaries"),
            "document_summaries should exist after migration"
        );
        assert!(
            !table_exists(&connection, "notebooklm_artifacts"),
            "notebooklm_artifacts should be dropped by migration 011"
        );
        assert!(
            column_exists(&connection, "provider_settings", "masked_key"),
```

- [ ] **Step 5: 更新 idempotent 测试中的版本号 10 → 11 和 migration 数量 10 → 11**

`old_string`:
```rust
    #[test]
    fn run_is_idempotent_when_schema_is_already_at_latest_version() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();
        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 10);
        assert_eq!(
            migration_row_count(&connection),
            10,
            "latest migrations should only be recorded once"
        );
    }
```
`new_string`:
```rust
    #[test]
    fn run_is_idempotent_when_schema_is_already_at_latest_version() {
        let connection = Connection::open_in_memory().unwrap();

        run(&connection).unwrap();
        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 11);
        assert_eq!(
            migration_row_count(&connection),
            11,
            "latest migrations should only be recorded once"
        );
    }
```

- [ ] **Step 6: 更新 legacy v1 schema 测试的版本断言**

`old_string`:
```rust
    #[test]
    fn run_marks_legacy_v1_schema_without_recreating_seed_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(INIT_SQL).unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 10);
```
`new_string`:
```rust
    #[test]
    fn run_marks_legacy_v1_schema_without_recreating_seed_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(INIT_SQL).unwrap();

        run(&connection).unwrap();

        assert_eq!(current_version(&connection).unwrap(), 11);
```

---

## Task D1: Rust 编译与测试验证

**Files:** (no file modifications — pure validation)

- [ ] **Step 1: 运行 cargo check**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper/src-tauri"
cargo check 2>&1 | tee /tmp/rastro-cargo-check.log
```

Expected: 零编译错误。

常见预期警告与处理：
- `unused_imports` for `rusqlite::params` in `artifact_aggregator.rs` tests：如出现，回到 Task B5 Step 7，用 Edit 工具删除 `use rusqlite::params;` 这行
- `unused_imports` 其他类似问题：逐个定位并清理

如有错误，按编译器提示回到相关 Task 修复。

- [ ] **Step 2: 运行 cargo test**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper/src-tauri"
cargo test 2>&1 | tee /tmp/rastro-cargo-test.log
```

Expected: 所有测试通过。关键测试：
- `errors::tests::app_error_code_serializes_to_expected_contract_literals` — 断言 24 个错误码
- `storage::migrations::tests::run_creates_schema_and_marks_current_schema_as_latest` — version 11 + `notebooklm_artifacts` 不存在
- `storage::migrations::tests::run_is_idempotent_when_schema_is_already_at_latest_version` — version 11 + 11 条 migration 记录
- `artifact_aggregator::tests::list_artifacts_for_document_aggregates_supported_sources` — 3 种 kind（no more notebooklm_mindmap）

如有失败，按测试报告定位相关 Task 修复。

- [ ] **Step 3: 提交 Rust 删除的所有变更（Task B1-B7 + C1-C2）**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git add src-tauri/src src-tauri/migrations
git commit -m "$(cat <<'EOF'
refactor(backend): 删除 NotebookLM Rust 模块与 IPC

- 删除 src-tauri/src/notebooklm_manager/ 整个模块
- 删除 src-tauri/src/ipc/notebooklm.rs 及其 11 个 IPC Command 注册
- 从 main.rs / ipc/mod.rs / app_state.rs 移除 notebooklm_manager 相关代码
- 从 errors.rs 移除 8 个 NOTEBOOKLM_* 错误码及测试
- 从 artifact_aggregator.rs 移除 notebooklm_count 字段与 SQL 查询
- 从 ipc/document.rs、ipc/translation.rs 测试夹具中移除 notebooklm 初始化
- 新增 migration 011_drop_notebooklm_artifacts.sql 清理空表与索引
- 更新 migrations.rs 测试断言 version 10 → 11
EOF
)"
```

---

## Task E1: 删除前端 NotebookLM 专属文件

**Files:**
- Delete: `src/components/notebooklm/`
- Delete: `src/stores/useNotebookLMStore.ts`
- Delete: `src/lib/notebooklm-client.ts`
- Delete: `src/lib/notebooklm-automation.ts`

- [ ] **Step 1: 删除四个专属资源**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
rm -rf src/components/notebooklm
rm src/stores/useNotebookLMStore.ts
rm src/lib/notebooklm-client.ts
rm src/lib/notebooklm-automation.ts
```

- [ ] **Step 2: 暂不提交，在 Task F1 验证前端编译后统一提交前端变更**

---

## Task E2: 清理 src/shared/types.ts

**Files:**
- Modify: `src/shared/types.ts:49-54`（ArtifactKind 中 6 个 notebooklm 字面量）
- Modify: `src/shared/types.ts:98-106`（AppErrorCode 中 8 个 NOTEBOOKLM_* 字面量）
- Modify: `src/shared/types.ts:169`（DocumentSnapshot artifactCount 注释）
- Modify: `src/shared/types.ts:303-393`（C2 NotebookLM 整节 — 2 个 type + 10 个 interface = 12 个）
- Modify: `src/shared/types.ts:955-966`（IPC_COMMANDS C2 段 11 个常量）

- [ ] **Step 1: 清理 ArtifactKind 联合类型**

`old_string`:
```typescript
/** 文档产物类型（v2 统一枚举，覆盖所有产物来源） */
export type ArtifactKind =
  | "original_pdf"
  | "translated_pdf"
  | "bilingual_pdf"
  | "ai_summary"
  | "notebooklm_mindmap"
  | "notebooklm_slides"
  | "notebooklm_quiz"
  | "notebooklm_flashcards"
  | "notebooklm_audio"
  | "notebooklm_report";
```
`new_string`:
```typescript
/** 文档产物类型（v2 统一枚举，覆盖所有产物来源） */
export type ArtifactKind =
  | "original_pdf"
  | "translated_pdf"
  | "bilingual_pdf"
  | "ai_summary";
```

- [ ] **Step 2: 清理 AppErrorCode 联合类型中 8 个 NOTEBOOKLM_***

`old_string`:
```typescript
  // NotebookLM 相关
  | "NOTEBOOKLM_AUTH_REQUIRED"
  | "NOTEBOOKLM_AUTH_EXPIRED"
  | "NOTEBOOKLM_ENGINE_UNAVAILABLE"
  | "NOTEBOOKLM_UPLOAD_FAILED"
  | "NOTEBOOKLM_GENERATION_FAILED"
  | "NOTEBOOKLM_DOWNLOAD_FAILED"
  | "NOTEBOOKLM_RATE_LIMITED"
  | "NOTEBOOKLM_UNKNOWN"
```
`new_string`:
```typescript
```
（完全删除这一段，包括注释行）

- [ ] **Step 3: 更新 DocumentSnapshot 的 artifactCount 注释**

`old_string`:
```typescript
  /** v2: 文档关联的产物总数（翻译+总结+NotebookLM） */
  artifactCount: number;
```
`new_string`:
```typescript
  /** v2: 文档关联的产物总数（翻译+总结） */
  artifactCount: number;
```

- [ ] **Step 4: 删除 C2 NotebookLM 整节（19 个类型）**

`old_string`:
```typescript
// ---------------------------------------------------------------------------
// C2. NotebookLM 集成
// ---------------------------------------------------------------------------

export type NotebookLMArtifactType =
  | "mind-map"
  | "slide-deck"
  | "quiz"
  | "flashcards"
  | "audio-overview"
  | "report";

export type NotebookLMTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface NotebookLMEngineStatus {
  running: boolean;
  pid?: number;
  port: number;
  engineVersion?: string;
  circuitBreakerOpen: boolean;
  lastHealthCheck?: string;
}

export interface NotebookLMAuthStatus {
  authenticated: boolean;
  authExpired: boolean;
  lastAuthAt?: string | null;
  lastError?: string | null;
}

export interface NotebookSummary {
  id: string;
  title: string;
  sourceCount: number;
  updatedAt?: string | null;
}

export interface NotebookLMTask {
  id: string;
  kind: "upload" | "generate" | "download";
  artifactType?: NotebookLMArtifactType | null;
  status: NotebookLMTaskStatus;
  progressMessage?: string | null;
  errorCode?: AppErrorCode | null;
  errorMessage?: string | null;
  notebookId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookArtifactSummary {
  id: string;
  notebookId: string;
  type: NotebookLMArtifactType;
  title: string;
  downloadStatus: "not-downloaded" | "downloaded" | "failed";
  localPath?: string | null;
  createdAt?: string | null;
}

export interface NotebookLMStatus {
  engine: NotebookLMEngineStatus;
  auth: NotebookLMAuthStatus;
  notebooks: NotebookSummary[];
}

export interface CreateNotebookInput {
  title: string;
  description?: string;
}

export interface AttachCurrentPdfInput {
  notebookId: string;
  pdfPath: string;
}

export interface GenerateArtifactInput {
  notebookId: string;
  artifactType: NotebookLMArtifactType;
}

export interface DownloadArtifactInput {
  artifactId: string;
  artifactType: NotebookLMArtifactType;
  title: string;
}

// ---------------------------------------------------------------------------
// D. AI 问答与总结
// ---------------------------------------------------------------------------
```
`new_string`:
```typescript
// ---------------------------------------------------------------------------
// D. AI 问答与总结
// ---------------------------------------------------------------------------
```

- [ ] **Step 5: 删除 IPC_COMMANDS 中 C2 段 11 个 notebooklm 条目**

`old_string`:
```typescript
  // C2. NotebookLM 集成
  NOTEBOOKLM_GET_STATUS: "notebooklm_get_status",
  NOTEBOOKLM_BEGIN_LOGIN: "notebooklm_begin_login",
  NOTEBOOKLM_OPEN_EXTERNAL: "notebooklm_open_external",
  NOTEBOOKLM_LOGOUT: "notebooklm_logout",
  NOTEBOOKLM_LIST_NOTEBOOKS: "notebooklm_list_notebooks",
  NOTEBOOKLM_CREATE_NOTEBOOK: "notebooklm_create_notebook",
  NOTEBOOKLM_ATTACH_CURRENT_PDF: "notebooklm_attach_current_pdf",
  NOTEBOOKLM_GENERATE_ARTIFACT: "notebooklm_generate_artifact",
  NOTEBOOKLM_GET_TASK: "notebooklm_get_task",
  NOTEBOOKLM_LIST_ARTIFACTS: "notebooklm_list_artifacts",
  NOTEBOOKLM_DOWNLOAD_ARTIFACT: "notebooklm_download_artifact",
  // D. AI 问答与总结
```
`new_string`:
```typescript
  // D. AI 问答与总结
```

---

## Task E3: 清理 src/lib/ipc-client.ts

**Files:**
- Modify: `src/lib/ipc-client.ts:24-33`（import block）
- Modify: `src/lib/ipc-client.ts:190-236`（C2 方法块）
- Modify: `src/lib/ipc-client.ts:330`（注释）

- [ ] **Step 1: 删除 import 中的 C2 NotebookLM 类型**

`old_string`:
```typescript
  LoadCachedTranslationInput,
  // C2. NotebookLM
  NotebookLMStatus,
  NotebookLMAuthStatus,
  NotebookSummary,
  NotebookLMTask,
  NotebookArtifactSummary,
  CreateNotebookInput,
  AttachCurrentPdfInput,
  GenerateArtifactInput,
  DownloadArtifactInput,
  // D. AI 问答与总结
```
`new_string`:
```typescript
  LoadCachedTranslationInput,
  // D. AI 问答与总结
```

- [ ] **Step 2: 删除 C2 NotebookLM 集成整块（11 个方法）**

`old_string`:
```typescript
  /** 加载缓存翻译 */
  loadCachedTranslation: (input: LoadCachedTranslationInput) =>
    safeInvoke<TranslationJobDto | null>(IPC_COMMANDS.LOAD_CACHED_TRANSLATION, { ...input }),

  // =========================================================================
  // C2. NotebookLM 集成
  // =========================================================================

  /** 获取 NotebookLM 当前状态 */
  getNotebookLMStatus: () =>
    safeInvoke<NotebookLMStatus>(IPC_COMMANDS.NOTEBOOKLM_GET_STATUS),

  /** 启动 NotebookLM 登录流程 */
  beginNotebookLMLogin: () =>
    safeInvoke<NotebookLMAuthStatus>(IPC_COMMANDS.NOTEBOOKLM_BEGIN_LOGIN),

  /** 用系统默认浏览器打开 NotebookLM */
  openNotebookLMExternal: () =>
    safeInvoke<void>(IPC_COMMANDS.NOTEBOOKLM_OPEN_EXTERNAL),

  /** 清理 NotebookLM 登录态 */
  logoutNotebookLM: () =>
    safeInvoke<NotebookLMAuthStatus>(IPC_COMMANDS.NOTEBOOKLM_LOGOUT),

  /** 列出 NotebookLM notebooks */
  listNotebookLMNotebooks: () =>
    safeInvoke<NotebookSummary[]>(IPC_COMMANDS.NOTEBOOKLM_LIST_NOTEBOOKS),

  /** 创建 NotebookLM notebook */
  createNotebookLMNotebook: (input: CreateNotebookInput) =>
    safeInvoke<NotebookSummary>(IPC_COMMANDS.NOTEBOOKLM_CREATE_NOTEBOOK, { input }),

  /** 上传当前 PDF 到 NotebookLM */
  attachCurrentPdfToNotebookLM: (input: AttachCurrentPdfInput) =>
    safeInvoke<NotebookLMTask>(IPC_COMMANDS.NOTEBOOKLM_ATTACH_CURRENT_PDF, { input }),

  /** 触发 NotebookLM 产物生成 */
  generateNotebookLMArtifact: (input: GenerateArtifactInput) =>
    safeInvoke<NotebookLMTask>(IPC_COMMANDS.NOTEBOOKLM_GENERATE_ARTIFACT, { input }),

  /** 查询 NotebookLM 任务 */
  getNotebookLMTask: (taskId: string) =>
    safeInvoke<NotebookLMTask>(IPC_COMMANDS.NOTEBOOKLM_GET_TASK, { taskId }),

  /** 列出 NotebookLM 产物 */
  listNotebookLMArtifacts: (notebookId: string) =>
    safeInvoke<NotebookArtifactSummary[]>(IPC_COMMANDS.NOTEBOOKLM_LIST_ARTIFACTS, { notebookId }),

  /** 下载 NotebookLM 产物 */
  downloadNotebookLMArtifact: (input: DownloadArtifactInput) =>
    safeInvoke<NotebookArtifactSummary>(IPC_COMMANDS.NOTEBOOKLM_DOWNLOAD_ARTIFACT, { input }),

  // =========================================================================
  // D. AI 问答与总结
  // =========================================================================
```
`new_string`:
```typescript
  /** 加载缓存翻译 */
  loadCachedTranslation: (input: LoadCachedTranslationInput) =>
    safeInvoke<TranslationJobDto | null>(IPC_COMMANDS.LOAD_CACHED_TRANSLATION, { ...input }),

  // =========================================================================
  // D. AI 问答与总结
  // =========================================================================
```

- [ ] **Step 3: 更新 list_document_artifacts 相关注释**

`old_string`:
```typescript
  /** 获取文献下所有产物（翻译/总结/NotebookLM） */
```
`new_string`:
```typescript
  /** 获取文献下所有产物（翻译/总结） */
```

---

## Task E4: 清理 src/components/panel/RightPanel.tsx

**Files:**
- Modify: `src/components/panel/RightPanel.tsx`

- [ ] **Step 1: 删除 NotebookLMView import**

`old_string`:
```typescript
import React, { useState } from 'react';
import { X, MessageSquare, Settings, BookOpen, Globe, Highlighter } from 'lucide-react';
import { ChatPanel } from '../chat-panel/ChatPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { NotebookLMView } from '../notebooklm/NotebookLMView';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
```
`new_string`:
```typescript
import React, { useState } from 'react';
import { X, MessageSquare, Settings, BookOpen, Highlighter } from 'lucide-react';
import { ChatPanel } from '../chat-panel/ChatPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
```

注意：同时从 lucide-react 的 import 中移除 `Globe`（NotebookLM 的 NLM tab 使用的图标），因为该图标不再被使用。

- [ ] **Step 2: 删除 PanelTab 联合类型中的 'notebooklm'**

`old_string`:
```typescript
type PanelTab = 'chat' | 'annotations' | 'settings' | 'summary' | 'notebooklm';
```
`new_string`:
```typescript
type PanelTab = 'chat' | 'annotations' | 'settings' | 'summary';
```

- [ ] **Step 3: 删除 NLM tab 按钮**

`old_string`:
```typescript
          <PanelTabButton
            icon={<BookOpen size={14} />}
            label="总结"
            active={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
          />
          <PanelTabButton
            icon={<Globe size={14} />}
            label="NLM"
            active={activeTab === 'notebooklm'}
            onClick={() => setActiveTab('notebooklm')}
          />
          <PanelTabButton
            icon={<Highlighter size={14} />}
```
`new_string`:
```typescript
          <PanelTabButton
            icon={<BookOpen size={14} />}
            label="总结"
            active={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
          />
          <PanelTabButton
            icon={<Highlighter size={14} />}
```

- [ ] **Step 4: 删除 notebooklm 渲染分支**

`old_string`:
```typescript
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'annotations' && <AnnotationPanel />}
        {activeTab === 'summary' && <SummaryPanel />}
        {activeTab === 'notebooklm' && <NotebookLMView />}
        {activeTab === 'settings' && <SettingsPanel />}
```
`new_string`:
```typescript
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'annotations' && <AnnotationPanel />}
        {activeTab === 'summary' && <SummaryPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
```

---

## Task E5: 清理侧栏组件（5 个文件）

**Files:**
- Modify: `src/components/sidebar/ArtifactNode.tsx`
- Modify: `src/components/sidebar/DocumentNode.tsx`
- Modify: `src/components/sidebar/DocumentContextMenu.tsx`
- Modify: `src/components/sidebar/ZoteroList.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: ArtifactNode.tsx — 删除 6 个 notebooklm_* case**

`old_string`:
```typescript
/** 根据产物 kind 返回对应的 emoji icon */
export function artifactIcon(kind: string): string {
  switch (kind) {
    case 'original_pdf': return '📄';
    case 'translated_pdf': return '🌐';
    case 'bilingual_pdf': return '🌐';
    case 'ai_summary': return '📝';
    case 'notebooklm_mindmap': return '🧠';
    case 'notebooklm_slides': return '📊';
    case 'notebooklm_quiz': return '❓';
    case 'notebooklm_flashcards': return '🗂️';
    case 'notebooklm_audio': return '🎧';
    case 'notebooklm_report': return '📋';
    default: return '📎';
  }
}
```
`new_string`:
```typescript
/** 根据产物 kind 返回对应的 emoji icon */
export function artifactIcon(kind: string): string {
  switch (kind) {
    case 'original_pdf': return '📄';
    case 'translated_pdf': return '🌐';
    case 'bilingual_pdf': return '🌐';
    case 'ai_summary': return '📝';
    default: return '📎';
  }
}
```

- [ ] **Step 2: DocumentNode.tsx — 删除 🧠 NotebookLM 产物推断逻辑**

`old_string`:
```typescript
/**
 * 收集文档关联的状态 icon 列表
 * 🌐 已翻译 | 📝 有 AI 总结 | 🧠 有 NotebookLM 产物 | ⭐ 已收藏
 */
function collectStatusIcons(doc: DocumentSnapshot): StatusIcon[] {
  const icons: StatusIcon[] = [];

  if (doc.cachedTranslation?.available) {
    icons.push({ emoji: '🌐', title: '已翻译' });
  }
  if (doc.hasSummary) {
    icons.push({ emoji: '📝', title: '有 AI 总结' });
  }
  // artifactCount 大于翻译+总结所贡献的数量时，说明有 NotebookLM 产物
  const translationCount = doc.cachedTranslation?.available ? 1 : 0;
  const summaryCount = doc.hasSummary ? 1 : 0;
  // 原件 PDF 本身占 1 个产物位
  const otherArtifacts = doc.artifactCount - 1 - translationCount - summaryCount;
  if (otherArtifacts > 0) {
    icons.push({ emoji: '🧠', title: 'NotebookLM 产物' });
  }
  if (doc.isFavorite) {
    icons.push({ emoji: '⭐', title: '已收藏' });
  }

  return icons;
}
```
`new_string`:
```typescript
/**
 * 收集文档关联的状态 icon 列表
 * 🌐 已翻译 | 📝 有 AI 总结 | ⭐ 已收藏
 */
function collectStatusIcons(doc: DocumentSnapshot): StatusIcon[] {
  const icons: StatusIcon[] = [];

  if (doc.cachedTranslation?.available) {
    icons.push({ emoji: '🌐', title: '已翻译' });
  }
  if (doc.hasSummary) {
    icons.push({ emoji: '📝', title: '有 AI 总结' });
  }
  if (doc.isFavorite) {
    icons.push({ emoji: '⭐', title: '已收藏' });
  }

  return icons;
}
```

- [ ] **Step 3: DocumentContextMenu.tsx — 清理 NotebookLM 菜单项与 ContextMenuAction 字面量**

首先删除 ContextMenuAction 联合类型中的 3 个 NotebookLM 相关字面量。

`old_string`:
```typescript
/** 所有可能的右键菜单操作 */
export type ContextMenuAction =
  // 一级节点（文献）操作
  | 'translate'
  | 'generate_summary'
  | 'reveal_in_finder'
  | 'remove_from_history'
  | 'toggle_favorite'
  // 二级节点（翻译产物）操作
  | 'view_translation_detail'
  | 'retranslate'
  | 'delete_translation'
  // 二级节点（AI 总结）操作
  | 'view_summary'
  | 'regenerate_summary'
  | 'export_summary_md'
  // 二级节点（NotebookLM 产物）操作
  | 'open_artifact'
  | 'download_artifact'
  | 'delete_artifact';
```
`new_string`:
```typescript
/** 所有可能的右键菜单操作 */
export type ContextMenuAction =
  // 一级节点（文献）操作
  | 'translate'
  | 'generate_summary'
  | 'reveal_in_finder'
  | 'remove_from_history'
  | 'toggle_favorite'
  // 二级节点（翻译产物）操作
  | 'view_translation_detail'
  | 'retranslate'
  | 'delete_translation'
  // 二级节点（AI 总结）操作
  | 'view_summary'
  | 'regenerate_summary'
  | 'export_summary_md';
```

然后删除 `buildArtifactMenuItems` 中的 NotebookLM 分支。

`old_string`:
```typescript
  // AI 总结
  if (kind === 'ai_summary') {
    return [
      { label: '查看总结', action: 'view_summary' },
      { label: '重新生成', action: 'regenerate_summary' },
      { type: 'separator' },
      { label: '导出为 Markdown', action: 'export_summary_md' },
    ];
  }

  // NotebookLM 产物
  if (kind.startsWith('notebooklm_')) {
    return [
      { label: '打开', action: 'open_artifact' },
      { label: '下载', action: 'download_artifact', disabled: !!artifact.filePath },
      { type: 'separator' },
      { label: '删除', action: 'delete_artifact', danger: true },
    ];
  }

  // 原件 PDF — 仅在 Finder 中显示
```
`new_string`:
```typescript
  // AI 总结
  if (kind === 'ai_summary') {
    return [
      { label: '查看总结', action: 'view_summary' },
      { label: '重新生成', action: 'regenerate_summary' },
      { type: 'separator' },
      { label: '导出为 Markdown', action: 'export_summary_md' },
    ];
  }

  // 原件 PDF — 仅在 Finder 中显示
```

- [ ] **Step 4: ZoteroList.tsx — 删除 notebooklm_mindmap case 并清理未使用的 Brain icon import**

`old_string`:
```typescript
/* 产物 kind → lucide icon + 颜色 */
function artifactMeta(kind: string): { icon: React.ReactNode; color: string; label: string } {
  switch (kind) {
    case 'original_pdf':
      return { icon: <FileText size={12} />, color: '#78909C', label: '原件 PDF' };
    case 'translated_pdf':
    case 'bilingual_pdf':
      return { icon: <Globe size={12} />, color: '#1976D2', label: '翻译 PDF' };
    case 'ai_summary':
      return { icon: <StickyNote size={12} />, color: '#F57C00', label: 'AI 总结' };
    case 'notebooklm_mindmap':
      return { icon: <Brain size={12} />, color: '#7B1FA2', label: '思维导图' };
    default:
      return { icon: <FileText size={12} />, color: '#78909C', label: kind };
  }
}
```
`new_string`:
```typescript
/* 产物 kind → lucide icon + 颜色 */
function artifactMeta(kind: string): { icon: React.ReactNode; color: string; label: string } {
  switch (kind) {
    case 'original_pdf':
      return { icon: <FileText size={12} />, color: '#78909C', label: '原件 PDF' };
    case 'translated_pdf':
    case 'bilingual_pdf':
      return { icon: <Globe size={12} />, color: '#1976D2', label: '翻译 PDF' };
    case 'ai_summary':
      return { icon: <StickyNote size={12} />, color: '#F57C00', label: 'AI 总结' };
    default:
      return { icon: <FileText size={12} />, color: '#78909C', label: kind };
  }
}
```

然后清理 lucide-react import 中未使用的 Brain：

`old_string`:
```typescript
import {
  FileText, BookOpen, Loader2, AlertCircle,
  RefreshCw, ChevronRight,
  Library, Hash, Globe, Brain, StickyNote,
} from 'lucide-react';
```
`new_string`:
```typescript
import {
  FileText, BookOpen, Loader2, AlertCircle,
  RefreshCw, ChevronRight,
  Library, Hash, Globe, StickyNote,
} from 'lucide-react';
```

- [ ] **Step 5: Sidebar.tsx — 清理 2 条 NotebookLM 注释**

注释 1（行 145 附近）：

`old_string`:
```typescript
      case 'ai_summary':
        // TODO: Wave 4+ — 打开 AI 总结面板
        openDocumentInViewer(doc);
        break;
      default:
        // NotebookLM 产物或其他产物 — 在 Finder 中打开
        if (artifact.filePath) {
```
`new_string`:
```typescript
      case 'ai_summary':
        // TODO: Wave 4+ — 打开 AI 总结面板
        openDocumentInViewer(doc);
        break;
      default:
        // 其他产物 — 在 Finder 中打开
        if (artifact.filePath) {
```

注释 2（行 452 附近）：

`old_string`:
```typescript
        default: {
          // 其他操作暂未实现（NotebookLM 相关）
          console.log('[ContextMenu] 未实现的操作:', action, node.type, docId);
          break;
        }
```
`new_string`:
```typescript
        default: {
          // 其他未实现的操作
          console.log('[ContextMenu] 未实现的操作:', action, node.type, docId);
          break;
        }
```

---

## Task F1: 前端编译验证

**Files:** (no file modifications — pure validation)

- [ ] **Step 1: 运行 TypeScript 编译检查**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
npm run build 2>&1 | tee /tmp/rastro-frontend-build.log
```

Expected: 零编译错误；零 "Cannot find module" / "Type not found" 错误。

**常见预期问题：**
- 其他文件可能还有对已删除类型的残留引用。如 `tsc` 报错提示 "Cannot find name NotebookLMStatus" 等，grep 定位并删除。

如有错误，按 TypeScript 报错消息定位并修复。

- [ ] **Step 2: 运行时残留 grep 检查（前端代码）**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
```

使用 Grep 工具搜索 `src/` 下所有剩余的 notebooklm 引用：
- pattern: `notebooklm|NotebookLM|NOTEBOOKLM`
- path: `src/`

Expected: 无任何匹配。若有残留，使用 Edit 工具逐个清理。

- [ ] **Step 3: 提交所有前端变更（Task E1-E5）**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git add src
git commit -m "$(cat <<'EOF'
refactor(frontend): 删除 NotebookLM UI 组件与类型

- 删除 src/components/notebooklm/、stores/useNotebookLMStore.ts
- 删除 src/lib/notebooklm-client.ts、notebooklm-automation.ts
- 从 shared/types.ts 移除 ArtifactKind notebooklm_*、8 个 AppErrorCode、C2 整节 19 个类型、IPC_COMMANDS 11 个常量
- 从 lib/ipc-client.ts 移除 C2 整块 11 个方法与 9 个 import
- 从 RightPanel.tsx 移除 NLM tab 按钮与 NotebookLMView 渲染分支
- 从侧栏 5 个组件（ArtifactNode、DocumentNode、DocumentContextMenu、ZoteroList、Sidebar）清理 NotebookLM 引用
EOF
)"
```

---

## Task G1: 更新根 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 删除架构图中的 NotebookLM 引擎分支**

使用 Edit 工具：

`old_string`:
```text
[React 19 前端] <--Tauri IPC (40个Command + 6个Event)--> [Rust 后端]
                                                             |
                                                             +---> SQLite (app.db)
                                                             +---> macOS Keychain (API Key)
                                                             +---> HTTP --> [Python 翻译引擎 :8890]
                                                             |                 +-> antigravity_translate
                                                             |                 +-> pdf2zh (外部可执行文件)
                                                             +---> HTTP --> [NotebookLM 引擎 :8891]
```
`new_string`:
```text
[React 19 前端] <--Tauri IPC--> [Rust 后端]
                                    |
                                    +---> SQLite (app.db)
                                    +---> macOS Keychain (API Key)
                                    +---> HTTP --> [Python 翻译引擎 :8890]
                                                       +-> antigravity_translate
                                                       +-> BabelDOC（Python API）
```

- [ ] **Step 2: 删除数据流描述中的 NotebookLM 相关行**

`old_string`:
```text
- **后端 → 翻译引擎**: HTTP REST API（reqwest → FastAPI）
- **后端 → NotebookLM 引擎**: HTTP REST API
- **后端 → 数据库**: rusqlite 直连 SQLite 文件（`app.db`）
```
`new_string`:
```text
- **后端 → 翻译引擎**: HTTP REST API（reqwest → FastAPI）
- **后端 → 数据库**: rusqlite 直连 SQLite 文件（`app.db`）
```

- [ ] **Step 3: 从技术栈 Python 表删除 NotebookLM 相关依赖**

使用 Grep 定位当前表内容（在 `CLAUDE.md` 中搜索 `notebooklm-py` 的表格行），然后用 Edit 删除整行。

`old_string`:
```text
| PyMuPDF | ≥1.24.0 | `antigravity_translate` PDF 处理 |
| notebooklm-py | 0.3.4 | `rastro_notebooklm_engine` API 客户端 |
| browser-cookie3 | 0.20.1 | NotebookLM 认证 cookie 读取 |
| pdf2zh | 外部可执行文件 | PDF 数学公式翻译 |
```
`new_string`:
```text
| PyMuPDF | ≥1.24.0 | `antigravity_translate` PDF 处理 |
| pdf2zh | 外部可执行文件 | PDF 数学公式翻译 |
```

- [ ] **Step 4: 从 Mermaid 模块划分图删除 notebooklm_manager 节点**

`old_string`:
```text
    C --> C5["notebooklm_manager/ — NotebookLM 管理"];
    C --> C6["zotero_connector/ — Zotero 集成"];
    C --> C7["keychain/ — macOS Keychain"];
    C --> C8["artifact_aggregator — 产物聚合（v2）"];
```
`new_string`:
```text
    C --> C6["zotero_connector/ — Zotero 集成"];
    C --> C7["keychain/ — macOS Keychain"];
    C --> C8["artifact_aggregator — 产物聚合（v2）"];
```

并从项目模块划分的大纲中也移除 `rastro_notebooklm_engine/` 行：

`old_string`:
```text
    A --> D["rastro_translation_engine/ — 翻译服务"];
    A --> E["antigravity_translate/ — 翻译核心"];
    A --> F["rastro_notebooklm_engine/ — NotebookLM 服务"];
```
`new_string`:
```text
    A --> D["rastro_translation_engine/ — 翻译服务"];
    A --> E["antigravity_translate/ — 翻译核心"];
```

- [ ] **Step 5: 删除模块索引表中 `rastro_notebooklm_engine/` 行**

`old_string`:
```text
| `rastro_translation_engine/` | Python | 翻译引擎 HTTP 服务 | `__main__.py` | 无 |
| `antigravity_translate/` | Python | PDF 翻译核心逻辑 | `core.py` | 无 |
| `rastro_notebooklm_engine/` | Python | NotebookLM 本地代理 HTTP 服务 | `__main__.py` | 无 |
```
`new_string`:
```text
| `rastro_translation_engine/` | Python | 翻译引擎 HTTP 服务 | `__main__.py` | 无 |
| `antigravity_translate/` | Python | PDF 翻译核心逻辑 | `core.py` | 无 |
```

- [ ] **Step 6: 从文件夹布局中删除 `rastro_notebooklm_engine/` 整块**

`old_string`:
```text
├── rastro_translation_engine/         # ===== Python 翻译服务 =====
│   ├── __init__.py
│   ├── __main__.py                    # 入口
│   ├── server.py                      # FastAPI HTTP 服务
│   └── worker.py                      # 翻译工作线程
│
├── antigravity_translate/             # ===== Python 翻译核心 =====
│   ├── __init__.py
│   ├── __main__.py                    # CLI 入口
│   ├── core.py                        # 翻译核心逻辑
│   ├── config.py                      # 配置
│   └── prompts.py                     # AI 翻译 Prompt 模板
│
├── rastro_notebooklm_engine/          # ===== Python NotebookLM 服务 =====
│   ├── __init__.py
│   ├── __main__.py                    # 入口（未使用，由 server.py 入口）
│   ├── server.py                      # HTTP 服务
│   ├── service.py                     # 核心业务逻辑
│   └── models.py                      # 数据模型
│
├── genesis/                           # ===== 设计文档 =====
```
`new_string`:
```text
├── rastro_translation_engine/         # ===== Python 翻译服务 =====
│   ├── __init__.py
│   ├── __main__.py                    # 入口
│   ├── server.py                      # FastAPI HTTP 服务
│   └── worker.py                      # 翻译工作线程
│
├── antigravity_translate/             # ===== Python 翻译核心 =====
│   ├── __init__.py
│   ├── __main__.py                    # CLI 入口
│   ├── core.py                        # 翻译核心逻辑
│   ├── config.py                      # 配置
│   └── prompts.py                     # AI 翻译 Prompt 模板
│
├── genesis/                           # ===== 设计文档 =====
```

- [ ] **Step 7: 删除 "项目业务模块" 中的 "5. NotebookLM 集成" 整节，并将后续编号顺延**

`old_string`:
```text
### 5. NotebookLM 集成

- 本地代理引擎 (Python) 自动上传 PDF 并生成产物（思维导图、测验等）
- Rust `NotebookLMManager` 管理引擎生命周期

### 6. Zotero 集成
```
`new_string`:
```text
### 5. Zotero 集成
```

由于后续章节已经是 "6. Zotero 集成" → 现在应改为 "5."。上面的 Edit 同时完成了两件事。继续修改下一个：

`old_string`:
```text
### 7. 文档工作空间 (v2)
```
`new_string`:
```text
### 6. 文档工作空间 (v2)
```

- [ ] **Step 8: 变更记录表追加一行**

`old_string`:
```text
| 2026-04-08 | BabelDOC 迁移 | 翻译链路从 pdf2zh CLI 切换到 BabelDOC Python API，进度改为真实回调，运行时检查与安装引导同步更新 |
```
`new_string`:
```text
| 2026-04-08 | BabelDOC 迁移 | 翻译链路从 pdf2zh CLI 切换到 BabelDOC Python API，进度改为真实回调，运行时检查与安装引导同步更新 |
| 2026-04-10 | 移除 NotebookLM | 删除 NotebookLM 前端/后端/Python 引擎，新增 migration 011 清理数据库表，保留 Chat/Summary 与共享 ai_integration 基础设施 |
```

---

## Task G2: 更新 src/CLAUDE.md 与 src-tauri/CLAUDE.md

**Files:**
- Modify: `src/CLAUDE.md`
- Modify: `src-tauri/CLAUDE.md`

- [ ] **Step 1: src/CLAUDE.md — 删除组件树中的 notebooklm 节点**

`old_string`:
```text
    summary/
      SummaryPanel.tsx             # 文献总结面板
    setup/
      SetupWizard.tsx              # 初始设置向导
    notebooklm/
      NotebookLMView.tsx           # NotebookLM 视图
    ui/
```
`new_string`:
```text
    summary/
      SummaryPanel.tsx             # 文献总结面板
    setup/
      SetupWizard.tsx              # 初始设置向导
    ui/
```

- [ ] **Step 2: src/CLAUDE.md — 删除 notebooklm-automation import 说明（如有）**

使用 Grep 搜索 `notebooklm` 在 `src/CLAUDE.md` 中的所有出现位置，针对每个命中用 Edit 工具清理。典型位置：
- `src/lib/` 说明表中的 `notebooklm-automation.ts`
- 其他 NotebookLM 相关段落

对于 `src/lib/` 说明段：

`old_string`:
```text
  lib/
    ipc-client.ts                  # IPC 客户端封装
    notebooklm-automation.ts       # NotebookLM 自动化工具
  shared/
```
`new_string`:
```text
  lib/
    ipc-client.ts                  # IPC 客户端封装
  shared/
```

- [ ] **Step 3: src-tauri/CLAUDE.md — grep 清理任何 NotebookLM 残留**

使用 Grep 工具搜索 `notebooklm|NotebookLM|NOTEBOOKLM` 在 `src-tauri/CLAUDE.md` 中的出现。

预期：无命中（探索阶段扫描未发现 notebooklm 字面量出现在该文件中，此文件已严重过时，提及的 "25 个 IPC Command" 与实际不符）。

若确无命中，此 step 为空操作，跳过。

若有命中，使用 Edit 工具逐条清理，类似 src/CLAUDE.md 的处理方式。

---

## Task G3: 更新 genesis/v2/06_CHANGELOG.md

**Files:**
- Modify: `genesis/v2/06_CHANGELOG.md`

- [ ] **Step 1: 在文件顶部（## 格式说明 之后、最新日期条目之前）追加移除 NotebookLM 的变更记录**

`old_string`:
```markdown
## 格式说明
- **[CHANGE]** 微调已有任务（由 /change 处理）
- **[FIX]** 修复问题
- **[REMOVE]** 移除内容

---

## 2026-03-16 - S4 搜索优化 P1 完成 ✅
```
`new_string`:
```markdown
## 格式说明
- **[CHANGE]** 微调已有任务（由 /change 处理）
- **[FIX]** 修复问题
- **[REMOVE]** 移除内容

---

## 2026-04-10 - 移除 NotebookLM 集成 🗑️

- [REMOVE] 前端：`src/components/notebooklm/`、`useNotebookLMStore.ts`、`notebooklm-client.ts`、`notebooklm-automation.ts`
- [REMOVE] 后端：`src-tauri/src/notebooklm_manager/` 整个模块；`src-tauri/src/ipc/notebooklm.rs` 及 11 个 IPC Command
- [REMOVE] Python：`rastro_notebooklm_engine/` 整个包；`notebooklm-py==0.3.4`、`browser-cookie3==0.20.1` 依赖
- [REMOVE] 错误码：`errors.rs` 中 8 个 `NOTEBOOKLM_*` 错误码
- [REMOVE] 产物聚合：`ArtifactCount.notebooklm_count` 字段与 `notebooklm_artifacts` 表查询
- [ADD] migration 011 — `DROP TABLE IF EXISTS notebooklm_artifacts` + 相关索引
- [CHANGE] RightPanel 移除 NLM tab（保留对话/总结/标注/设置 四个 tab）
- [CHANGE] 侧栏状态 icon 移除 🧠 NotebookLM 产物指示器
- **保留**：AI 问答（Chat）、AI 总结（Summary）、共享 `ai_integration` 模块、`ai://stream-*` 事件、`AIStreamHandle`、`cancel_ai_stream`
- **原因**：NotebookLM 功能未被使用，移除以降低维护成本
- **Spec**: `docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md`
- **Plan**: `docs/superpowers/plans/2026-04-10-remove-notebooklm.md`

---

## 2026-03-16 - S4 搜索优化 P1 完成 ✅
```

- [ ] **Step 2: 提交文档变更（Task G1-G3）**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git add CLAUDE.md src/CLAUDE.md src-tauri/CLAUDE.md genesis/v2/06_CHANGELOG.md
git commit -m "docs: 更新项目文档以反映 NotebookLM 移除"
```

---

## Task H1: 运行时烟雾测试（手动）

**Files:** (no file modifications — manual validation)

- [ ] **Step 1: 启动应用**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
npm run tauri dev
```

等待 Rust 编译完成 + 前端 dev server 启动 + 应用窗口出现。

Expected: 无编译错误；窗口正常显示；控制台无 NotebookLM 相关红色错误。

- [ ] **Step 2: 验证 migration 011 已执行**

打开 SQLite 数据库文件查看表结构（macOS 路径）：
```bash
sqlite3 "$HOME/Library/Application Support/com.rastro.app/app.db" "SELECT version, name FROM schema_migrations ORDER BY version;"
```

Expected: 输出包含 `11|drop_notebooklm_artifacts` 行。

```bash
sqlite3 "$HOME/Library/Application Support/com.rastro.app/app.db" ".tables" | grep notebooklm
```

Expected: 空（无匹配行）。

- [ ] **Step 3: 手动功能回归**

依次验证以下功能（详见 spec §8.2）：

| 功能 | 验证操作 | 预期 |
|------|---------|------|
| 打开 PDF | 从侧栏点击文献 | PDF 正常渲染 |
| AI 问答（Chat） | 切换至"对话"tab，输入问题 | 流式回复正常 |
| AI 总结（Summary） | 切换至"总结"tab，点击生成 | 流式生成正常 |
| 文献翻译 | 点击翻译按钮 | 翻译任务启动/进度/完成正常 |
| 右面板 tab | 依次切换 4 个 tab | 对话/总结/标注/设置 正常；无 NLM tab |
| 文档侧栏产物指示 | 查看已翻译+已总结的文档 | 显示 🌐+📝；无 🧠 图标 |

- [ ] **Step 4: 关闭开发服务器**

在终端按 Ctrl+C 结束 `npm run tauri dev` 进程。

---

## Task H2: 最终全局残留 grep 检查

**Files:** (no file modifications — pure validation)

- [ ] **Step 1: 全项目 grep notebooklm 字面量**

使用 Grep 工具：
- pattern: `notebooklm|NotebookLM|NOTEBOOKLM`
- path: `/Users/alias/Desktop/work space/antigravity-paper`

Expected: 仅在以下位置出现：
- `docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md`（spec 文档本身）
- `docs/superpowers/plans/2026-04-10-remove-notebooklm.md`（本计划文档）
- `src-tauri/migrations/011_drop_notebooklm_artifacts.sql`
- `genesis/v2/06_CHANGELOG.md`（新增的移除记录）
- `genesis/v2/01_PRD.md`、`genesis/v2/03_ADR/`、`genesis/v2/04_SYSTEM_DESIGN/`、`genesis/v2/05_TASKS.md`、`genesis/v2/07_CHALLENGE_REPORT.md`（历史设计文档）
- `CLAUDE.md`（根，变更记录行）
- `src-tauri/Cargo.lock`（如有间接依赖残留；理论上因 Rust 侧无专属 crate，不应出现）

如命中其他任何位置，用 Edit 工具清理后 `git add`/`git commit --amend` 到最近一次文档 commit。

- [ ] **Step 2: 全项目 grep 8891 端口号**

使用 Grep 工具：
- pattern: `8891`
- path: `/Users/alias/Desktop/work space/antigravity-paper`

Expected: 仅在 `genesis/v2/` 下的历史设计文档与本 plan/spec 文件中。任何其他位置（如 `src-tauri/tauri.conf.json` 的 CSP）如有残留必须清理。

- [ ] **Step 3: 全项目 grep rastro_notebooklm_engine**

使用 Grep 工具：
- pattern: `rastro_notebooklm_engine`
- path: `/Users/alias/Desktop/work space/antigravity-paper`

Expected: 仅在历史文档 + spec/plan 文件中；`.gitignore`、`tauri.conf.json`、`requirements.txt` 等配置文件中必须无残留。

---

## Task H3: 可选 — Squash 为单一 commit

**Files:** (no file modifications)

> spec §2.1 建议"单次 commit 完成所有变更"以便回滚。按本计划执行完 Task A1 → G3 后会产生 4 个 commit（A1、D1、F1、G3 合并提交）。如需合并为单一 commit，执行此 Task。
>
> 如倾向保留多 commit 历史（更细粒度回滚），可跳过此 Task。

- [ ] **Step 1: 查看当前 HEAD 之前的 4 个 commit**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git log --oneline -6
```

Expected: 顶部 4 个 commit 分别为：
1. `docs: 更新项目文档以反映 NotebookLM 移除`
2. `refactor(frontend): 删除 NotebookLM UI 组件与类型`
3. `refactor(backend): 删除 NotebookLM Rust 模块与 IPC`
4. `chore: 删除 rastro_notebooklm_engine Python 包与相关配置`

第 5 个 commit 应为 spec 文档的 `docs: 新增移除 NotebookLM 的设计文档`（不参与 squash）。

- [ ] **Step 2: Soft reset 到 spec 文档 commit 之后、Task A1 之前**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
# 5193f42 是 spec 文档 commit 的 hash，以实际为准（可用 git log 确认）
git reset --soft 5193f42
```

此时所有 4 个 commit 的变更都保留在 staging area。

- [ ] **Step 3: 创建单一合并 commit**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git commit -m "$(cat <<'EOF'
refactor: 移除 NotebookLM 集成

实施 docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md
和 docs/superpowers/plans/2026-04-10-remove-notebooklm.md。

删除范围：
- Python: rastro_notebooklm_engine 包 + 2 个 pip 依赖
- Rust: notebooklm_manager 模块、ipc/notebooklm.rs（11 个 Command）、8 个错误码、app_state 字段
- 前端: NotebookLMView、useNotebookLMStore、notebooklm-client/automation、C2 整节类型与客户端方法
- UI: RightPanel 的 NLM tab、侧栏 🧠 产物指示器、6 个产物 emoji、右键菜单分支
- DB: 新增 migration 011 DROP notebooklm_artifacts 表与索引

保留：
- AI 问答（Chat）、AI 总结（Summary）完整功能
- ai_integration 模块、chat_service.rs、provider_registry、usage_meter
- ai://stream-* 事件、AIStreamHandle、cancel_ai_stream（Chat 与 Summary 共享）
- document_summaries 表与相关 IPC

验证：
- cargo check + cargo test 通过
- npm run build 通过
- npm run tauri dev 启动并完成烟雾测试
EOF
)"
```

- [ ] **Step 4: 确认 git log 状态**

```bash
cd "/Users/alias/Desktop/work space/antigravity-paper"
git log --oneline -3
```

Expected: 顶部两个 commit：
1. `refactor: 移除 NotebookLM 集成`
2. `docs: 新增移除 NotebookLM 的设计文档`

---

## 完成检查清单

计划全部执行完毕后，所有下列条目应打勾：

- [ ] `rastro_notebooklm_engine/` 目录已删除
- [ ] `src-tauri/src/notebooklm_manager/` 已删除
- [ ] `src-tauri/src/ipc/notebooklm.rs` 已删除
- [ ] `src/components/notebooklm/` 已删除
- [ ] `src/stores/useNotebookLMStore.ts` 已删除
- [ ] `src/lib/notebooklm-client.ts` 已删除
- [ ] `src/lib/notebooklm-automation.ts` 已删除
- [ ] `src-tauri/migrations/011_drop_notebooklm_artifacts.sql` 已创建
- [ ] `cargo check` 通过，无警告
- [ ] `cargo test` 所有测试通过
- [ ] `npm run build` 通过
- [ ] `npm run tauri dev` 能正常启动，migration 11 已应用
- [ ] 手动功能回归测试全部通过
- [ ] 全局 grep `notebooklm/NotebookLM/NOTEBOOKLM/8891/rastro_notebooklm_engine` 仅在允许的位置出现
- [ ] Git 历史中有至少一个（或 squash 后的一个）移除 commit
- [ ] `CLAUDE.md` 变更记录已追加
- [ ] `genesis/v2/06_CHANGELOG.md` 已追加移除记录
