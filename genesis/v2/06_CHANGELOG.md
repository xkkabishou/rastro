# 变更日志 - Genesis v2

> 此文件记录本版本迭代过程中的微调变更（由 /change 处理）。新增功能/任务需创建新版本（由 /genesis 处理）。

## 格式说明
- **[CHANGE]** 微调已有任务（由 /change 处理）
- **[FIX]** 修复问题
- **[REMOVE]** 移除内容

---

## 2026-04-14 - AI 总结右键菜单精简 ✂️

- [CHANGE] `DocumentContextMenu.tsx` AI 总结菜单项从 3 项收窄为 2 项：`重新生成` / `删除总结`
- [REMOVE] `ContextMenuAction` 联合类型中删除 `view_summary`、`export_summary_md`
- [REMOVE] `Sidebar.tsx` 中 `case 'view_summary'` 与 `case 'export_summary_md'` 分支（共约 40 行）
- [REMOVE] `Sidebar.tsx` 中仅服务于导出功能的 `save`（plugin-dialog）、`invoke`（api/core）未用 import
- [ADD] `ContextMenuAction` 新增 `delete_summary`；`Sidebar.tsx` 新增 `case 'delete_summary'` 分支，带二次确认 + 产物缓存失效 + 文档快照刷新 + Summary 面板重置
- [UPDATE] `ZoteroList.tsx` 注释同步 action 枚举清单
- [UPDATE] `01_PRD.md` §US-015 第 153 行验收标准更新；`05_TASKS.md` T2.4.6 描述与验收重写
- **原因**: 产品决策变更 — "查看总结" 与单击产物节点功能重复；"导出为 Markdown" 使用频次低；新增 "删除总结" 对齐 "删除翻译" 的操作闭环
- **后端契约零改动**: `delete_document_summary` IPC 与 `ipcClient.deleteDocumentSummary` 均已存在，仅前端接线

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
- **保留**：AI 问答（Chat）、AI 总结（Summary）、共享 `ai_integration` 模块、`ai://stream-*` 事件
- **原因**：NotebookLM 功能未被使用，移除以降低维护成本

---

## 2026-03-16 - S4 搜索优化 P1 完成 ✅

- [DONE] T2.5.1: `src/components/sidebar/SearchBar.tsx` — 300ms 防抖 + 清空按钮
- [DONE] T2.5.2: `src/components/sidebar/GroupChips.tsx` — 全部/已翻译/有总结/收藏 Chip 筛选
- [DONE] T2.5.3: `Sidebar.tsx` loadRecentDocuments 搜索/筛选参数适配（Wave 6 已实现）
- [ADD] `globals.css` no-scrollbar 工具类
- **Commits**: `21717bf`
- **P2 延后**: T1.3.1~T1.3.3 + T2.5.4（缓存统计/清理/收藏/Finder 显示）

---

## 2026-03-16 - Bug Fix: pdf-text-extractor ReadableStream 崩溃 🐛→✅

- [FIX] `src/lib/pdf-text-extractor.ts` — getTextContent() 在 Tauri WebView 崩溃
  - 根因：pdfjs getTextContent() 内部调用 streamTextContent()，依赖 ReadableStream；Tauri WebView 的 ReadableStream 实现存在但残缺
  - 三层修复：① ensureReadableStream() 最小化 polyfill ② PDFWorker fake worker ③ ArrayBuffer 预加载
- **Commits**: `cda8e7d`, `21717bf`, `6dca1d6`

---

## 2026-03-16 - S3 产物管理完成 ✅

- [DONE] T2.4.1: `src/components/sidebar/DocumentContextMenu.tsx` — 动态右键菜单
- [DONE] T2.4.2: `Sidebar.tsx` handleContextMenuAction — 右键菜单完整操作分发
- [DONE] T2.4.3: `src/components/pdf-viewer/TranslationPanel.tsx` — 翻译信息卡片
- [DONE] T2.4.4: 翻译删除/重翻流程与侧栏状态联动
- [DONE] T2.4.5: `SummaryPanel.tsx` 持久化增强 — 自动保存/加载已有总结
- [DONE] T2.4.6: 总结重新生成 + 导出为 Markdown + 右键集成
- [ADD] `useDocumentStore.refreshDocumentSnapshot()` — 操作后刷新文档状态
- **Commits**: `40a10d1`, `890a8ea`

