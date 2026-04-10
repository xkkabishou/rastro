# 移除 NotebookLM 集成 — 设计文档

- **作者**: 哈雷酱（Claude Opus 4.6）
- **日期**: 2026-04-10
- **状态**: 待实施
- **范围**: 仅删除 NotebookLM 相关代码；保留 AI 问答（Chat）与 AI 总结（Summary）

---

## 1. 背景与目标

### 1.1 背景

Rastro v2 在 `genesis/v2/` 迭代中规划了 NotebookLM 集成，提供通过本地 Python 代理自动上传 PDF 并生成思维导图/演示文稿/测验等产物的能力。经过实际使用发现该功能未被使用，且引入了额外的维护成本：
- 独立的 Python 引擎进程（8891 端口）
- 16+ 个前端类型定义、11 个 IPC Command、8 个专属错误码
- 数据库半成品表 `notebooklm_artifacts`（生产代码从未写入）
- 2 个 Python 依赖（`notebooklm-py`、`browser-cookie3`）

### 1.2 目标

一次性删除 NotebookLM 所有相关代码、类型、模块、Python 包与配置，同时：
- 完整保留 AI 问答（Chat）与 AI 总结（Summary）功能
- 保留两者共享的基础设施（`ai_integration` 模块、`ai://stream-*` 事件、`AIStreamHandle`、`cancel_ai_stream`）
- 通过新增 DROP migration 清理现有用户数据库中的空表
- 确保删除后 `cargo check`、`cargo test`、`npm run build`、`npm run tauri dev` 全部通过

### 1.3 非目标

- **不触碰** AI 问答 / AI 总结 / 翻译 / Zotero 集成相关代码
- **不修改** 历史 migration 文件（遵循 migration 不可变原则）
- **不回溯修改** `genesis/v2/` 下的 PRD / ADR / System Design 等历史设计文档

---

## 2. 总体策略

### 2.1 单次删除 + 新增 DROP migration

在一次提交中完成所有代码、类型、模块、Python 包、UI 元素、文档的删除，同时新增一条 `003_drop_notebooklm_artifacts.sql` migration 清理现有用户数据库中的空表。

**理由**：
- NotebookLM 已与保留功能完全解耦，单次删除不会出现"删了一半"的中间态编译失败
- 纯删除任务无需增量验证，一次性 `cargo check + npm run build` 即可确认代码库干净
- 单次 commit 便于回滚（`git revert` 即可）

### 2.2 保留的共享基础设施（零改动）

| 共享项 | 位置 | 用途 |
|--------|------|------|
| `ai_integration/` 模块 | `src-tauri/src/ai_integration/` | Chat + Summary 共用 Provider 路由 |
| `chat_service.rs`（1004 行） | `src-tauri/src/ai_integration/chat_service.rs` | 包含 `start_chat()`、`start_summary_flow()`、`run_stream_request()` |
| `ai://stream-chunk` 事件 | 全局 Tauri event | Chat 和 Summary 共用流式 token 推送 |
| `ai://stream-finished` 事件 | 全局 Tauri event | Chat、Summary、useDocumentStore 刷新均监听 |
| `ai://stream-failed` 事件 | 全局 Tauri event | Chat + Summary 错误处理 |
| `AIStreamHandle` 类型 | `types.ts` + `ipc/ai.rs` | `ask_ai` 和 `generate_summary` 共用返回类型 |
| `cancel_ai_stream` IPC | `ipc/ai.rs` | Chat 和 Summary 共用取消流式的能力（SummaryPanel.tsx 与 useDocumentStore.ts 都调用） |
| `CancelAiStreamInput` / `CancelAiStreamResult` | `types.ts` | 同上 |
| `provider_registry.rs` | `src-tauri/src/ai_integration/` | 跨功能 Provider 路由 |
| `usage_meter.rs` | `src-tauri/src/ai_integration/` | Token 用量统计 |
| `document_summaries` 表 | v2 migration | Summary 存储 |
| `useChatStore.ts` | `src/stores/` | AI 问答状态 |
| `useSummaryStore.ts` | `src/stores/` | AI 总结状态 |
| `chat_sessions` / `chat_messages` 表 | migration 001 + 002 | AI 问答历史 |

---

## 3. 前端删除范围

### 3.1 完整删除的文件/目录

| 路径 | 说明 |
|------|------|
| `src/components/notebooklm/` | 含 `NotebookLMView.tsx`（391 行） |
| `src/stores/useNotebookLMStore.ts` | 287 行 Zustand store |
| `src/lib/notebooklm-client.ts` | NotebookLM HTTP 客户端封装 |
| `src/lib/notebooklm-automation.ts` | NotebookLM 自动化工具 |

