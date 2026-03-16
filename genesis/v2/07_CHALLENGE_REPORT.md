# Rastro v2 质疑报告 (Challenge Report)

> **审查日期**: 2026-03-16  
> **审查范围**: `genesis/v2` 全部设计文档 + `05_TASKS.md` + **实现代码**  
> **累计轮次**: 3  
> **审查模式**: FULL（设计审查 + 代码审查）

---

## 📋 问题总览

> 此目录随每轮审查同步维护。已解决的轮次仅保留此摘要行，详细内容在确认修复后删除。

### 第一轮（2026-03-16，7/13 已修复）

| ID | 严重度 | 摘要 | 状态 |
|----|--------|------|------|
| C1-C2 | 🔴 | notebooklm_artifacts 幽灵依赖 / summaries 表 Schema 矛盾 | ✅ 全部修复 |
| H1 | 🟠 | 前端系统设计文档未同步 v2 | ⏳ 文档债务 |
| H2-H5 | 🟠 | 产物缓存失效 / N+1 查询 / 翻译删除竞态 / notebook 关联 | ✅ R2 中修复 |
| M1-M6 | 🟡 | 术语漂移 / 任务粒度 / 边界覆盖 / 事件监听 / summary 保存时机 / Sprint 均衡 | ✅ 实现已完成 |

### 第二轮（2026-03-16，5/5 已修复）

| ID | 严重度 | 摘要 | 状态 |
|----|--------|------|------|
| R2-H1 | 🟠 | `snapshot_from_record()` N+1 查询 | ✅ 已修复（`batch_enrich_snapshots`） |
| R2-H2 | 🟠 | `get_cache_stats()` 总量不含总结存储 | ✅ 已修复（+`summaryBytes`） |
| R2-M1-M2 | 🟡 | 活跃任务检查 / 静默吞噬删除错误 | ✅ 已修复 |
| R2-L1 | 🟢 | Tauri 事件监听未在 store 中注册 | ✅ 已修复（但有问题→见 R3-H1/H2） |

### 第三轮（2026-03-16）

| ID | 严重度 | 摘要 | 状态 |
|----|--------|------|------|
| R3-H1 | 🟠 | `translation://job-completed` 事件后端未 emit，前端监听器为死代码 | ✅ 已修复（event emitter callback） |
| R3-H2 | 🟠 | `ai://stream-finished` payload 不含 `documentId`，前端守卫恒退出 | ✅ 已修复（+`documentId`） |
| R3-M1 | 🟡 | `batch_enrich_snapshots` 统计所有已完成 job 的产物，单文档路径仅统计最新 job | ✅ 已修复（MAX(created_at) 子查询） |
| R3-M2 | 🟡 | `clear_all_translation_cache` 不检查活跃翻译任务（与 R2-M1 同类） | ✅ 已修复 |
| R3-L1 | 🟢 | `snapshot_from_record` 仍被 `get_document_snapshot` 单文档路径使用，两路径产物计数可能不一致 | ✅ 已修复（R3-M1 修复后逻辑一致） |

---

## 🎯 审查方法论

本次审查模式: **FULL**（第三轮，验证修复 + 深度代码审查）

1. **修复验证** — 验证 Round 2 所有 5 个修复的正确性
2. **代码审查** — 对新增代码（`batch_enrich_snapshots`、`initDocumentEventListeners`）的深度逻辑审查
3. **事件一致性** — 跨 Rust/TS 边界的事件名称和 payload 结构交叉验证
4. **合并评定** — 统一严重度分级

---

## 🔥 第3轮详细审查（当前活跃）

### 📊 本轮问题统计

| 严重度 | 数量 | 占比 |
|--------|------|------|
| Critical | 0 | 0% |
| High | 2 | 40% |
| Medium | 2 | 40% |
| Low | 1 | 20% |
| **Total** | **5** | **100%** |

| 维度 | 问题数 |
|------|--------|
| 事件一致性（Rust emit ↔ TS listen） | 2 |
| 查询逻辑一致性 | 2 |
| 代码减重 | 1 |

---

## 🟠 High 级别

### R3-H1. `translation://job-completed` 事件后端从未 emit

