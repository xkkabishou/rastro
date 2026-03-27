<p align="center">
  <img src="docs/banner.png?v=2" alt="Rastro Banner" width="720" />
</p>

<h1 align="center">Rastro</h1>

<p align="center">
  <strong>AI 驱动的科研文献阅读助手</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#许可证">许可证</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust 2021" />
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple" alt="macOS" />
</p>

---

## 功能特性

### 📄 PDF 阅读器
- 高性能 PDF 渲染（基于 pdf.js）
- 文本选择与高亮标注
- 页面缩略图导航
- 双栏翻译对照阅读

### 🤖 AI 智能助手
- 多模型支持（OpenAI、DeepSeek、Gemini 等）
- 流式对话，上下文感知
- 一键生成文献摘要
- **精读模式**：提取全文文本注入 AI 上下文，实现深度问答

### 🌐 全文翻译
- 段落级 PDF 翻译，保留原文对照
- 翻译缓存，避免重复消耗
- 多翻译引擎可选

### 📚 Zotero 集成
- 自动检测本地 Zotero 文献库
- 按合集浏览、搜索文献
- 直接打开 Zotero 中的 PDF 附件
- 标题自动翻译缓存

### 📝 标注系统
- PDF 高亮标注
- 标注持久化存储（SQLite）
- 按页面筛选标注

### 🔗 Obsidian 笔记同步
- 自动检测 Obsidian Vault
- 导出摘要/对话到 Obsidian
- 自定义导出模板

### 🧪 NotebookLM 集成
- 创建/管理 Notebook
- 附加当前 PDF 到 Notebook
- 生成 AI 制品（摘要、FAQ 等）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | [Tauri v2](https://tauri.app/) |
| **前端** | React 19 + TypeScript + Tailwind CSS v4 |
| **UI 组件** | Radix UI Themes + Lucide Icons + Framer Motion |
| **状态管理** | Zustand |
| **PDF 渲染** | pdf.js |
| **后端** | Rust (2021 Edition) |
| **数据库** | SQLite (rusqlite) |
| **HTTP 客户端** | reqwest (rustls) |
| **密钥管理** | macOS Keychain (security-framework) |
| **异步运行时** | Tokio |

---

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://www.rust-lang.org/tools/install) ≥ 1.70
- [Tauri CLI v2](https://tauri.app/start/)
- macOS（当前仅支持 macOS）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/xkkabishou/rastro.git
cd rastro

# 安装前端依赖
npm install

# 启动开发模式
npm run tauri dev
```

### 构建发布版本

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

---

## 项目结构

```
rastro/
├── src/                        # 前端源码 (React + TypeScript)
│   ├── components/
│   │   ├── pdf-viewer/         # PDF 阅读器组件
│   │   ├── chat-panel/         # AI 对话面板
│   │   ├── sidebar/            # 侧边栏（Zotero 文献列表等）
│   │   ├── annotations/        # 标注系统
│   │   ├── settings/           # 设置面板
│   │   ├── summary/            # 摘要组件
│   │   └── ui/                 # 通用 UI 组件
│   ├── stores/                 # Zustand 状态管理
│   ├── lib/                    # 工具函数与 IPC 客户端
│   └── layouts/                # 布局组件
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── ipc/                # IPC 命令处理（60+ 个命令）
│   │   ├── ai_integration/     # AI 模型对接
│   │   ├── translation_manager/# 翻译引擎管理
│   │   ├── zotero_connector/   # Zotero 本地库连接
│   │   ├── storage/            # SQLite 数据层
│   │   ├── keychain/           # macOS 密钥链
│   │   └── models.rs           # 数据模型
│   └── Cargo.toml
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## 开发指南

### 常用命令

```bash
npm run dev          # 启动 Vite 开发服务器
npm run tauri dev    # 启动 Tauri 开发模式（含热重载）
npm run tauri build  # 构建生产版本
npm run test         # 运行前端测试 (Vitest)
```

### IPC 架构

前后端通过 Tauri IPC 通信，后端注册了 **60+ 个命令**，覆盖：

- 文档管理（8 个）
- 翻译引擎生命周期与任务（9 个）
- AI 问答与摘要（8 个）
- Provider 配置（7 个）
- Zotero 集成（7 个）
- NotebookLM 集成（11 个）
- 标注系统（5 个）
- 精读模式（3 个）
- 更多...

---

## 许可证

[ISC](LICENSE)

---

<p align="center">
  Made with ❤️ for researchers
</p>