### 3.2 编辑修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/shared/types.ts` | 删除 16+ 个 `NotebookLM*` 类型定义；删除 `IPC_COMMANDS` 对象里的 11 个 notebooklm 命令常量条目 |
| `src/lib/ipc-client.ts` | 删除 `notebooklmClient` 对象及其全部方法；删除所有 `NotebookLM*` 类型 import |
| `src/components/panel/RightPanel.tsx` | 删除 `NotebookLMView` import；删除 `PanelTab` 联合类型中的 `'notebooklm'`；删除 `<PanelTabButton label="NLM">` 按钮；删除 `activeTab === 'notebooklm'` 渲染分支 |
| `src/components/sidebar/DocumentContextMenu.tsx` | 删除 `kind.startsWith('notebooklm_')` 分支及其所有菜单项 |
| `src/components/sidebar/DocumentNode.tsx` | 删除 🧠 NotebookLM 产物指示器逻辑（行 57-63） |
| `src/components/sidebar/ArtifactNode.tsx` | 删除 6 个 `notebooklm_*` 产物图标 case（mindmap/slides/quiz/flashcards/audio/report） |
| `src/components/sidebar/ZoteroList.tsx` | 删除 `'notebooklm_mindmap'` 等产物图标 case |
| `src/components/sidebar/Sidebar.tsx` | 清理注释（行 145、452）；删除 notebooklm 相关动作处理逻辑 |

### 3.3 默认 Tab 行为

RightPanel 默认 tab 保持 `'chat'`（用户保留 AI 问答），无需修改默认值。面板打开时仍直接展示 Chat tab。

---

## 4. Rust 后端删除范围

### 4.1 完整删除的目录/文件

| 路径 | 说明 |
|------|------|
| `src-tauri/src/notebooklm_manager/` | 整个目录，含 `mod.rs`、`engine_supervisor.rs`、`http_client.rs` |
| `src-tauri/src/ipc/notebooklm.rs` | 11 个 IPC Command 的定义文件 |

### 4.2 编辑修改的文件

#### 4.2.1 `src-tauri/src/main.rs`

- 删除 11 个 `ipc::notebooklm::*` command 在 `invoke_handler` 中的注册行
- 删除相关 `use` 语句

**涉及的 11 个 IPC Command**（全部移除）：
- `notebooklm_get_status`
- `notebooklm_begin_login`
- `notebooklm_open_external`
- `notebooklm_logout`
- `notebooklm_list_notebooks`
- `notebooklm_create_notebook`
- `notebooklm_attach_current_pdf`
- `notebooklm_generate_artifact`
- `notebooklm_get_task`
- `notebooklm_list_artifacts`
- `notebooklm_download_artifact`

#### 4.2.2 `src-tauri/src/ipc/mod.rs`

- 删除 `pub mod notebooklm;` 声明

#### 4.2.3 `src-tauri/src/app_state.rs`

- 删除 `notebooklm_manager: NotebookLMManager` 字段
- 删除 `notebooklm_status: Arc<Mutex<NotebookLMEngineStatus>>` 字段
- 删除 `AppState::new()` / 构造函数中对应的初始化代码
- 删除 `use crate::notebooklm_manager::*` 等相关 import

#### 4.2.4 `src-tauri/src/errors.rs`

- 删除 `AppErrorCode` 枚举的 8 个 `Notebooklm*` 变体：
  - `NotebooklmAuthRequired`
  - `NotebooklmAuthExpired`
  - `NotebooklmEngineUnavailable`
  - `NotebooklmUploadFailed`
  - `NotebooklmGenerationFailed`
  - `NotebooklmDownloadFailed`
  - `NotebooklmRateLimited`
  - `NotebooklmUnknown`
- 删除 `as_str()` 方法中 8 个对应的 match arm
- 删除错误码序列化一致性测试中的 8 个元组条目（`(AppErrorCode::NotebooklmXxx, "NOTEBOOKLM_XXX")`）

#### 4.2.5 `src-tauri/src/artifact_aggregator.rs`

- 删除 `ArtifactCount` struct 的 `notebooklm_count: u32` 字段
- 修改 `total_count()` 方法：去掉 `+ self.notebooklm_count`
- 删除 `list_artifacts_for_document()` 中查询 `notebooklm_artifacts` 表的完整代码段（约行 120-148）
- 删除 `count_artifacts_for_document()` 中的 `notebooklm_count` COUNT 子查询（约行 183-191）
- 删除 `notebooklm_title()` 辅助函数（约行 207-217）
- 修改单元测试：
  - 移除 `INSERT INTO notebooklm_artifacts` 测试夹具
  - 移除 `assert!(kinds.contains(&"notebooklm_mindmap"))` 断言

