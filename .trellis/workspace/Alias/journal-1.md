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


## Session 2: PDF 标注消失 bug 路线 X 重构 + CLAUDE.md 精简

**Date**: 2026-04-14
**Task**: PDF 标注消失 bug 路线 X 重构 + CLAUDE.md 精简

### Summary

(Add summary)

### Main Changes

## 涉及改动

| 类别 | 描述 |
|-----|------|
| Bug 修复 | PDF 缩放/侧栏 resize 后标注消失（已人工测试通过） |
| 文档精简 | CLAUDE.md -551 行，编码细节下沉到 .trellis/spec/ |
| Spec 新增 | `react-pitfalls.md` 新增「createPortal into Third-Party Managed DOM」一节（未追踪，已本地写入） |

## Bug 根因与路线 X 方案

**根因**：pdfjs 5.5 的 `PDFPageView.reset()` 在 scale 变化时硬编码白名单，`node.remove()` 掉 `.page` 下所有非白名单子节点。原 `createPortal(AnnotationOverlay, pageEl)` 方案被整层扫掉，React unmount 时 removeChild 找不到节点抛 DOMException，触发 ErrorBoundary 白屏。

**路线 X 方案**：把 AnnotationOverlay 从 Portal 挂载改为 `viewerContainerRef`（滚动容器）内的兄弟节点，绝对定位跟随 `.page` 的 `getBoundingClientRect`。pdfjs 完全碰不到覆盖层 DOM。

**关键实现点**：
- 位置换算：`pageBox.top - parentBox.top + parentEl.scrollTop`，同时抵消滚动偏移与 `.pdfViewer` 的 `margin-inline: auto` 居中
- 布局同步三触发源：`scalechanging`（最早信号防闪烁）/ `pagerendered`（canvas 重绘完）/ `ResizeObserver(viewerRef)`（字体加载兜底）
- 单纯每页 ResizeObserver 不够——第 N 页 resize 时 N+1 之后的 sibling 的 observer 不会触发，必须用 parent 级 `layoutVersion` 广播

## Updated Files

**路线 X (df1e657)**
- `src/components/pdf-viewer/AnnotationOverlay.tsx` — 新增 pageEl/parentEl/layoutVersion props；useLayoutEffect 相对 parentEl 同步 rect；calcAnchor 的 closest('.page') 改为 closest('[data-annotation-overlay]')
- `src/components/pdf-viewer/PdfViewer.tsx` — 新增 layoutVersion state + 三触发源；JSX 去掉 createPortal 改为兄弟节点；移除 createPortal import

**CLAUDE.md 精简 (7cccc56)**
- `CLAUDE.md` — 移除技术栈/毛玻璃细则/图标设计语言等大段内容，保留模块/业务/命名约定/AI 使用指引，补充 .trellis/spec/ 引用指针

## 后续待办

- `.trellis/spec/frontend/react-pitfalls.md` 的「Portal into Third-Party Managed DOM」一节已写入但目录未追踪，笨蛋的 Trellis spec 策略决定后再处理
- CLAUDE.md 精简后留下 `.trellis/spec/...` 引用路径，依赖 spec 目录的可访问性

## 顺带发现（未修，记录备忘）

记忆文件 `known-bugs.md` 已把路线 X 标为「已实施并人工测试通过」，移除"待验证"标记


### Git Commits

| Hash | Message |
|------|---------|
| `df1e657` | (see git log) |
| `7cccc56` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
