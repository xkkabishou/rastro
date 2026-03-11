# ADR-002: 多模型协作开发策略

## 状态
Accepted

## 背景

Rasto 由多个 AI 模型协作开发：Claude + Gemini 做前端，Codex 做后端。需要明确执行顺序和职责分配，确保并行开发不冲突。

---

## 决策：后端优先 + 接口契约驱动

先由 Claude 定义 Tauri IPC 接口契约（Wave 0），再由 Codex 和 Claude+Gemini **并行开发** 后端和前端。

---

## 执行波次 (Execution Waves)

| 波次 | 任务 | 负责模型 | 依赖 | 产出 |
|:---:|------|:--------:|:---:|------|
| **Wave 0** | 定义 Tauri IPC Command 接口契约 | **Claude** | 无 | `types.ts` + Rust Command traits |
| **Wave 1a** | Rust 后端骨架 + SQLite + Keychain + AI API | **Codex** | Wave 0 | `src-tauri/` 核心模块 |
| **Wave 1b** | React 前端骨架 + PDF 渲染 + UI 框架 | **Claude + Gemini** | Wave 0 | `src/` 前端项目 |
| **Wave 2a** | PDFMathTranslate 进程管理 + 翻译编排 | **Codex** | Wave 1a | 翻译功能后端 |
| **Wave 2b** | 聊天面板 + 翻译展示 + 设置页 | **Claude + Gemini** | Wave 1b | 功能页面 |
| **Wave 3** | NotebookLM WebView 自动化 | **Claude** | Wave 2b | NotebookLM 集成 |
| **Wave 4** | Zotero 集成 + 缓存 + API 统计 | **Codex** | Wave 2a | P1/P2 功能 |
| **Wave 5** | 集成联调 + Bug 修复 | **Claude** | All | 可运行 App |

> **关键**：Wave 1a 和 1b **并行执行**，互不阻塞。

---

## 模型职责矩阵

| 模型 | 负责系统 | 核心职责 | 使用 Skills |
|------|---------|---------|------------|
| **Claude** | 全局 + frontend-system | 架构设计、IPC 契约、前端 UI、NotebookLM、联调 | frontend-design, ui-ux-pro-max |
| **Gemini** | frontend-system | UI 组件、样式、动效、辅助开发 | frontend-design, ui-ux-pro-max |
| **Codex** | rust-backend-system | Rust 后端、AI API 客户端、进程管理、存储 | — |

---

## 并行规则

1. **Wave 0 是硬依赖**：必须先完成接口契约，后续波次才能启动
2. **Wave 1a ∥ 1b**：后端和前端可同时开发
3. **Wave 2a ∥ 2b**：功能开发可同时推进
4. **Wave 3-4 可并行**：NotebookLM 和 Zotero 无依赖关系
5. **Wave 5 串行**：联调必须在所有功能完成后