#### 4.2.6 `src-tauri/src/ipc/document.rs`

- 删除批量查询 `notebooklm_counts` HashMap 的代码段（约行 399-420）
- 修改 `artifact_count` 计算：去掉 `+ notebooklm_count`
- 修改测试代码：
  - 删除 `use crate::ipc::notebooklm::NotebookLMEngineStatus`
  - 删除 `use crate::notebooklm_manager::NotebookLMManager`
  - 删除测试夹具中构造 `AppState` 时的 `notebooklm_manager` 和 `notebooklm_status` 字段

#### 4.2.7 `src-tauri/src/ipc/translation.rs`

- 修改测试代码：
  - 删除 `use crate::notebooklm_manager::NotebookLMManager`
  - 删除测试夹具中构造 `AppState` 时的 `notebooklm_manager` 和 `notebooklm_status` 字段
  - 删除 `NotebookLMEngineStatus { port: 8891, ... }` 初始化代码块

#### 4.2.8 `src-tauri/src/storage/migrations.rs`

- 修改单元测试（行 171-174）：将验证 `notebooklm_artifacts` 表**存在**的断言改为验证其**不存在**（migration 003 已删除）

---

## 5. 数据库 Migration

### 5.1 新增 Migration 文件

**路径**：`src-tauri/migrations/003_drop_notebooklm_artifacts.sql`

**内容**：

```sql
-- 删除 NotebookLM 相关表和索引（v3 清理：移除 NotebookLM 功能）
DROP INDEX IF EXISTS idx_notebooklm_artifacts_document_id;
DROP INDEX IF EXISTS idx_notebooklm_artifacts_created_at;
DROP TABLE IF EXISTS notebooklm_artifacts;
```

### 5.2 Migration 注册

- `src-tauri/src/storage/migrations.rs` 的 migration 注册表追加一条记录
- 版本号 `3`
- 按现有 001 / v2 migration 的注册模式对齐（`include_str!("../../migrations/003_drop_notebooklm_artifacts.sql")`）

### 5.3 历史 Migration 处理

- `src-tauri/migrations/v2_document_workspace.sql` **保持不动**（不删除 `CREATE TABLE notebooklm_artifacts` 和两个索引）
- **理由**：
  - 遵循 migration 不可变原则（不破坏已部署用户的 migration 校验链）
  - 全新安装：先 run v2 创建表，再 run 003 删除，结果一致（额外代价 < 1ms）
  - 避免修改历史文件导致已有 migration hash 不匹配

### 5.4 数据安全评估

- `notebooklm_artifacts` 表在**生产代码中从未被 INSERT**
- 仅测试夹具中有 `INSERT INTO notebooklm_artifacts` 语句
- 即使是长期用户也不存在任何真实 NotebookLM 产物数据
- **结论**：无需导出/备份/迁移数据步骤，DROP 即完全安全

---

## 6. Python 模块与配置清理

### 6.1 完整删除的目录

| 路径 | 说明 |
|------|------|
| `rastro_notebooklm_engine/` | 整个 Python 包（`__init__.py`、`__main__.py`、`server.py`、`service.py`、`models.py`、`storage.py`） |

### 6.2 编辑修改的配置文件

| 文件 | 修改内容 |
|------|---------|
| `requirements.txt` | 删除 `notebooklm-py==0.3.4` 和 `browser-cookie3==0.20.1` 两行 |
| `src-tauri/tauri.conf.json` | 删除 `resources` 数组中的 `"../rastro_notebooklm_engine/**/*.py"` 条目 |
| `.gitignore` | 删除第 79 行 `rastro_notebooklm_engine/`（目录不再存在） |

### 6.3 残留检查清单

实施时必须全项目 grep 以下关键词确认无遗漏：

- `notebooklm`（不区分大小写）
- `NotebookLM`
- `NOTEBOOKLM`
- `8891`
- `rastro_notebooklm_engine`

**预期仅剩位置**：
- `docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md`（本文档）
- `src-tauri/migrations/003_drop_notebooklm_artifacts.sql`
- `genesis/v2/` 下的历史设计文档（PRD / ADR / System Design 等）
- `genesis/v2/06_CHANGELOG.md` 新增的变更记录

### 6.4 保留不动

- `rastro_translation_engine/`（翻译引擎 Python 服务）
- `antigravity_translate/`（翻译核心 Python 包）
- `PyMuPDF`、`babeldoc` 等翻译相关依赖
- `src-tauri/capabilities/` 下的 Tauri v2 权限声明（经核查无 notebooklm 专属权限）

