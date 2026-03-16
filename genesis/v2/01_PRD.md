# 产品需求文档 (PRD) v2.0

**项目名称**: Rastro
**功能名称**: 文档管理系统迭代
**文档状态**: 评审中 (Review)
**版本号**: 2.0
**前序版本**: v1.0
**负责人**: Genesis Agent
**创建日期**: 2026-03-16

---

## 1. 执行摘要 (Executive Summary)

Rastro v2 聚焦于**文档管理系统**的迭代升级。v1 已完成核心功能（PDF 阅读、全文翻译、AI 问答、AI 总结、NotebookLM 集成），但在日常使用中暴露了以下核心痛点：

1. **侧栏混乱** — 本地文档和 Zotero 文档在两个扁平列表中无层级展示
2. **翻译产物管理缺失** — 翻译完成后自动显示译文，无法重新翻译、删除或查看翻译详情
3. **AI 总结/NotebookLM 产物管理缺失** — 产物散落在不同面板中，与文献的关联不直观

**v2 核心设计理念**: 借鉴 Zotero 的组织方式，将侧栏从扁平列表重构为 **"文献即目录"** 树形结构。每篇文献是一个可展开的目录，点开后显示该文献关联的所有产物：原件 PDF、翻译 PDF、AI 总结文档、NotebookLM 产物。

---

## 2. 当前系统痛点分析 (Problem Analysis)

### 2.1 用户反馈的痛点

| # | 痛点描述 | 严重度 | 当前表现 |
|---|---------|:------:|---------|
| P1 | 侧栏文章混乱，一股脑 | 🔴 高 | 近期文档和 Zotero 是两个独立的扁平列表，无层级结构，无状态标识 |
| P2 | 翻译文件管理不到位 | 🔴 高 | 翻译后默认显示中文 PDF，无法重新翻译、删除翻译、查看翻译参数 |
| P3 | AI 总结管理不到位 | 🟡 中 | 总结通过聊天流式输出，关闭后无法再次查看，无持久化 |

### 2.2 头脑风暴发现的痛点

| # | 痛点描述 | 严重度 | 分析 |
|---|---------|:------:|------|
| P4 | 文档产物分散在不同位置 | 🔴 高 | 翻译在 PdfViewer、总结在 SummaryPanel、NotebookLM 在独立面板，找不到一个文献的全部资料 |
| P5 | 文档无状态可视化 | 🔴 高 | 侧栏看不出哪些文档已翻译、有总结，需打开后才知道 |
| P6 | 近期文档无搜索 | 🟡 中 | Zotero 列表有搜索框，但近期文档列表没有 |
| P7 | 无法从历史移除文档 | 🟡 中 | 近期文档不断累积，无法清理 |
| P8 | 翻译 PDF 切换不直观 | 🟡 中 | 仅用 Option 键临时切换，没有持久切换 UI 控件 |
| P9 | 无右键菜单 | 🟡 中 | 侧栏文档条目没有上下文菜单 |
| P10 | 缓存空间不透明 | 🟢 低 | 翻译缓存占多少磁盘空间看不到 |

---

## 3. 目标与范围 (Goals & Non-Goals)

### 3.1 目标 (Goals)

- **[G2.1]**: 重构侧栏为 **Zotero 式树形结构** — 每篇文献是可展开的目录，展开后显示：原件 PDF、翻译 PDF、AI 总结、NotebookLM 产物。
- **[G2.2]**: 统一产物模型 — 将翻译 PDF、AI 总结、NotebookLM 产物统一为 `DocumentArtifact`，在树形视图中一致展示。
- **[G2.3]**: 翻译产物生命周期管理 — 查看翻译详情、重新翻译（可更换 provider）、删除翻译缓存。
- **[G2.4]**: AI 总结持久化 — 总结结果保存到数据库，在工作空间树中显示为子项，支持重新生成。
- **[G2.5]**: 翻译 PDF 切换增强 — 工具栏提供分段控件（原文/译文）持久切换，保留 Option 键快捷方式兼容。
- **[G2.6]**: 侧栏搜索和分组筛选 — 搜索框 + 分组 Chips（全部/已翻译/有总结/收藏）。
- **[G2.7]**: 右键上下文菜单 — 文献级和产物级操作（翻译/总结/删除/重新生成/Finder 显示）。

### 3.2 非目标 (Non-Goals)

- **[NG2.1]**: 不做自定义标签/文件夹管理系统（不重复 Zotero 功能）。
- **[NG2.2]**: 不做跨设备同步（延续 v1 本地存储策略）。
- **[NG2.3]**: 不做批量操作（首版逐个管理）。
- **[NG2.4]**: 不做 PDF 批注功能（延续 v1 非目标 NG1）。

