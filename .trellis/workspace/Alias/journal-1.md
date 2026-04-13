# Journal - Alias (Part 1)

> AI development session journal
> Started: 2026-04-12

---



## Session 1: 修复原文 PDF 视图残留翻译件 + 补齐 Zotero 产物右键菜单接线

**Date**: 2026-04-14
**Task**: 修复原文 PDF 视图残留翻译件 + 补齐 Zotero 产物右键菜单接线

### Summary

(Add summary)

### Main Changes

## 涉及 Bug

| Bug | 现象 | 状态 |
|-----|------|------|
| Bug 1 | 点击"原文 PDF"产物加载的却是翻译件，先报错弹重试按钮、点重试反而显示翻译件 | 已修复并测试通过 |
| Bug 2（接线层） | Zotero tab 下产物节点（含 ai 总结）右键无菜单 | 接线已修，菜单内容待新会话调整 |

## Bug 1 根因与修复

**根因链**：
- `PdfViewer.tsx:385-386` 的 `activePdfUrl` 公式：`translatedPdfUrl && !bilingualMode ? translatedPdfUrl : sourcePdfUrl`
- `PdfViewer.tsx:849-856` 有一个 effect，每次 `currentDocumentId` / `cachedTranslatedPdfPath` / `cachedBilingualPdfPath` 变化都用 `resolveTranslatedPdfUrl(cachedTranslation)` 覆盖 `translatedPdfUrl`
- Sidebar/ZoteroList 的 `case 'original_pdf'` 事前清零 `translatedPdfUrl` 后，该 effect 在同一轮 render 结束又把缓存翻译 URL 写回来
- "重试"按钮来自 `ErrorBoundary`，点击后仅清除错误态，`translatedPdfUrl` 依旧指向翻译件

**修复策略**：
- 职责重构：删除 `PdfViewer` 的自动恢复 effect；把"打开文档时默认加载缓存翻译"下沉到 `useDocumentStore.setCurrentDocument` 的"不同文档"分支
- 调用顺序调整：`case 'original_pdf'` 改为"先 openDocumentInViewer 后显式清零"，利用 React 批处理让 `null` 胜出

## Bug 2 接线层修复

- 背景：`DocumentTree`（documents tab）已用 `DocumentContextMenu` 包裹产物节点；但 `ZoteroList`（zotero tab）的产物 `<button>` 只有 onClick，缺 onContextMenu
- 在 `DocumentContextMenu.tsx` 新增 export `ArtifactMenu` 组件（镜像 `DocumentMenu`，内部调用既有 `buildArtifactMenuItems`）
- `ZoteroList.tsx` 新增 `artifactMenuState` + `handleArtifactContextMenu`，透传到 `CollectionNode` → `ItemFolder` → 产物 `<button>`，绑定 `onContextMenu`，底部渲染 `<ArtifactMenu>`
- action 回调复用既有 `onDocumentContextMenuAction`，因为 `view_summary` / `regenerate_summary` / `export_summary_md` 等在 Sidebar.handleContextMenuAction 里只依赖 `doc`，不需要 artifact 上下文

## 后续待办

- ai_summary 菜单项内容（当前「查看总结 / 重新生成 / 导出为 Markdown」3 项）用户不满意，下次会话调整
- 下次调整入口：
  - `src/components/sidebar/DocumentContextMenu.tsx:122-130`（`buildArtifactMenuItems` 的 `ai_summary` 分支）
  - `src/components/sidebar/Sidebar.tsx` 的 `handleContextMenuAction` 相应 case

## 顺带发现（未修，记录备忘）

| 问题 | 位置 | 风险 |
|------|------|------|
| 拖拽监听器双重注册 | `PdfViewer.tsx:447-469` 和 `usePdfDragDrop.ts:47-68` 各自 `onDragDropEvent` | 一次拖拽触发两次 openDocument + setCurrentDocument，操作幂等无功能缺陷，但浪费一轮渲染 |
| ZoteroList 翻译分支缺 isSameDoc 判断 | `ZoteroList.tsx:293-306` | 同文档切换翻译视图时 `activePdfUrl` 经历"翻译→原文→新翻译"三次变化闪烁（体验问题，不影响功能）|

## 更新的文件

- `src/stores/useDocumentStore.ts` — 新增 `resolveCachedTranslationUrl` helper；setCurrentDocument 不同文档分支根据 cachedTranslation 自动恢复翻译视图
- `src/components/pdf-viewer/PdfViewer.tsx` — 删除冗余的自动恢复 effect，清理仅此处使用的 `cachedTranslatedPdfPath/cachedBilingualPdfPath` 局部变量
- `src/components/sidebar/Sidebar.tsx` — `case 'original_pdf'` 调整顺序为"先打开后清零"
- `src/components/sidebar/ZoteroList.tsx` — `case 'original_pdf'` 同步调整 + 新增产物右键菜单接线（state + handler + props 透传 + button onContextMenu + ArtifactMenu 渲染）
- `src/components/sidebar/DocumentContextMenu.tsx` — 新增 export `ArtifactMenu` 组件


### Git Commits

| Hash | Message |
|------|---------|
| `e0433bd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