---

## 7. 文档更新

### 7.1 必须更新的文档

| 文件 | 修改内容 |
|------|---------|
| `CLAUDE.md`（项目根） | ① 架构图移除 `[NotebookLM 引擎 :8891]` 分支；② 技术栈表删除 `notebooklm-py`、`browser-cookie3` 两行；③ 模块索引表删除 `rastro_notebooklm_engine/` 行；④ Mermaid 图删除 `notebooklm_manager` 节点；⑤ "项目业务模块 > 5. NotebookLM 集成" 整节删除，后续章节编号顺延；⑥ IPC Command 总数描述更新为删除后实际数量（以 `main.rs` 中 `invoke_handler!` 宏展开后的实际条目数为准）；⑦ "变更记录"表追加一条移除 NotebookLM 的记录 |
| `src/CLAUDE.md` | ① 组件结构树删除 `notebooklm/NotebookLMView.tsx`；② 删除 `useNotebookLMStore` 相关文案（如有） |
| `genesis/v2/06_CHANGELOG.md` | 追加一条"移除 NotebookLM 集成"变更记录，注明日期、涉及模块、删除原因 |

### 7.2 保持不动的历史文档

以下为设计历史档案，按文档工程惯例**不回溯修改**，仅在 CHANGELOG 中记录功能移除：

- `genesis/v1/` 全部文件（已归档）
- `genesis/v2/01_PRD.md`
- `genesis/v2/03_ADR/`（ADR 应为不可变历史记录）
- `genesis/v2/04_SYSTEM_DESIGN/rust-backend-system.md`
- `genesis/v2/05_TASKS.md`
- `genesis/v2/07_CHALLENGE_REPORT.md`

**理由**：保留设计历史对后续可能的功能回滚、架构决策追溯、演进路径分析有价值。

---

## 8. 验证计划

### 8.1 自动化验证（顺序执行）

| 步骤 | 命令 | 预期结果 |
|------|------|---------|
| 1 | `cd src-tauri && cargo check` | 无编译错误；无 `dead_code` / `unused_import` 警告 |
| 2 | `cd src-tauri && cargo test` | 所有单测通过（预期 70+ → 约 65 个，减去 notebooklm 相关断言） |
| 3 | `npm run build` | 前端 TypeScript 严格编译通过；无 `Cannot find module` / `Type not found` 错误 |
| 4 | `npm run tauri dev` | 应用正常启动；migration 003 执行成功；前端无红屏 |

### 8.2 手动功能回归

| 功能 | 验证步骤 | 预期结果 |
|------|---------|---------|
| 打开 PDF | 从侧栏选择一个文献 | PDF 正常渲染 |
| AI 问答 | 打开右面板 "对话" tab，输入问题 | 流式回复正常；会话列表正常；历史加载正常 |
| AI 总结 | 切换到 "总结" tab，点击生成 | 流式生成正常；保存/删除按钮正常 |
| 文献翻译 | 点击翻译按钮 | 翻译任务启动/进度/完成事件正常 |
| Zotero 侧栏 | 切换到 Zotero 列表 | 文献列表加载正常 |
| 右面板 Tab | 依次切换 4 个 tab | 对话 / 总结 / 标注 / 设置 四个 tab 全部可切换；无 NLM tab 按钮 |
| 文档侧栏产物指示 | 查看已翻译 + 已总结的文档 | 显示 🌐 + 📝 两个图标；无 🧠 图标 |
| 现有用户升级 | 启动已有数据库的旧版本应用 | migration 003 自动执行；`notebooklm_artifacts` 表被 DROP；无启动错误 |

### 8.3 负面断言

- 全项目 grep `notebooklm|NotebookLM|NOTEBOOKLM|8891|rastro_notebooklm_engine`，期望仅在：
  - `docs/superpowers/specs/2026-04-10-remove-notebooklm-design.md`
  - `src-tauri/migrations/003_drop_notebooklm_artifacts.sql`
  - `genesis/v2/*.md` 历史文档
  - `genesis/v2/06_CHANGELOG.md` 变更记录
  - `CLAUDE.md` 变更记录行
  中出现
- `cargo check` 不应输出任何 unused import / dead code 警告
- `npm run build` 不应输出任何类型错误

### 8.4 回滚策略

- 所有变更集中在单次 commit 完成
- 若验证失败，可直接 `git revert` 回到当前 HEAD
- Migration 003 采用 `DROP TABLE IF EXISTS`，代码回滚后该 migration 仍可幂等执行（但 NotebookLM 功能不会自动恢复，需同时恢复代码）

---