---

## 4. 用户故事与需求清单 (User Stories)

### US-010: 文献即目录 — 侧栏树形结构 [REQ-010] (优先级: P0)

*   **故事描述**: 作为科研工作者，我希望侧栏像 Zotero 一样为每篇文献提供一个可展开的目录，点开后看到这篇文献的所有产物（原件 PDF、翻译 PDF、AI 总结、NotebookLM 产物），这样我能清晰知道每篇文献的完整处理状态。
*   **用户价值**: 从"打开文档 → 翻散在各处找产物"变为"展开目录 → 一切尽在眼前"。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 用户打开侧栏, **When** 查看文献列表, **Then** 每篇文献显示为一级节点（文献标题 + 来源标签 + 状态 icon），前方有展开/折叠箭头。
    *   [ ] **Given** 用户点击展开某篇文献, **When** 展开完成, **Then** 显示该文献下的所有产物子项:
         - 📄 原件 PDF（始终存在）
         - 🌐 翻译 PDF（若已翻译）
         - 📝 AI 总结（若已生成）
         - 🧠 NotebookLM 产物（若已生成，可能多个: 思维导图/演示文稿/测验等）
    *   [ ] **Given** 用户点击产物子项"翻译 PDF", **When** 点击完成, **Then** PDF 阅读区切换显示翻译后的 PDF。
    *   [ ] **Given** 用户点击产物子项"原件 PDF", **When** 点击完成, **Then** PDF 阅读区切换显示原文 PDF。
    *   [ ] **Given** 用户点击产物子项"AI 总结", **When** 点击完成, **Then** 右侧面板切换显示已保存的 AI 总结内容。
    *   [ ] **Given** 文献产物状态发生变化（如翻译完成）, **When** 查看侧栏, **Then** 新产物自动出现在该文献目录下，无需手动刷新。
    *   [ ] **Given** 文献列表超过 20 条（展开+折叠混合）, **When** 滚动, **Then** 列表保持虚拟化渲染，滚动流畅。
*   **边界与极限情况**:
    *   Zotero 文献和本地文献混合显示在同一列表中（通过来源标签区分）
    *   默认折叠，仅展开当前正在阅读的文献
    *   无产物的文献展开后仅显示"原件 PDF"一项

### US-011: 翻译产物生命周期管理 [REQ-011] (优先级: P0)

*   **故事描述**: 作为科研工作者，我想要能够对翻译产物进行管理——查看翻译详情、重新翻译或删除翻译，以便在翻译质量不满意或更换 AI provider 后重新翻译。
*   **用户价值**: 消除"翻译完就锁死"的限制，翻译成为可管理的资产。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 文献工作空间中存在翻译 PDF 子项, **When** 用户右键点击, **Then** 弹出菜单: `查看翻译详情` / `重新翻译` / `删除翻译`。
    *   [ ] **Given** 用户选择"查看翻译详情", **When** 面板打开, **Then** 显示: provider 名称、模型版本、翻译时间、翻译文件大小。
    *   [ ] **Given** 用户选择"重新翻译", **When** 弹出确认对话框, **Then** 可选更换 provider/model，确认后发起 `forceRefresh: true` 翻译请求。旧翻译在新翻译完成前保留。
    *   [ ] **Given** 用户选择"删除翻译", **When** 确认, **Then** 删除翻译 PDF 文件和数据库记录，文献工作空间中翻译子项消失，侧栏状态 icon 更新。
    *   [ ] **Given** 翻译正在进行中, **When** 查看文献工作空间, **Then** 显示"⟳ 翻译中..." 子项（带进度信息），可取消。
*   **边界与极限情况**:
    *   需新增后端 IPC Command: `delete_translation_cache`
    *   删除操作不可逆，二次确认

### US-012: 翻译 PDF 切换增强 [REQ-012] (优先级: P0)

*   **故事描述**: 作为科研工作者，我想要一个明显的 UI 控件来切换原文和译文，而不仅仅依赖 Option 键的隐式操作。
*   **用户价值**: 降低学习成本，新用户无需记住快捷键。
*   **涉及系统**: `frontend-system`
*   **验收标准**:
    *   [ ] **Given** 当前文档已有翻译, **When** 查看 PDF 工具栏, **Then** 出现分段控件: `原文` / `译文`，当前选中状态高亮。
    *   [ ] **Given** 用户在侧栏点击"翻译 PDF"子项, **When** 切换完成, **Then** 工具栏控件自动同步为"译文"选中。
    *   [ ] **Given** 文档没有翻译, **When** 查看工具栏, **Then** 切换控件不显示。
    *   [ ] **Given** 保留 Option 键快捷方式兼容 v1。

