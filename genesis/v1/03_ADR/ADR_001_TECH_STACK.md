# ADR-001: Rasto 技术栈选择

## 状态
Accepted

## 背景

Rasto 是一款面向中国科研工作者的 macOS 桌面端 AI 学术文献阅读器。核心功能包括：PDF 全文翻译（含图表、布局保留）、AI 问答、AI 总结、NotebookLM Studio 一键生成、Zotero 集成。首发 macOS，后期支持 Windows。

### 关键约束
- **跨平台需求**: macOS 首发，后期 Windows
- **翻译引擎**: 集成 PDFMathTranslate（Python），需要本地 Python 环境
- **AI 依赖**: OpenAI / Claude / Gemini API，通过 HTTP 调用
- **NotebookLM**: 通过内嵌 WebView + JS 注入自动化
- **开发模式**: 多 AI Agent 协作（Claude+Gemini 做前端，Codex 做后端）
- **设计风格**: Apple HIG 苹果风

---

## 决策

### 桌面框架：Tauri 2.0

**选择 Tauri 2.0 (Rust + Web 前端)**，放弃 SwiftUI 和 Electron。

### 前端框架：React + TypeScript

**选择 React 18 + TypeScript**，使用 Vite 作为构建工具。

### PDF 渲染：pdf.js

**选择 Mozilla pdf.js** 作为 PDF 渲染引擎。

### PDF 翻译引擎：PDFMathTranslate

**集成 PDFMathTranslate**（Python 本地服务），通过 HTTP API 调用。

### 本地存储：SQLite (via rusqlite)

**选择 SQLite** 存储对话历史、翻译缓存索引、API 使用统计。

### API Key 安全：macOS Keychain (via keytar-rs)

**选择 macOS Keychain** 存储敏感信息。

### 前端设计工具：Agent Skills

**使用 `frontend-design` + `ui-ux-pro-max` 两个 Agent Skill** 指导前端 UI/UX 设计：
- **frontend-design**（Anthropic 官方）：避免 "AI slop" 风格，强制选择大胆的美学方向（字体、色彩、动效、构图），产出有辨识度的界面。
- **ui-ux-pro-max**（nextlevelbuilder）：包含 50+ 风格、161 色板、57 字体搭配、99 条 UX 准则、25 种图表类型，跨 10 个技术栈的设计智能。
- 已安装至 `.agent/skills/frontend-design/` 和 `.agent/skills/ui-ux-pro-max/`。

---

## 候选方案对比

### 桌面框架

| 维度 | Tauri 2.0 ⭐ | SwiftUI | Electron |
|------|:---:|:---:|:---:|
| 需求匹配 (×5) | 5 | 4 | 5 |
| 跨平台 (×5) | 5 | 1 | 5 |
| 性能 (×4) | 5 | 5 | 2 |
| 安全性 (×4) | 4 | 5 | 3 |
| 团队技能 (×5) | 4 | 2 | 4 |
| 开发速度 (×4) | 4 | 3 | 5 |
| 打包体积 (×3) | 5 | 5 | 1 |
| 社区生态 (×3) | 4 | 3 | 5 |
| AI Agent 友好 (×3) | 5 | 3 | 5 |
| **加权总分** | **164** | **116** | **137** |

### 前端框架

| 维度 | React ⭐ | Vue 3 | Svelte |
|------|:---:|:---:|:---:|
| 生态丰富度 | 5 | 4 | 3 |
| AI Agent 代码生成质量 | 5 | 4 | 3 |
| Tauri 集成案例 | 5 | 4 | 3 |
| 组件库选择 | 5 | 4 | 2 |
| **综合评分** | **20/20** | **16/20** | **11/20** |

---

## 权衡点

### 1. Tauri vs SwiftUI
- **权衡**: Tauri 牺牲部分 macOS 原生感（可通过 CSS 模拟），换取跨平台能力
- **决定因素**: 用户明确要求后期支持 Windows，SwiftUI 无法满足

### 2. Python 依赖（PDFMathTranslate）
- **权衡**: 引入 Python 依赖增加安装复杂度，但获得论文级翻译质量
- **缓解措施**: 
  - 首次启动时自动检测/引导安装 Python 环境
  - 后期可考虑通过 PyInstaller 打包为独立可执行文件
  - Docker 方案作为 fallback

### 3. React vs Vue
- **权衡**: Vue 学习曲线更低，但 React 生态更丰富
- **决定因素**: AI Agent（Claude/Gemini/Codex）对 React 代码生成质量更高，且 Tauri + React 模板和案例最多

### 4. 内嵌 WebView 自动化 NotebookLM vs 外部浏览器
- **权衡**: 内嵌 WebView 体验更一体化，但自动化脚本可能因 Google UI 变更失效
- **缓解措施**: 模块化自动化逻辑，便于快速适配 UI 变更

---

## 后果

### 正面
- 打包后 App < 50MB（不含 Python），用户体验轻量
- 同一套代码后期支持 Windows，开发成本可控
- PDFMathTranslate 提供学术级翻译质量（EMNLP 2025 论文级）
- React + TypeScript 对多 AI Agent 协作开发友好（代码规范、类型安全）

### 负面
- 用户需要安装 Python 3.12 环境（增加首次使用门槛）
- macOS 原生感不如 SwiftUI（需通过 CSS 精心模拟）
- NotebookLM WebView 自动化存在维护成本

### 需要的后续行动
- 调研 PDFMathTranslate 的 HTTP API 接口文档
- 设计 Python 环境自动检测和安装引导流程
- 选择 macOS 风格的 React 组件库（如 macOS UI Kit / Radix UI）
- 定义 Tauri IPC Command 接口契约（前后端 API 边界）

---

## 技术栈总览

```
┌─────────────────────────────────────────────────┐
│                  Rasto App                       │
├─────────────────────────────────────────────────┤
│  前端 (WebView)                                  │
│  ├── React 18 + TypeScript                      │
│  ├── pdf.js (PDF 渲染)                           │
│  ├── NotebookLM WebView (内嵌自动化)              │
│  └── Vite (构建工具)                              │
├─────────────────────────────────────────────────┤
│  Tauri IPC 层 (invoke commands)                  │
├─────────────────────────────────────────────────┤
│  后端 (Rust)                                     │
│  ├── AI API 客户端 (OpenAI/Claude/Gemini)        │
│  ├── PDFMathTranslate 进程管理                    │
│  ├── SQLite 存储 (对话/缓存/统计)                 │
│  ├── macOS Keychain (API Key 安全)               │
│  └── Zotero SQLite 读取                          │
├─────────────────────────────────────────────────┤
│  外部服务                                        │
│  ├── PDFMathTranslate (Python 本地服务)           │
│  ├── NotebookLM (Google WebView)                │
│  └── AI APIs (OpenAI / Claude / Gemini)          │
└─────────────────────────────────────────────────┘
```