---

## 2026-03-16 - S2 前端树形视图完成 ✅

- [DONE] T2.1.1: `src/shared/types.ts` v2 DTO 类型定义
- [DONE] T2.1.2: `src/lib/ipc-client.ts` v2 IPC 方法
- [DONE] T2.2.1: `src/components/sidebar/DocumentTree.tsx` — 虚拟化树形列表
- [DONE] T2.2.2: `src/components/sidebar/DocumentNode.tsx` — 文献一级节点
- [DONE] T2.2.3: `src/components/sidebar/ArtifactNode.tsx` — 产物二级节点
- [DONE] T2.2.4: `Sidebar.tsx` 容器重构 — 统一树形列表
- [DONE] T2.2.5: `useDocumentStore.ts` 扩展 — 产物缓存/展开状态/搜索/筛选
- [DONE] T2.3.1: 文档状态 Icon 聚合 (🌐📝🧠⟳)
- [DONE] T2.3.2: TranslationSwitch 分段控件增强
- [FIX] `0e9a569` — DocumentTree contain:strict 导致侧栏列表不可见
- **Commits**: `a5ca595`, `f1aaeed`, `0e9a569`

---

## 2026-03-16 - S1 后端完成 ✅

- [DONE] T1.1.1: `src-tauri/migrations/v2_document_workspace.sql` — document_summaries + notebooklm_artifacts 表 + documents 扩展
- [DONE] T1.1.2: `src-tauri/src/storage/document_summaries.rs` — upsert/get/delete CRUD + 测试
- [DONE] T1.1.3: `src-tauri/src/storage/documents.rs` — is_favorite/is_deleted + list_with_filters + DocumentFilter
- [DONE] T1.2.1: `src-tauri/src/artifact_aggregator.rs` — 4 源聚合查询 (original + translation + summary + notebooklm)
- [DONE] T1.2.2: `ipc/document.rs` + `ipc/translation.rs` — list_document_artifacts + delete_translation_cache
- [DONE] T1.2.3: `ipc/ai.rs` — get/save/delete_document_summary
- [DONE] T1.2.4: `ipc/document.rs` — remove/favorite/reveal + list_recent 扩展 + DocumentSnapshot 丰富化
- **验证**: `cargo check` ✅ | `cargo test` 70 passed, 0 failed ✅

---

## 2026-03-16 - Challenge C1/C2 修复

- [CHANGE] T1.1.1: 扩展 migration 范围，增加 `notebooklm_artifacts` 表创建（含 `document_id` 外键），估时 3h→4h，REQ 增加 REQ-010
  - 用户原话: "/change 修复 C1/C2"
  - PRD 追溯: [REQ-010], [REQ-013]
- [CHANGE] T1.1.2: 明确 Schema 权威源为 PRD §7.1（`UNIQUE(document_id)`, 含 `updated_at`），细化 upsert 语义
  - PRD 追溯: [REQ-013]
- [CHANGE] T1.2.1: 输入从"现有 `notebooklm_artifacts`"改为"T1.1.1 产出的 `notebooklm_artifacts`（`document_id` 外键直接关联）"
  - PRD 追溯: [REQ-010]
- [CHANGE] `rust-backend-system.md` §6.2: `summaries` → `document_summaries`，`UNIQUE(doc_id,provider,model,prompt_version)` → `UNIQUE(document_id)`，移除 `prompt_version`，增加 `updated_at`
  - PRD 追溯: [REQ-013]

## 2026-03-16 - 初始化
- [ADD] 创建 Genesis v2 版本
- [ADD] 版本目标：文档管理系统迭代（侧栏重构 + 翻译管理 + AI 总结管理）