### US-013: AI 总结持久化管理 [REQ-013] (优先级: P0)

*   **故事描述**: 作为科研工作者，我想要 AI 生成的文献总结被保存下来，并在文献工作空间中显示为子项，以便随时查看、重新生成或导出。
*   **用户价值**: 总结是重要的阅读笔记资产，必须持久化管理。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 用户对某文档生成了 AI 总结, **When** 总结完成, **Then** 总结内容(Markdown)持久化到数据库，文献工作空间自动新增"📝 AI 总结"子项。
    *   [ ] **Given** 用户在侧栏点击"📝 AI 总结"子项, **When** 点击, **Then** 右侧面板显示已保存的总结内容（Markdown 渲染）。
    *   [ ] **Given** 用户重新打开该文档, **When** 展开文献工作空间, **Then** AI 总结子项仍然存在，无需重新生成。
    *   [ ] **Given** 用户右键点击"📝 AI 总结", **When** 选择"重新生成", **Then** 弹出确认框（说明将消耗 API 额度），确认后重新生成并替换旧总结。
*   **边界与极限情况**:
    *   需新增后端: `document_summaries` 表 + `get_document_summary` / `save_document_summary` IPC Commands
    *   每个文档仅保存最新一份总结

### US-014: 侧栏文档状态可视化 [REQ-014] (优先级: P0)

*   **故事描述**: 作为科研工作者，我想要在侧栏一眼看到每篇文献有哪些产物，以便快速判断哪些还需要处理。
*   **用户价值**: 减少无意义的展开操作，折叠状态也能了解文献处理进度。
*   **涉及系统**: `frontend-system`
*   **验收标准**:
    *   [ ] **Given** 文献已翻译, **When** 查看折叠状态的条目, **Then** 标题右侧显示 🌐 翻译 icon。
    *   [ ] **Given** 文献有 AI 总结, **When** 查看折叠状态的条目, **Then** 标题右侧显示 📝 总结 icon。
    *   [ ] **Given** 文献有 NotebookLM 产物, **When** 查看折叠状态的条目, **Then** 标题右侧显示 🧠 icon。
    *   [ ] **Given** 文献正在翻译中, **When** 查看侧栏, **Then** 显示动态加载指示器（旋转 icon/脉动点）。
    *   [ ] **Given** 多个状态同时存在, **When** 查看侧栏, **Then** 多个 icon 并列显示，不超过 3 个（超出显示 +N）。

### US-015: 右键上下文菜单 [REQ-015] (优先级: P1)

*   **故事描述**: 作为科研工作者，我想要在侧栏右键点击文献或产物时看到操作菜单。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 右键文献（一级节点）, **When** 菜单弹出, **Then** 包含: `翻译全文` / `生成 AI 总结` / `在 Finder 中显示` / `从历史移除` / `收藏 / 取消收藏`。
    *   [ ] **Given** 右键翻译产物（二级节点）, **When** 菜单弹出, **Then** 包含: `查看翻译详情` / `重新翻译` / `删除翻译`。
    *   [ ] **Given** 右键 AI 总结（二级节点）, **When** 菜单弹出, **Then** 包含: `查看总结` / `重新生成` / `导出为 Markdown`。
    *   [ ] **Given** 右键 NotebookLM 产物（二级节点）, **When** 菜单弹出, **Then** 包含: `打开` / `下载` / `删除`。
    *   [ ] **Given** 对应操作条件不满足时, **When** 查看菜单项, **Then** 不可用项灰显。

### US-016: 侧栏搜索与分组筛选 [REQ-016] (优先级: P1)

*   **故事描述**: 作为科研工作者，我想要在文献列表中搜索和按状态筛选。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 侧栏顶部, **When** 查看界面, **Then** 有搜索框（防抖 300ms）。
    *   [ ] **Given** 搜索框下方, **When** 查看界面, **Then** 有分组 Chips 水平排列: `全部` / `已翻译` / `有总结` / `收藏`，点击切换过滤。
    *   [ ] **Given** 用户输入搜索关键词, **When** 过滤完成, **Then** 仅显示标题或文件名匹配的文献。
    *   [ ] **Given** 搜索和分组筛选可叠加使用。

### US-017: 翻译缓存空间管理 [REQ-017] (优先级: P2)