## 9. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|-------|------|---------|
| `ArtifactCount` struct 变更导致跨文件编译失败 | 高 | 中 | 单次 commit 全部修改；`cargo check` 验证所有使用点 |
| AppState 构造改动影响未被 grep 发现的测试代码 | 中 | 低 | 依赖 `cargo test` 完整运行；残留失败项手动修复 |
| 前端残留类型引用被 TypeScript 编译器捕获 | 中 | 低 | `npm run build` 严格模式验证 |
| Migration 003 顺序错误导致启动崩溃 | 低 | 高 | migration 注册表按版本号升序；`cargo test` 覆盖 migration 顺序 |
| 用户在升级时 Python 引擎还在运行 | 低 | 低 | Tauri 卸载/升级流程会先终止旧进程；新版本无 8891 端口占用需求 |
| 误删共享基础设施（`ai://stream-*`、`cancel_ai_stream` 等） | 低 | 高 | 设计文档明确列出保留清单；实施时对照 §2.2 逐项核查 |

---

## 10. 实施顺序建议

推荐的文件修改顺序（从叶子到根，最后到入口）：

1. **Python 清理**：删除 `rastro_notebooklm_engine/` + 修改 `requirements.txt` + `tauri.conf.json` + `.gitignore`
2. **Rust 子模块删除**：删除 `src-tauri/src/notebooklm_manager/` + `src-tauri/src/ipc/notebooklm.rs`
3. **Rust 错误码清理**：修改 `errors.rs` 删除 8 个变体 + 对应测试
4. **Rust 聚合逻辑清理**：修改 `artifact_aggregator.rs` + `ipc/document.rs` + `ipc/translation.rs`
5. **Rust 应用状态清理**：修改 `app_state.rs` + `ipc/mod.rs` + `main.rs`
6. **数据库 Migration**：新建 `003_drop_notebooklm_artifacts.sql` + 修改 `storage/migrations.rs`
7. **前端文件删除**：删除 `src/components/notebooklm/` + `useNotebookLMStore.ts` + `notebooklm-client.ts` + `notebooklm-automation.ts`
8. **前端类型/客户端修改**：修改 `types.ts` + `ipc-client.ts`
9. **前端 UI 修改**：修改 `RightPanel.tsx` + 侧栏 5 个文件
10. **文档更新**：修改 `CLAUDE.md`（根 + src）+ `genesis/v2/06_CHANGELOG.md`
11. **全量验证**：`cargo check`、`cargo test`、`npm run build`、`npm run tauri dev`
12. **残留 grep**：按 §8.3 负面断言逐项核对
13. **单次 commit 提交**

---

## 11. 开放问题

无。所有关键决策已在 brainstorming 阶段与用户确认。

---

## 12. 附录：IPC Command 清单对照

### 删除的 NotebookLM IPC Command（11 个）

| # | Command 名称 | 原文件位置 |
|---|--------------|-----------|
| 1 | `notebooklm_get_status` | `ipc/notebooklm.rs` |
| 2 | `notebooklm_begin_login` | `ipc/notebooklm.rs` |
| 3 | `notebooklm_open_external` | `ipc/notebooklm.rs` |
| 4 | `notebooklm_logout` | `ipc/notebooklm.rs` |
| 5 | `notebooklm_list_notebooks` | `ipc/notebooklm.rs` |
| 6 | `notebooklm_create_notebook` | `ipc/notebooklm.rs` |
| 7 | `notebooklm_attach_current_pdf` | `ipc/notebooklm.rs` |
| 8 | `notebooklm_generate_artifact` | `ipc/notebooklm.rs` |
| 9 | `notebooklm_get_task` | `ipc/notebooklm.rs` |
| 10 | `notebooklm_list_artifacts` | `ipc/notebooklm.rs` |
| 11 | `notebooklm_download_artifact` | `ipc/notebooklm.rs` |

### 保留的 IPC Command 分类

| 类别 | 说明 |
|------|------|
| 文档管理 | documents 表 CRUD + 产物聚合 |
| 翻译 | 翻译任务 + 引擎生命周期 + 缓存管理 |
| AI（Chat + Summary） | `ask_ai` / `cancel_ai_stream` / `list_chat_sessions` / `get_chat_messages` / `generate_summary` / `get_document_summary` / `save_document_summary` / `delete_document_summary` |
| Settings / Provider | Provider 配置 + 使用统计 |
| Zotero | Zotero 只读集成 |

> 注：具体 IPC Command 总数以实施后 `main.rs` 中 `invoke_handler!` 宏展开后的实际条目数为准。CLAUDE.md 中的数字描述需同步更新为准确值。
