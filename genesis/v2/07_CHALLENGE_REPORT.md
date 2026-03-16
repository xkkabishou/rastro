# Rastro v2 质疑报告 (Challenge Report)

> **审查日期**: 2026-03-16  
> **审查范围**: `genesis/v2` 全部设计文档 + `05_TASKS.md`  
> **累计轮次**: 1  
> **审查模式**: FULL（设计审查 + 任务审查）

---

## 📋 问题总览

### 第一轮（2026-03-16）

| ID | 严重度 | 摘要 | 状态 |
|----|--------|------|------|
| C1 | 🔴 | `notebooklm_artifacts` 表在代码库中不存在，设计文档引用为"已有"——幽灵依赖 | ✅ 已修复 |
| C2 | 🔴 | `summaries` 表与 `document_summaries` 表 Schema 矛盾——两种不兼容设计共存 | ✅ 已修复 |
| H1-H5 | 🟠 | 前端系统设计文档未同步 v2 / 产物缓存失效 / 展开时 N+1 查询 / 翻译竞态 / 删除悬挂 | ⏳ 待修复 |
| M1-M6 | 🟡 | 术语漂移 / 任务粒度 / 边界覆盖不足 / 事件监听泄漏 / generate_summary 保存时机 / Sprint 不均衡 | ⏳ 实现时处理 |

---

## 🎯 审查方法论

本次审查模式: **FULL**

1. **设计审查** (design-reviewer skill) — 执行 — 系统设计 / 运行模拟 / 工程实现 三维度
2. **任务审查** (task-reviewer skill) — 执行 — 重复 / 歧义 / 欠详述 / 不一致 / 覆盖率 / 质量粒度 六大 Pass
3. **Pre-Mortem** — 预演失败 + 假设验证
4. **合并评定** — 统一严重度分级 + 综合判断

---

## 🔥 第1轮详细审查（当前活跃）

### 📊 本轮问题统计

| 严重度 | 数量 | 占比 |
|--------|------|------|
| Critical | 2 | 15% |
| High | 5 | 38% |
| Medium | 6 | 47% |
| **Total** | **13** | **100%** |

| 维度 | 问题数 |
|------|--------|
| 设计审查 (design-reviewer) | 7 |
| 任务审查 (task-reviewer) | 4 |
| Pre-Mortem + 假设验证 | 2 |

---

# 🔴 Critical 级别

### C1. `notebooklm_artifacts` 表幽灵依赖

