# ADR-003: 文档工作空间架构 (Document Workspace Architecture)

**状态**: Accepted
**日期**: 2026-03-16
**决策者**: Genesis Agent + 用户

---

## 上下文 (Context)

Rastro v1 的侧栏采用"近期文档 / Zotero"双 Tab + 扁平列表设计。v2 需要重构为 **Zotero 式树形结构**，其中每篇文献是一个可展开的"工作空间"目录，包含：
- 原件 PDF
- 翻译 PDF（若已翻译）
- AI 总结（若已生成）
- NotebookLM 产物（若已生成，可能多个）

这涉及两个关键架构决策：
1. **统一产物模型** — 如何将散落在不同模块的产物（翻译/总结/NotebookLM）统一建模
2. **树形视图虚拟化** — 如何在保持展开/折叠交互的同时维持列表性能

---

## 决策 (Decision)

### 1. 统一产物模型：`DocumentArtifactDto` 聚合查询

**方案**: 不改变底层存储结构（翻译/总结/NotebookLM 各自的表），而是新增一个**聚合查询层** `list_document_artifacts(documentId)` IPC Command，在 Rust 后端将多个数据源的产物聚合为统一的 `DocumentArtifactDto[]`。

```
┌─ translation_jobs 表 ──────┐
│  (已有，翻译 PDF 路径/元数据) │──┐
└────────────────────────────┘  │
                                │   list_document_artifacts()
┌─ document_summaries 表 ────┐  │──▶ DocumentArtifactDto[]
│  (新增，AI 总结 Markdown)   │──┤
└────────────────────────────┘  │
                                │
┌─ notebooklm_artifacts 表 ──┐  │
│  (已有，NotebookLM 产物)    │──┘
└────────────────────────────┘
```

**理由**:
- ✅ 最小改动：不需要合并现有数据表，降低 migration 风险
- ✅ 各子系统保持独立演进能力
- ✅ 前端只关心统一的 `DocumentArtifactDto`，不需要知道底层存储差异
- ❌ 每次展开需要跨 3 张表查询（但数据量小，可接受）

**替代方案被否决**:
- 创建统一 `document_artifacts` 表 → 数据冗余，需要在翻译/总结/NotebookLM 完成时双写
- 仅在前端聚合（多次 IPC 调用）→ 网络开销大，逻辑分散

### 2. 树形视图虚拟化：`@tanstack/react-virtual` + 扁平化计算

**方案**: 将树形结构在渲染前扁平化为一维数组（只包含当前可见的节点），然后使用已有的 `@tanstack/react-virtual` 进行虚拟化。

```typescript
// 概念示意
type FlatNode = 
  | { type: 'document'; doc: DocumentSnapshot; expanded: boolean; artifactCount: number }
  | { type: 'artifact'; artifact: DocumentArtifactDto; parentDocId: string };

// 扁平化：遍历文档列表，展开的文档插入其产物子节点
const flatNodes: FlatNode[] = documents.flatMap(doc => {
  const docNode = { type: 'document', doc, expanded, artifactCount };
  if (!expanded) return [docNode];
  return [docNode, ...artifacts.map(a => ({ type: 'artifact', artifact: a, parentDocId: doc.documentId }))];
});
```

**理由**:
- ✅ 复用已有依赖 `@tanstack/react-virtual`（v1 ZoteroList 已使用）
- ✅ 扁平化后的虚拟化性能与普通列表一致
- ✅ 展开/折叠只需重新计算 flatNodes 数组
- ❌ 需要手工管理展开状态和缩进级别

### 3. 侧栏合并策略：统一列表取代双 Tab

**方案**: 取消 v1 的"近期文档 / Zotero"双 Tab 设计，合并为统一列表。通过以下方式区分来源：
- 每个文献条目显示来源标签（`本地` / `Zotero`）
- 分组 Chips 支持按来源筛选

**理由**:
- ✅ 消除"同一文献在两个 Tab 中都出现"的困惑
- ✅ 用户反馈：想要统一视图

---

## 影响 (Consequences)

### 正面
- 用户获得 Zotero 式的层级组织体验
- 文献的所有产物在一处可见
- 翻译/总结/NotebookLM 产物获得完整的生命周期管理

### 负面
- 侧栏组件需要从头重写（Sidebar.tsx + ZoteroList.tsx → 新的 DocumentTree.tsx）
- 后端需新增 ~10 个 IPC Commands
- 虚拟化树形列表的实现复杂度高于扁平列表

### 风险
- 跨 3 张表的聚合查询性能 → 缓解：本地 SQLite，数据量 < 1000 条，查询 < 10ms
- 展开/折叠状态管理复杂度 → 缓解：Zustand store 统一管理