*   **故事描述**: 作为科研工作者，我想要了解翻译缓存占用了多少磁盘空间，以及能够清理缓存。
*   **涉及系统**: `frontend-system`, `rust-backend-system`
*   **验收标准**:
    *   [ ] **Given** 设置页面, **When** 查看存储管理区域, **Then** 显示翻译缓存总大小、AI 总结存储大小。
    *   [ ] **Given** 用户点击"清理所有翻译缓存", **When** 确认, **Then** 删除所有翻译 PDF 文件和数据库记录。

---

## 5. 用户体验与设计 (User Experience)

### 5.1 侧栏树形结构设计

```
┌──────────────────────────────────────────┐
│  🐕 Rastro                    [≡] [⚙]   │
├──────────────────────────────────────────┤
│  [🔍 搜索文献...]                        │
│  [全部] [已翻译] [有总结] [收藏]          │
├──────────────────────────────────────────┤
│                                          │
│  ▼ 📄 Attention Is All You Need          │
│  │     Vaswani et al, 2017 · Zotero      │
│  │     [🌐] [📝] [🧠]                    │
│  │                                       │
│  ├── 📄 原件 PDF                         │
│  ├── 🌐 翻译 PDF (GPT-4o · 03/15)       │
│  ├── 📝 AI 总结 (Claude · 03/15)         │
│  ├── 🧠 思维导图 (NotebookLM)            │
│  └── 🧠 测验 (NotebookLM)               │
│                                          │
│  ▶ 📄 BERT: Pre-training of Deep...      │
│  │     Devlin et al, 2019 · Zotero       │
│  │     [🌐]                              │
│                                          │
│  ▶ 📄 my-local-paper.pdf                 │
│  │     本地 · 03/14                       │
│                                          │
│  ▶ 📄 ViT: An Image is Worth...          │
│  │     Dosovitskiy, 2021 · Zotero        │
│  │     [⟳ 翻译中 45%]                    │
│                                          │
├──────────────────────────────────────────┤
│  [+ 打开本地 PDF]                        │
├──────────────────────────────────────────┤
│  [⚙ 设置]                               │
└──────────────────────────────────────────┘
```

**关键设计要点**:

1. **取消双 Tab** — 本地文档和 Zotero 文档混合在统一树形列表中
2. **一级节点 = 文献** — 显示标题、作者(如有)、来源、状态 icon
3. **二级节点 = 产物** — 展开后显示原件/翻译/总结/NotebookLM 产物
4. **状态 icon 聚合** — 折叠状态也能看到有哪些产物
5. **右键菜单** — 一级节点和二级节点各有不同的操作菜单
6. **默认折叠** — 仅自动展开当前阅读的文献

### 5.2 工具栏翻译切换控件

翻译完成后，在 PDF 工具栏新增区域：
```
... [缩放控件] [页码] │ [原文 ◉ 译文] │ [翻译详情 ⓘ]
```

### 5.3 右键菜单设计

**一级节点(文献)右键菜单**:
```
┌─────────────────────┐
│ 翻译全文             │
│ 生成 AI 总结         │
│ ───────────────────  │
│ ☆ 收藏              │
│ 在 Finder 中显示     │
│ ───────────────────  │
│ 从历史中移除         │
└─────────────────────┘
```

**二级节点(产物)右键菜单** (以翻译 PDF 为例):
```
┌─────────────────────┐
│ 查看翻译详情         │
│ 重新翻译             │
│ ───────────────────  │
│ 删除翻译             │
└─────────────────────┘
```

---

## 6. 新增 IPC 契约变更 (Backend API Changes)

### 6.1 新增 Commands

| Command 名称 | 输入 | 输出 | 说明 |
|:------------|:-----|:-----|:-----|
| `list_document_artifacts` | `{ documentId: string }` | `DocumentArtifactDto[]` | 获取文献下所有产物（翻译/总结/NotebookLM） |
| `delete_translation_cache` | `{ documentId: string }` | `{ deleted: boolean, freedBytes: number }` | 删除翻译产物 |
| `remove_recent_document` | `{ documentId: string }` | `{ removed: boolean }` | 从历史中移除 |
| `get_document_summary` | `{ documentId: string }` | `AISummaryDto \| null` | 获取已保存的 AI 总结 |
| `save_document_summary` | `{ documentId: string, contentMd: string, provider: ProviderId, model: string }` | `AISummaryDto` | 保存 AI 总结 |
| `delete_document_summary` | `{ documentId: string }` | `{ deleted: boolean }` | 删除 AI 总结 |
| `get_cache_stats` | `{}` | `CacheStatsDto` | 缓存空间统计 |
| `clear_all_translation_cache` | `{}` | `{ freedBytes: number }` | 清理所有翻译缓存 |
| `reveal_in_finder` | `{ filePath: string }` | `void` | 在 Finder 中显示文件 |
| `toggle_document_favorite` | `{ documentId: string, favorite: boolean }` | `{ updated: boolean }` | 收藏/取消收藏 |

