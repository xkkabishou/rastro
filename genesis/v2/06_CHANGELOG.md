# 变更日志 - Genesis v2

> 此文件记录本版本迭代过程中的微调变更（由 /change 处理）。新增功能/任务需创建新版本（由 /genesis 处理）。

## 格式说明
- **[CHANGE]** 微调已有任务（由 /change 处理）
- **[FIX]** 修复问题
- **[REMOVE]** 移除内容

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
