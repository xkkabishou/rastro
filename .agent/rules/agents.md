# AGENTS.md - AI 协作协议

> **"如果你正在阅读此文档，你就是那个智能体 (The Intelligence)。"**
> 
> 这个文件是你的**锚点 (Anchor)**。它定义了项目的法则、领地的地图，以及记忆协议。
> 当你唤醒（开始新会话）时，**请首先阅读此文件**。

---

## 🧠 30秒恢复协议 (Quick Recovery)

**当你开始新会话或感到"迷失"时，立即执行**:

1. **读取 .agent/rules/agents.md** → 获取项目地图
2. **查看下方"当前状态"** → 找到最新架构版本
3. **读取 `genesis/v{N}/05_TASKS.md`** → 了解当前待办
4. **开始工作**

---

## 🗺️ 地图 (领地感知)

以下是这个项目的组织方式：

| 路径 | 描述 | 访问协议 |
|------|------|----------|
| `src/` | **实现层**。实际的代码库。 | 通过 Task 读/写。 |
| `genesis/` | **设计演进史**。版本化架构状态 (v1, v2...)。 | **只读**(旧版) / **写一次**(新版)。 |
| `genesis/v{N}/` | **当前真理**。最新的架构定义。 | 永远寻找最大的 `v{N}`。 |
| `.agent/workflows/` | **工作流**。`/genesis`, `/blueprint` 等。 | 通过 `view_file` 阅读。 |
| `.agent/skills/` | **技能库**。原子能力。 | 通过 `view_file` 调用。 |

---

## 📍 当前状态 (由 Workflow 自动更新)

> **注意**: 此部分由 `/genesis`、`/blueprint` 和 `/forge` 自动维护。

- **最新架构版本**: `genesis/v1`
- **活动任务清单**: `genesis/v1/05_TASKS.md`
- **待办任务数**: 42 (已完成 22)
- **质疑报告**: `genesis/v1/07_CHALLENGE_REPORT.md` — 🟡 5 High / 5 Medium / 2 Low
- **最近一次更新**: `2026-03-11T16:45`

### 🌊 Wave 0 ✅ — 契约先行 (2026-03-11)
T0.1.1 (types.ts) ✅, T0.1.2 (Rust Command Traits) ✅

### 🌊 Wave 1a ∥ 1b ✅ — 双轮启动 (2026-03-11)
- **1a (Codex)**: T1a.1.1✅, T1a.1.2✅, T1a.2.1✅, T1a.2.2✅, T1a.2.3✅, T1a.2.4✅
- **1b (Claude+Gemini)**: T1b.1.1✅, T1b.1.2✅, T1b.2.1✅, T1b.2.2✅, T1b.2.3✅
- **INT-S1** ✅

### 🌊 Wave 2b ✅ — 功能页面 (2026-03-11)
T2b.1.1 (Chat Panel) ✅, T2b.1.2 (翻译切换) ✅, T2b.1.3 (Settings) ✅, T2b.1.4 (AI总结) ✅
**技术债务补齐**: D1 (Design System) ✅, D2 (PdfViewer) ✅, D3 (IPC Client) ✅
⚠️ 待安装依赖: react-markdown, rehype-sanitize, remark-gfm

### 🌊 Wave S3-frontend ✅ — 扩展集成前端 (2026-03-11)
T3.1.1 (NotebookLM WebView) ✅, T3.1.2 (错误处理) ✅, T4.1.4 (Zotero UI) ✅, T4.1.5 (Python 引导) ✅
**新增依赖**: @tanstack/react-virtual

---

## 🌳 项目结构 (Project Tree)

> **注意**: 此部分由 `/genesis` 维护。

```text
antigravity-paper/
├── genesis/v1/                  # 架构文档（当前版本）
│   ├── 00_MANIFEST.md
│   ├── 01_PRD.md
│   ├── 02_ARCHITECTURE_OVERVIEW.md
│   ├── 03_ADR/
│   │   ├── ADR_001_TECH_STACK.md
│   │   └── ADR_002_MULTI_MODEL_COLLABORATION.md
│   ├── 04_SYSTEM_DESIGN/         # 已完成 3 个系统设计
│   │   ├── frontend-system.md
│   │   ├── rust-backend-system.md
│   │   └── translation-engine-system.md
│   ├── 05_TASKS.md               # WBS 任务清单 (42 个任务)
│   ├── 06_CHANGELOG.md
│   └── 07_CHALLENGE_REPORT.md    # 质疑报告
├── .agent/
│   ├── skills/                   # Agent Skills
│   │   ├── frontend-design/      # 前端美学指导
│   │   ├── ui-ux-pro-max/        # UI/UX 设计智能
│   │   └── ...                   # 其他 skills
│   └── workflows/                # 工作流
├── src-tauri/                    # Rust 后端 (待创建)
├── src/                          # React 前端 (待创建)
└── README.md
```