### 6.2 修改 Commands

| Command 名称 | 变更说明 |
|:------------|:---------|
| `list_recent_documents` | 增加 `query?: string` 和 `filter?: DocumentFilter` 参数 |
| `get_document_snapshot` | 返回值增加 `hasSummary`, `isFavorite`, `artifactCount` 字段 |

### 6.3 新增 DTO 类型

```typescript
/** 文档产物统一 DTO */
interface DocumentArtifactDto {
  artifactId: string;
  documentId: string;
  kind: 'original_pdf' | 'translated_pdf' | 'bilingual_pdf' | 'ai_summary' | 'notebooklm_mindmap' | 'notebooklm_slides' | 'notebooklm_quiz' | 'notebooklm_flashcards' | 'notebooklm_audio' | 'notebooklm_report';
  title: string;              // 显示名称
  filePath?: string;           // 文件路径(如有)
  contentPreview?: string;     // 内容预览(如总结的前100字)
  provider?: ProviderId;       // 生成该产物使用的 AI provider
  model?: string;              // 使用的模型
  fileSize?: number;           // 文件大小(bytes)
  createdAt: string;
  updatedAt: string;
}

/** AI 总结产物 */
interface AISummaryDto {
  summaryId: string;
  documentId: string;
  contentMd: string;
  provider: ProviderId;
  model: string;
  createdAt: string;
  updatedAt: string;
}

/** 文档筛选条件 */
interface DocumentFilter {
  sourceType?: DocumentSourceType;
  hasTranslation?: boolean;
  hasSummary?: boolean;
  isFavorite?: boolean;
}

/** 缓存统计 */
interface CacheStatsDto {
  totalBytes: number;
  translationBytes: number;
  summaryCount: number;
  documentCount: number;
}
```

---

## 7. 数据模型变更

### 7.1 新增表

```sql
-- AI 总结持久化
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

### 7.2 修改 documents 表

```sql
ALTER TABLE documents ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN is_deleted  INTEGER NOT NULL DEFAULT 0;
```

### 7.3 关联 NotebookLM 产物

现有 `notebooklm_artifacts` 表已按 `notebook_id` 组织。需建立 `document_id → notebook_id` 的关联查询，以便 `list_document_artifacts` 能聚合 NotebookLM 产物。

---

## 8. 优先级总览

| 优先级 | 需求 ID | 标题 | 预估工作量 |
|:-----:|:-------:|------|:---------:|
| P0 | REQ-010 | 文献即目录 — 侧栏树形结构 | 大 |
| P0 | REQ-011 | 翻译产物生命周期管理 | 大 |
| P0 | REQ-012 | 翻译 PDF 切换增强 | 小 |
| P0 | REQ-013 | AI 总结持久化管理 | 大 |
| P0 | REQ-014 | 侧栏文档状态可视化 | 中 |
| P1 | REQ-015 | 右键上下文菜单 | 中 |
| P1 | REQ-016 | 侧栏搜索与分组筛选 | 中 |
| P2 | REQ-017 | 翻译缓存空间管理 | 小 |

> **注**: AI 总结持久化(REQ-013)从 P1 提升至 P0，因为树形结构的核心价值要求总结作为产物子项可见。

---

## 9. 与 v1 PRD 的关系

本 PRD 为增量迭代，**不修改** v1 已有需求（US-001 到 US-009）。新增的 US-010 到 US-017 均构建在 v1 已实现功能之上。

---

## 10. 完成标准 (Definition of Done)

*   [ ] P0 需求（REQ-010/011/012/013/014）全部通过验收标准
*   [ ] 侧栏重构为树形结构，展开/折叠流畅
*   [ ] 翻译产物可查看详情、重新翻译、删除
*   [ ] AI 总结持久化保存，在树形视图中作为子项可见
*   [ ] 新增 IPC Commands 有完整的 TypeScript 类型定义和 Rust 实现
*   [ ] 数据库 migration 脚本兼容 v1 数据（不丢失已有缓存和记录）
*   [ ] 虚拟化列表支持树形结构（展开/折叠 + 滚动性能）