**严重度**: Critical  
**文档**: [ADR_003_DOCUMENT_WORKSPACE.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/03_ADR/ADR_003_DOCUMENT_WORKSPACE.md) §1, [02_ARCHITECTURE_OVERVIEW.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/02_ARCHITECTURE_OVERVIEW.md) §2.2, [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T1.2.1

**问题描述**:  
ADR-003 的聚合查询方案明确标注 `notebooklm_artifacts 表 (已有)` 作为三数据源之一。T1.2.1 任务的输入也引用 "现有 `notebooklm_artifacts` 表"。然而：

- `001_init.sql` 中**不存在** `notebooklm_artifacts` 表
- `src-tauri/src/storage/` 目录中**不存在** `notebooklm_artifacts.rs` 模块
- 全代码库 `grep "notebooklm_artifacts"` 返回 **零结果**

该表在整个代码库中是**完全不存在的幽灵实体**。

**影响**:
- `ArtifactAggregator` 模块（T1.2.1）无法实现——它依赖一个不存在的表
- `list_document_artifacts` IPC Command（T1.2.2）返回不完整——无法聚合 NotebookLM 产物
- 侧栏树形视图中 🧠 NotebookLM 产物子项无数据来源
- 这是 v2 核心价值命题（"文献即目录，一切产物尽在眼前"）的断裂

**建议**:

**选项 A（推荐）**: 在 v2 migration 中新增 `notebooklm_artifacts` 表，定义明确的 Schema（需包含 `document_id` 外键以支持聚合查询），并在 `notebooklm_manager` 模块中增加产物入库逻辑。

**选项 B**: 承认 NotebookLM 产物管理超出 v2 范围。从 ADR-003、ArtifactAggregator、PRD 的 `DocumentArtifactDto.kind` 枚举中移除 NotebookLM 相关内容。PRD 的侧栏设计图也需更新。

---

### C2. `summaries` 表与 `document_summaries` 表 Schema 矛盾

**严重度**: Critical  
**文档**: [rust-backend-system.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/04_SYSTEM_DESIGN/rust-backend-system.md) §6.2 vs [01_PRD.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/01_PRD.md) §7.1

**问题描述**:  
两份文档定义了**两个不同的** AI 总结表，Schema 互相矛盾：

| 差异点 | `rust-backend-system.md` §6.2 | `01_PRD.md` §7.1 |
|--------|------|------|
| 表名 | `summaries` | `document_summaries` |
| 主键 | `summary_id` | `summary_id` |
| 唯一约束 | `UNIQUE(document_id, provider, model, prompt_version)` | `UNIQUE(document_id)` |
| `prompt_version` 字段 | ✅ 有 | ❌ 无 |
| `updated_at` 字段 | ❌ 无 | ✅ 有 |
| 每文档记录数 | 多条（不同 provider/model/prompt 组合） | 仅一条 |

这导致：
1. 实现者无法确定应使用哪个 Schema - 两个"权威源"给出了不同答案
2. `upsert_summary()` 逻辑取决于唯一约束设计——两种约束意味着完全不同的 upsert 语义
3. T1.1.2 任务产出的 `document_summaries.rs` 模块将基于错误的假设实现

**影响**:
- 如果按 PRD 实现 `UNIQUE(document_id)`——切换 provider 后旧总结被覆盖，无法保留不同模型的总结版本
- 如果按 `rust-backend-system.md` 实现 `UNIQUE(document_id, provider, model, prompt_version)`——PRD 声称"每个文档仅保存最新一份总结"的约束被破坏，前端需处理多份总结的选择逻辑

**建议**:  
统一为一个明确的 Schema。考虑到 PRD 是需求源（"每个文档仅保存最新一份总结"），建议：
- 表名统一为 `document_summaries`（与 PRD 一致）
- 唯一约束用 `UNIQUE(document_id)`（每文档仅存一份）
- 增加 `updated_at` 字段（支持"重新生成"场景的时间追踪）
- 同步更新 `rust-backend-system.md` §6.2 中的 `summaries` 表定义

---

## 🟠 High 级别

### H1. 前端系统设计文档未同步 v2 变更

**严重度**: High  
**文档**: [frontend-system.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/04_SYSTEM_DESIGN/frontend-system.md) §4.1, §5, §6

**问题描述**:  
`frontend-system.md` 仍然是 v1 设计内容，**未包含** v2 的任何变更：

1. §4.1 组件关系图仍引用 `Zotero Sidebar (文献列表)` 而非 v2 的 `DocumentTree`
2. §5 接口设计**无** v2 新增的 10 个 IPC Command（`list_document_artifacts`, `delete_translation_cache` 等）
3. §6 数据模型中 `DocumentState` 无 `artifactsByDocId`、`expandedDocIds` 等 v2 新状态
4. 无 v2 新增组件（`DocumentNode`, `ArtifactNode`, `DocumentContextMenu`, `SearchBar`, `GroupChips`）的设计

**影响**:
- 开发者参考 `frontend-system.md` 会得到过时的组件关系和接口信息
- 前端设计文档与实际实现将严重不同步，增加维护和沟通成本

**建议**:  
在 v2 migration 前，将 `frontend-system.md` 更新为 v2 版本，至少覆盖：组件关系图、v2 IPC 接口、v2 数据模型、新增组件设计。

---

### H2. 产物缓存失效机制缺失——store 与数据库可能不一致

**严重度**: High  
**文档**: [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T2.2.5, [ADR_003_DOCUMENT_WORKSPACE.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/03_ADR/ADR_003_DOCUMENT_WORKSPACE.md)

**问题描述**:  
T2.2.5 的验收标准明确声明：

> "Given 产物已加载, When 再次折叠并展开, Then 使用缓存数据，不重复请求"

这意味着 `DocumentStore.artifactsByDocId` 会缓存产物列表。但**没有任何地方**定义缓存失效策略。以下运行时场景将导致数据不一致：

1. **删除翻译后**：T2.4.4 描述了"删除翻译后自动移除产物子项"，但如果用户之前已折叠该文献，`artifactsByDocId` 缓存可能仍包含已删除的翻译产物
2. **重新翻译完成后**：新翻译完成时，已缓存的产物列表仍是旧数据
3. **AI 总结保存后**：总结持久化后，如果文献已折叠，缓存不包含新总结

ADR-003 和 T2.2.5 都没有定义缓存失效事件列表。

**影响**:
- 用户删除翻译后展开文献，仍看到已删除的翻译子项（直到刷新页面）
- 数据一致性问题会破坏用户对产品的信任

**建议**:  
在 T2.2.5 或新增子任务中，明确定义缓存失效事件列表：`delete_translation_cache` / `save_document_summary` / `translation://job-completed` 等操作完成后，必须清除对应 `documentId` 的 `artifactsByDocId` 缓存条目（或直接刷新）。

---

### H3. 展开文献时的 N+1 查询模式

**严重度**: High  
**文档**: [ADR_003_DOCUMENT_WORKSPACE.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/03_ADR/ADR_003_DOCUMENT_WORKSPACE.md) §1, [02_ARCHITECTURE_OVERVIEW.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/02_ARCHITECTURE_OVERVIEW.md) §5

**问题描述**:  
ADR-003 承认"每次展开需要跨 3 张表查询（但数据量小，可接受）"。这在单文献展开场景确实可接受。但设计文档**没有**考虑以下场景：

1. **初始加载时需要状态 icon 数据**: T2.3.1 要求折叠状态也显示 🌐📝🧠 icon，这意味着**每个文献**的产物概况必须在列表加载时就获取——不能等到用户展开
2. 当前 `get_document_snapshot` 修改（T1.2.4）增加了 `hasSummary`/`artifactCount` 字段——但这需要在 `list_recent_documents` 时为**每个文档**查询产物状态，变成了 N+1 模式

如果用户有 50 篇文献，`list_recent_documents` 需要 50 次 `artifact_count` 子查询。虽然 SQLite 本地查询很快，但这仍是一个值得优化的设计点。

**影响**:
- 文献较多时（50+），侧栏首次加载可能出现可察觉的延迟
- 随着文献积累，性能会持续退化

**建议**:  
在 `list_recent_documents` 的 SQL 实现中，使用 `LEFT JOIN` + `GROUP BY` 一次性获取所有文档的产物计数和状态标志，而非 N 次独立子查询。在 T1.2.4 任务描述中明确这一实现约束。

---

### H4. 翻译删除与重新翻译的竞态条件未设计

**严重度**: High  
**文档**: [01_PRD.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/01_PRD.md) US-011, [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T2.4.4

**问题描述**:  
PRD US-011 验收标准指出：

> "选择'重新翻译', 弹出确认对话框, 可选更换 provider/model，确认后发起 `forceRefresh: true` 翻译请求。**旧翻译在新翻译完成前保留**。"

但设计文档未处理以下竞态场景：

1. 用户发起「重新翻译」→ 翻译进行中 → 用户又点「删除翻译」→ 旧翻译被删除 → 新翻译完成后写入，但中间用户已看到"无翻译"状态
2. 用户发起「重新翻译」→ 翻译进行中 → `forceRefresh: true` 会覆盖缓存，但 `translation_jobs` 表中旧 job 是保留还是删除？
3. `delete_translation_cache` 是否会取消正在运行的翻译任务？

**影响**:
- 用户在重新翻译过程中删除旧翻译，可能导致状态混乱
- 实现者缺少明确的状态机，将不得不自行设计——容易出 Bug

**建议**:  
在 `rust-backend-system.md` 或 PRD 中补充翻译产物状态机设计：明确 `delete_translation_cache` 在翻译进行中时的行为（建议：若当前有活跃翻译任务，先取消再删除旧缓存，或拒绝操作并提示"翻译进行中无法删除"）。

---

### H5. `document_id → notebook_id` 关联路径未定义

**严重度**: High  
**文档**: [01_PRD.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/01_PRD.md) §7.3, [ADR_003_DOCUMENT_WORKSPACE.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/03_ADR/ADR_003_DOCUMENT_WORKSPACE.md)

**问题描述**:  
PRD §7.3 写道：

> "现有 `notebooklm_artifacts` 表已按 `notebook_id` 组织。需建立 `document_id → notebook_id` 的关联查询"

但除了 C1 中已指出该表不存在外，即使假设该表存在，`document_id → notebook_id` 的关联路径也**完全未定义**：
- 没有关联表设计
- 没有说明 `notebook_id` 从哪里来
- 没有说明一个 document 可以对应多少个 notebook（1:1? 1:N?）
- 现有 `notebooklm_manager` 模块中没有任何 `document_id` 的概念

**影响**:
- 即使创建了 `notebooklm_artifacts` 表，`ArtifactAggregator` 也无法查询——缺少外键关系

**建议**:  
与 C1 一并解决。如果保留 NotebookLM 产物管理，需在 migration 中定义完整的关联模型（建议直接在 `notebooklm_artifacts` 表中增加 `document_id` 外键）。

---

## 🟡 Medium / 🟢 Low 级别

### M1. 前端组件图与 v2 架构矛盾（术语漂移）

**严重度**: Medium  
**文档**: [frontend-system.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/04_SYSTEM_DESIGN/frontend-system.md) §4.1

**问题描述**:  
v1 前端组件图中 `PanelLeft["Zotero Sidebar"]` → v2 后应为 `DocumentTree`。`PanelLeft <--> StoreSettings` → v2 后 Sidebar 应关联 `StoreDoc`（文档展开状态）而非仅 `StoreSettings`。这是典型的术语/架构漂移。

**建议**: 更新 `frontend-system.md` 中的 Mermaid 图。

---

### M2. T2.2.1 任务估时偏低（6h 实现虚拟化树形列表）

**严重度**: Medium  
**文档**: [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T2.2.1

**问题描述**:  
`DocumentTree` 需要：虚拟化渲染 + 扁平化计算 + 展开/折叠状态管理 + IPC 数据加载 + 动态行高（一级节点高于二级节点）+ 动画。`@tanstack/react-virtual` 的动态行高虚拟化本身就有较高实现复杂度。6h 估时较为乐观。

**建议**: 考虑将 T2.2.1 拆分为"虚拟化列表基础设施"和"文档+产物节点集成"两个子任务，或将估时调整至 8-10h。

---

### M3. 边界情况覆盖不足——大量 NotebookLM 产物的展示

**严重度**: Medium  
**文档**: [01_PRD.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/01_PRD.md) US-010

**问题描述**:  
PRD 的 `DocumentArtifactDto.kind` 枚举包含 6 种 NotebookLM 产物类型（mindmap, slides, quiz, flashcards, audio, report）。如果一篇文献有全部 6 种 NotebookLM 产物 + 翻译 + 总结，展开后将有 **9 个**二级子项。设计未说明：
- 子项过多时是否需要折叠/滚动
- 是否按类别分组（文档产物 | AI 产物 | NotebookLM 产物）

**建议**: 在 PRD 或 T2.2.3 中补充大量产物时的 UI 处理策略。

---

### M4. Tauri 事件监听泄漏风险

**严重度**: Medium  
**文档**: [rust-backend-system.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/04_SYSTEM_DESIGN/rust-backend-system.md) §7.4, [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T2.4.4

**问题描述**:  
T2.4.4 需要监听 `translation://job-completed` 和 `translation://job-progress` 事件来更新侧栏状态。但设计文档中没有提及事件监听器的生命周期管理。在 React 组件中，如果 `DocumentTree` 或 `Sidebar` 组件卸载后事件监听器未清理，会导致：
- 内存泄漏
- 更新已卸载组件的 state 导致 React 警告

**建议**: 在 T2.2.5 的 `DocumentStore` 设计中，明确 Tauri 事件监听器应在 store 初始化时注册，在应用退出时注销（因为 Zustand store 是全局的，生命周期与应用一致，这实际上是安全的——但需要在设计中明确声明这一点）。

---

### M5. `generate_summary` 流式完成后的保存时机模糊

**严重度**: Medium  
**文档**: [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) T2.4.5

**问题描述**:  
T2.4.5 验收标准：

> "Given 新生成的总结完成, When `ai://stream-finished` 事件触发, Then 自动调用 `saveDocumentSummary()` 持久化"

但 `ai://stream-finished` 事件的 payload 只有 `{ streamId, sessionId, messageId }`——不包含总结内容。前端需要：
1. 在流式接收过程中累积所有 `ai://stream-chunk` 的 delta 文本
2. 在 `ai://stream-finished` 时将累积的完整文本调用 `saveDocumentSummary()`

但如果总结是通过 `generate_summary` 触发的（而非 `ask_ai`），`ai://stream-finished` 中的 `sessionId` 和 `messageId` 对总结场景是否有意义？总结不属于聊天会话。

**建议**: 在 `rust-backend-system.md` 中明确 `generate_summary` 完成后的事件 payload，考虑增加 `summaryContent` 字段或在后端直接保存总结（`generate_summary` 完成时由 Rust 后端自动调用 `save_document_summary`，而非由前端负责）。

---

### M6. Sprint 工作量分配不均衡

**严重度**: Medium  
**文档**: [05_TASKS.md](file:///Users/alias/Desktop/work%20space/antigravity-paper/genesis/v2/05_TASKS.md) Sprint 路线图

**问题描述**:  
Sprint 估时分布：

| Sprint | 任务数 | 估时 |
|--------|--------|------|
| S1 | 8 | ~26h |
| S2 | 7 | ~29h |
| S3 | 6 | ~24h |
| S4 | 8 | ~21h（含 INT 任务） |

S2 是最重的 Sprint（29h，包含侧栏重写和虚拟化树形列表），而 S2 的估时 3-4d 可能偏乐观，特别是考虑到 T2.2.1（虚拟化树形列表）的复杂度。

**建议**: 考虑将 T2.3.1（状态 Icon）或 T2.3.2（翻译切换控件）移至 S3，减轻 S2 压力。

---

## 📋 建议行动清单

### P0 - 立即处理 (阻塞)
1. **[C1]** 确定 NotebookLM 产物管理的范围：保留则需在 v2 migration 中新建 `notebooklm_artifacts` 表并定义 `document_id` 关联；排除则清理所有文档中的 NotebookLM 产物引用
2. **[C2]** 统一 AI 总结表 Schema：确定使用 `document_summaries` + `UNIQUE(document_id)` 还是允许多版本，然后同步更新 `rust-backend-system.md` §6.2

### P1 - 近期处理 (重要)
1. **[H1]** 更新 `frontend-system.md` 以反映 v2 变更
2. **[H2]** 在 T2.2.5 中补充产物缓存失效事件列表
3. **[H3]** 在 T1.2.4 中明确 `list_recent_documents` 使用 JOIN 批量获取产物元数据
4. **[H4]** 在 `rust-backend-system.md` 中补充翻译产物状态机（删除/重翻竞态处理）
5. **[H5]** 与 C1 一并解决 `document_id → notebook_id` 关联

### P2 - 持续改进 (优化)
1. **[M2]** 调整 T2.2.1 估时或拆分任务
2. **[M3]** 补充大量产物的 UI 策略
3. **[M5]** 明确 `generate_summary` 完成后的保存职责归属
4. **[M6]** 平衡 Sprint 工作量分配

---

## 🚦 最终判断

- [ ] 🟢 项目可继续，风险可控
- [x] 🟡 项目可继续，但需先解决 P0 问题
- [ ] 🔴 项目需要重新评估

**判断依据**: 2 个 Critical 问题都属于"文档层面的幽灵引用/矛盾"，而非根本性的架构缺陷。v2 的核心设计理念（树形视图 + 产物聚合）是合理的。但 C1 和 C2 如果不解决，S1 的 T1.1.1（migration）和 T1.2.1（ArtifactAggregator）将无法正确实现，会导致整个开发链条延误。建议在开始 `/forge` 之前修复这两个 Critical 问题。

---

## 📚 附录

### A. Pre-Mortem 分析

| 失败场景 | Root Cause | 概率 | 对应问题 |
|---------|-----------|:----:|----------|
| ArtifactAggregator 实现时发现 NotebookLM 表不存在，全面返工 | 设计文档引用了不存在的数据源 | 🔴高 | C1 |
| AI 总结 migration 与后端实现不一致，上线后数据丢失 | 两份文档的 Schema 矛盾未解决 | 🔴高 | C2 |
| 侧栏加载缓慢，50+ 文献时用户等待 > 2s | 产物状态 N+1 查询 | 🟡中 | H3 |
| 用户删除翻译后侧栏仍显示翻译子项 | 产物缓存失效机制缺失 | 🟡中 | H2 |
| 重新翻译过程中删除旧翻译，状态混乱 | 竞态条件未设计 | 🟡中 | H4 |

### B. 假设验证结果

| 假设 | 验证方法 | 结果 | 风险 |
|------|---------|------|:----:|
| `notebooklm_artifacts` 表已存在 | `grep` 全代码库 + 检查 migration SQL | **表不存在** | ❌ 证伪 |
| `summaries` 表设计已统一 | 对比 PRD §7.1 与 rust-backend §6.2 | **两者矛盾** | ❌ 证伪 |
| `@tanstack/react-virtual` 已在项目中使用 | 检查 v1 `ZoteroList.tsx` | ADR-003 声称 v1 已使用，待验证 package.json | ⚠️ 未验证 |
| 翻译引擎对 `forceRefresh` 的行为明确 | 检查 `translation-engine-system.md` | 已有定义，`forceRefresh` 旁路缓存 | ✅ 已验证 |
| SQLite 跨 3 表查询性能可接受 | 本地 SQLite + 数据量 < 1000 | 单次查询可接受，但 N 次循环查询需要优化 | ⚠️ 条件性验证 |

### C. 任务审查摘要

| Pass | 检测项数 | CRITICAL | HIGH | MEDIUM | LOW |
|------|:-------:|:--------:|:----:|:------:|:---:|
| A 重复检测 | 0 | 0 | 0 | 0 | 0 |
| B 歧义检测 | 0 | 0 | 0 | 0 | 0 |
| C 欠详述检测 | 1 | 0 | 0 | 1 | 0 |
| D 不一致性检测 | 2 | 1 | 1 | 0 | 0 |
| E 覆盖率检测 | 0 | 0 | 0 | 0 | 0 |
| F 质量粒度 | 2 | 0 | 0 | 2 | 0 |
| **合计** | **5** | **1** | **1** | **3** | **0** |

**任务整体健康度**: 🟡 需关注（1 个 CRITICAL: C1/C2 对 T1.2.1 的依赖影响）

**REQ 覆盖率**: 8/8 (100%) — 所有 REQ-010 到 REQ-017 均有对应任务

**US 完整性**: 8/8 (100%) — 所有 US 的 `涉及系统` 均有前后端任务覆盖

**关键路径**: `T1.1.1 → T1.1.2 → T1.2.1 → T1.2.2 → T2.1.1 → T2.1.2 → T2.2.1 → T2.2.4 → T2.2.5 → T2.3.2 → INT-S2`（链长 11，最长路径）
