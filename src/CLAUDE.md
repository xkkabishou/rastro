[根目录](../CLAUDE.md) > **src (前端)**

# src - React 前端模块

## 模块职责

基于 React 19 + Vite 7 的单页桌面应用前端，提供 PDF 查看、AI 聊天、文献翻译、Zotero 侧边栏、设置面板等交互界面。通过 Tauri IPC 与 Rust 后端通信。

## 入口与启动

- **入口文件**：`src/main.tsx` -- 创建 React root 并挂载 `<App />`
- **根组件**：`src/App.tsx` -- 渲染 `<AppLayout>` + `<PdfViewer />`
- **Vite 配置**：`vite.config.ts` -- dev server 端口 1420，忽略 src-tauri 目录

## 对外接口

前端不暴露外部 API，所有数据通过 Tauri IPC 获取。

### IPC 客户端 (`src/lib/ipc-client.ts`)

类型安全的 Tauri Command 封装层，导出两个对象：

- `ipcClient`：25 个 Command 的类型安全调用方法
- `ipcEvents`：6 个 Event 的监听封装（AI 流、翻译进度）

### 类型定义 (`src/shared/types.ts`)

IPC 契约的 TypeScript 权威源，定义：
- 所有 DTO 接口（DocumentSnapshot, TranslationJobDto, ChatSessionDto 等）
- 枚举类型（ProviderId, TranslationJobStatus, AppErrorCode 等）
- Command 名称常量 `IPC_COMMANDS`（27 个）
- Event 名称常量 `IPC_EVENTS`（6 个）

## 关键依赖与配置

| 依赖 | 版本 | 用途 |
|------|------|------|
| react / react-dom | 19.2 | UI 框架 |
| @tauri-apps/api | 2.10 | Tauri IPC 通信 |
| zustand | 5.0 | 状态管理 |
| pdfjs-dist | 5.5 | PDF 渲染 |
| @radix-ui/themes | 3.3 | UI 组件库 |
| tailwindcss | 4.2 | 样式 |
| lucide-react | 0.577 | 图标 |
| react-markdown | 10.1 | Markdown 渲染（聊天消息） |
| framer-motion | 12.35 | 动画 |
| @tanstack/react-virtual | 3.13 | 虚拟滚动 |

## 数据模型

前端状态通过 Zustand store 管理：

### `useDocumentStore` (`src/stores/useDocumentStore.ts`)
- `currentDocument`：当前打开的文档快照
- `zoomLevel`：PDF 缩放级别 (25-400)
- `bilingualMode`：双语模式开关
- `translationJob` / `translationProgress`：翻译任务状态
- `pdfUrl` / `translatedPdfUrl`：PDF 文件 URL

### `useChatStore` (`src/stores/useChatStore.ts`)
- `activeSessionId` / `sessions` / `messages`：聊天会话与消息
- `isStreaming` / `activeStreamId`：流式响应状态
- 流式操作：`startAssistantStream` / `appendStreamChunk` / `finishStream` / `failStream`

## 组件结构

```
src/
  App.tsx                          # 根组件
  main.tsx                         # React 入口
  layouts/
    AppLayout.tsx                  # 三栏布局（侧边栏 + PDF + 右侧面板），响应式
  components/
    pdf-viewer/
      PdfViewer.tsx                # PDF 渲染组件（pdfjs-dist）
      PdfToolbar.tsx               # PDF 工具栏（缩放、页码等）
      TranslationSwitch.tsx        # 翻译状态悬浮组件
    sidebar/
      Sidebar.tsx                  # 左侧边栏（文档列表入口）
      ZoteroList.tsx               # Zotero 文献列表
    chat-panel/
      ChatPanel.tsx                # AI 聊天面板
      ChatInput.tsx                # 聊天输入框
      ChatMessage.tsx              # 单条聊天消息
    panel/
      RightPanel.tsx               # 右侧面板容器（Chat/Settings/Summary 切换）
    settings/
      SettingsPanel.tsx            # 设置面板
      ProviderCard.tsx             # Provider 配置卡片
      ModelSettings.tsx            # 模型选择设置
    summary/
      SummaryPanel.tsx             # 文献总结面板
    setup/
      SetupWizard.tsx              # 初始设置向导
    notebooklm/
      NotebookLMView.tsx           # NotebookLM 视图
    ui/
      Button.tsx / Card.tsx / Dialog.tsx / Input.tsx  # 通用 UI 原子组件
  lib/
    ipc-client.ts                  # IPC 客户端封装
    notebooklm-automation.ts       # NotebookLM 自动化工具
  shared/
    types.ts                       # IPC 契约类型定义
  stores/
    useDocumentStore.ts            # 文档状态 store
    useChatStore.ts                # 聊天状态 store
  styles/
    globals.css                    # 全局样式（CSS 变量、Tailwind）
```

## 测试与质量

- 目前无前端测试
- TypeScript 严格模式 (`strict: true`)
- 缺口：无单元测试、无 E2E 测试

## 常见问题 (FAQ)

**Q: 前端如何与 Rust 后端通信？**
A: 通过 `@tauri-apps/api` 的 `invoke` 和 `listen` 方法，封装在 `src/lib/ipc-client.ts` 中。

**Q: PDF 如何渲染？**
A: 使用 `pdfjs-dist` 库，在 `PdfViewer.tsx` 中实现 canvas 渲染 + text layer。

**Q: 聊天的流式响应如何处理？**
A: Rust 端通过 Tauri Event (`ai://stream-chunk`) 推送增量文本，前端通过 `ipcEvents.onAiStreamChunk` 监听并更新 `useChatStore`。

## 相关文件清单

- `src/main.tsx` -- React 入口
- `src/App.tsx` -- 根组件
- `src/shared/types.ts` -- IPC 契约类型（574 行）
- `src/lib/ipc-client.ts` -- IPC 客户端封装（241 行）
- `src/stores/useDocumentStore.ts` -- 文档状态
- `src/stores/useChatStore.ts` -- 聊天状态
- `src/layouts/AppLayout.tsx` -- 三栏布局
- `src/styles/globals.css` -- 全局样式
- `package.json` -- 前端依赖
- `tsconfig.json` -- TypeScript 配置
- `vite.config.ts` -- Vite 构建配置
- `tailwind.config.js` -- Tailwind 配置
- `postcss.config.js` -- PostCSS 配置

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-03-12 | 初始化 | 首次扫描生成 |