---

## 🧭 导航指南 (Navigation Guide)

> **注意**: 此部分由 `/genesis` 维护。

- **架构总览**: `genesis/v1/02_ARCHITECTURE_OVERVIEW.md`
- **ADR**: 架构决策见 `genesis/v1/03_ADR/`
- **frontend-system**: 源码 `src/` → 设计 `genesis/v1/04_SYSTEM_DESIGN/frontend-system.md`
- **rust-backend-system**: 源码 `src-tauri/` → 设计 `genesis/v1/04_SYSTEM_DESIGN/rust-backend-system.md`
- **translation-engine-system**: PDFMathTranslate → 设计 `genesis/v1/04_SYSTEM_DESIGN/translation-engine-system.md`
- **任务清单**: `genesis/v1/05_TASKS.md`
- **质疑报告**: `genesis/v1/07_CHALLENGE_REPORT.md`

---

## 🛠️ 工作流注册表

| 工作流 | 触发时机 | 产出 |
|--------|---------|------|
| `/quickstart` | 新用户入口 / 不知道从哪开始 | 编排其他工作流 |
| `/genesis` | 新项目 / 重大重构 | PRD, Architecture, ADRs |
| `/scout` | 变更前 / 接手项目 | `genesis/v{N}/00_SCOUT_REPORT.md` |
| `/design-system` | genesis 后 | 04_SYSTEM_DESIGN/*.md |
| `/blueprint` | genesis 后 | 05_TASKS.md + agents.md 初始 Wave |
| `/change` | 微调已有任务 | 更新 TASKS + SYSTEM_DESIGN (仅修改) + CHANGELOG |
| `/explore` | 调研时 | 探索报告 |
| `/challenge` | 决策前质疑 | 07_CHALLENGE_REPORT.md (含问题总览目录) |
| `/forge` | 编码执行 | 代码 + 更新 agents.md Wave 块 |
| `/craft` | 创建工作流/技能/提示词 | Workflow / Skill / Prompt 文档 |

---

## 📜 宪法 (The Constitution)

1. **版本即法律**: 不"修补"架构文档，只"演进"。变更必须创建新版本。
2. **显式上下文**: 决策写入 ADR，不留在"聊天记忆"里。
3. **交叉验证**: 编码前对照 `05_TASKS.md`。我在做计划好的事吗？
4. **美学**: 文档应该是美的。善用 Markdown 和 Emoji。

---
## 🔄 Auto-Updated Context

<!-- AUTO:BEGIN — 由工作流自动维护，请勿手动编辑此区块 -->

### 技术栈决策
- 框架: Tauri 2.0 (Rust 后端 + Web 前端)
- 前端: React 18 + TypeScript + Vite
- PDF 渲染: pdf.js
- PDF 翻译: PDFMathTranslate (Python 3.12)
- 存储: SQLite (rusqlite) + macOS Keychain
- 设计 Skills: frontend-design + ui-ux-pro-max

### 系统边界
- frontend-system: React UI、PDF 渲染、聊天面板、NotebookLM WebView、设置页
- rust-backend-system: Tauri IPC、AI API 客户端、翻译进程管理、SQLite 存储、Zotero 集成
- translation-engine-system: PDFMathTranslate Python 服务（布局保留翻译）

### 活跃 ADR
- ADR-001: 技术栈选择 — Tauri 2.0 + React + PDFMathTranslate (Accepted)
- ADR-002: 多模型协作策略 — Claude+Gemini 前端 / Codex 后端 / 5 波次执行 (Accepted)

### 当前任务状态
- 任务清单: genesis/v1/05_TASKS.md
- 总任务数: 42, P0: 22, P1: 14, P2: 6
- Sprint 数: 5 (S0-S4)
- 质疑报告: genesis/v1/07_CHALLENGE_REPORT.md (🟡 需解决 P0)
- Wave 0 建议: T0.1.1 (types.ts), T0.1.2 (Rust Command Traits)
- 最近更新: 2026-03-11

<!-- AUTO:END -->

---
> **状态自检**: 准备好了？提醒用户运行 `/quickstart` 开始吧。