**严重度**: High  
**文件**:  
- 前端监听: [useDocumentStore.ts:220](file:///Users/alias/Desktop/work%20space/antigravity-paper/src/stores/useDocumentStore.ts#L220)
- 后端翻译管理: [translation_manager/](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/translation_manager/)

**问题描述**:  
R2-L1 修复添加了 `initDocumentEventListeners()`，其中注册了 `translation://job-completed` 监听。但 **Rust 后端没有任何代码 emit 这个事件**。

对整个 `src-tauri/src/` 目录搜索 `emit.*translation`、`emit.*job.*completed` 和 `translation://job-completed`，结果为零。翻译完成的流程在 `translation_manager/mod.rs` 中，完成时仅更新数据库状态，不发送 Tauri 窗口事件。

**证据**:

```bash
grep -r 'translation://job-completed' src-tauri/src/  # → 0 results
grep -rE 'emit.*(translation|job.*completed)' src-tauri/src/  # → 0 results
```

**影响**:
- 翻译完成后，侧栏状态 icon **不会** 自动刷新。用户仍需手动操作触发刷新。
- `initDocumentEventListeners()` 中的翻译监听器是 **纯死代码**。

**建议**:  
在翻译管理器的 job 完成回调中添加 `app.emit("translation://job-completed", { documentId })` 调用。

---

### R3-H2. `ai://stream-finished` payload 不含 `documentId`

**严重度**: High  
**文件**:  
- 后端 emit: [chat_service.rs:404-411](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/ai_integration/chat_service.rs#L404-L411)
- 前端监听: [useDocumentStore.ts:233](file:///Users/alias/Desktop/work%20space/antigravity-paper/src/stores/useDocumentStore.ts#L233)

**问题描述**:  
后端 `ai://stream-finished` emit 的 payload 结构是：

```rust
json!({
    "streamId": prepared.stream_id,
    "sessionId": prepared.session_id,
    "messageId": message.message_id,
})
```

**不含** `documentId` 字段。而前端监听器的守卫逻辑：

```typescript
const docId = event.payload?.documentId;
if (!docId) return;  // ← 恒为 true，永远退出
```

`documentId` 恒为 `undefined`，守卫立刻 return。AI 总结完成后产物状态同样 **不会** 自动刷新。

**证据**: `PreparedStream` 结构体包含 `document_id` 字段（`chat_service.rs:27`），emit 时完全可用但未包含在 payload 中。

**影响**: 与 R3-H1 相同 — AI 总结完成后侧栏不自动更新。R2-L1 的修复实际 **未生效**。

**建议**: 在 emit payload 中加入 `"documentId": prepared.document_id`。

---

## 🟡 Medium 级别

### R3-M1. `batch_enrich_snapshots` 与 `snapshot_from_record` 产物计数逻辑不一致

**严重度**: Medium  
**文件**:  
- 批量路径: [document.rs:385-407](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/ipc/document.rs#L385-L407)
- 单文档路径: [artifact_aggregator.rs:161-197](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/artifact_aggregator.rs#L161-L197)

**问题描述**:  
`batch_enrich_snapshots` 中统计翻译产物的 SQL：

```sql
SELECT ta.document_id, COUNT(*) as cnt
FROM translation_artifacts ta
INNER JOIN translation_jobs tj ON ta.job_id = tj.job_id
WHERE ta.document_id IN (...) AND tj.status = 'completed'
  AND ta.artifact_kind IN ('translated_pdf', 'bilingual_pdf')
GROUP BY ta.document_id
```

这统计了 **所有** 已完成 job 的产物。而 `count_artifacts_for_document()` 仅查 `find_latest_completed_for_document()` 返回的 **最新** 一个 job 的产物。

如果用户重新翻译了一篇文档（旧 job 产物未被清理），批量路径的 `artifact_count` 会比单文档路径大。

**影响**: 列表中的产物计数和单文档详情页的计数可能不匹配，造成 UI 展示不一致。

**建议**: 批量 SQL 中增加子查询或窗口函数限制为每个 document_id 仅取最新一个 completed job 的产物。

---

### R3-M2. `clear_all_translation_cache` 不检查活跃翻译任务

**严重度**: Medium  
**文件**: [settings.rs:546-590](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/ipc/settings.rs#L546-L590)

**问题描述**:  
R2-M1 为 `delete_translation_cache`（单文档删除）添加了活跃任务检查。但 `clear_all_translation_cache`（全局清理）没有同样的检查：

```rust
// settings.rs:584-586
transaction.execute("DELETE FROM translation_artifacts", [])?;
transaction.execute("DELETE FROM translation_jobs", [])?;
```

直接删除所有 job（含 `pending`/`running`），与翻译引擎产生同样的竞态条件。

**影响**: 如果用户在翻译进行中点击"清理所有缓存"，活跃 job 记录被删除，引擎完成后写入的产物无法关联。

**建议**: `clear_all_translation_cache` 入口也应先检查是否有活跃任务，或 DELETE SQL 中排除 `status IN ('pending', 'running')` 的记录。

---

## 🟢 Low 级别

### R3-L1. 两条路径产物计数可能漂移

**严重度**: Low  
**文件**: [document.rs:270-327](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/ipc/document.rs#L270-L327) vs [document.rs:329-486](file:///Users/alias/Desktop/work%20space/antigravity-paper/src-tauri/src/ipc/document.rs#L329-L486)

**问题描述**: `snapshot_from_record`（单文档路径）和 `batch_enrich_snapshots`（列表路径）是两套独立的逻辑。任何一方修改后如果忘记同步另一方，会产生产物计数不一致。这不是当前 bug，而是一个维护性风险。

**建议**: 将产物计数逻辑抽为共享函数，或让单文档路径也走批量路径（传入单元素列表）。

---

## 📋 建议行动清单

### P1 - 近期处理 (重要)

1. **[R3-H1]** 翻译 job 完成时 emit `translation://job-completed` 事件，payload 含 `documentId`
2. **[R3-H2]** `ai://stream-finished` payload 中添加 `documentId` 字段

### P2 - 持续改进 (优化)

1. **[R3-M1]** 修复 `batch_enrich_snapshots` 的翻译产物计数，限制为最新 completed job
2. **[R3-M2]** `clear_all_translation_cache` 增加活跃任务检查
3. **[R3-L1]** 考虑统一两条路径的产物计数逻辑
4. **[H1]** 更新 `frontend-system.md`（文档债务，跨轮遗留）

---

## 🚦 最终判断

- [x] 🟢 项目可继续，风险可控
- [ ] 🟡 项目可继续，但需先解决 P0 问题
- [ ] 🔴 项目需要重新评估

**判断依据**: 无 Critical 问题。R3-H1 和 R3-H2 是 R2-L1 修复的"完成度"问题——事件监听框架已搭建，但后端事件发射未补全。这意味着 R2-L1 的修复在 **形式上完成** 但 **实际未生效**，需要补全 emit 端。核心业务逻辑（文档管理、翻译、AI 总结）不受影响，问题仅影响侧栏自动刷新的用户体验。

---

## 📚 附录

### A. Pre-Mortem 分析（更新）

| 失败场景 | Root Cause | 概率 | 对应问题 |
|---------|-----------|:----:|----------|
| ~~ArtifactAggregator 幽灵依赖~~ | ~~notebooklm_artifacts 表不存在~~ | ~~🔴~~ | ~~C1 ✅~~ |
| ~~Schema 矛盾~~ | ~~两份文档不一致~~ | ~~🔴~~ | ~~C2 ✅~~ |
| ~~侧栏加载缓慢~~ | ~~per-document N+1 查询~~ | ~~🟡~~ | ~~R2-H1 ✅~~ |
| ~~存储显示不准~~ | ~~freed_bytes 累加错误~~ | ~~🟡~~ | ~~R2-M2 ✅~~ |
| 事件监听无效 | 后端未 emit / payload 不匹配 | 🟠中 | R3-H1, R3-H2 |
| 产物计数漂移 | 两套独立统计逻辑 | 🟢低 | R3-M1, R3-L1 |

### B. 假设验证结果（更新）

| 假设 | 验证方法 | 结果 | 风险 |
|------|---------|------|:----:|
| ~~`notebooklm_artifacts` 表已存在~~ | migration SQL | ✅ 已验证 | ✅ |
| ~~`snapshot_from_record` 查询性能可接受~~ | batch 优化 | ✅ 已修复 | ✅ |
| ~~`get_cache_stats` 含全部缓存~~ | 代码审查 | ✅ 已修复 | ✅ |
| ~~缓存清理正确释放空间~~ | 错误处理修复 | ✅ 已修复 | ✅ |
| Rust 后端会 emit `translation://job-completed` | grep 证伪 | ❌ 未 emit | ⚠️ |
| `ai://stream-finished` payload 含 documentId | 代码审查 | ❌ 不含 | ⚠️ |
| 批量与单文档产物计数一致 | SQL 逻辑对比 | ⚠️ 不完全一致 | ⚠️ |
