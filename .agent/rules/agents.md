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

- **最新架构版本**: `genesis/v3`
- **活动任务清单**: `genesis/v3/05_TASKS.md`
- **最近一次更新**: `2026-03-18`

### v1 历史 (已冻结)

v1 共 42 个任务，已完成 30 个。详见 `genesis/v1/05_TASKS.md`。

### ✅ v2 交付状态 (已冻结)

- S1-S4 全部完成（33 个任务 + 4 个 INT 验证）

### 🆕 v3 当前阶段

- **主题**: 轻量级翻译功能（划词翻译 + 文献标题翻译 + 翻译 API 独立配置）
- **状态**: PRD + 架构概览 + 任务清单已完成，等待 /forge 执行
- **总任务数**: 12 + 3 INT = 15

### 🌊 Wave 1 ✅ — 翻译基座 (S1 前置任务)
T1.1.1, T1.1.2, T1.2.1, T1.2.2, T1.3.1

### 🌊 Wave 2 ✅ — 划词翻译 (S2 前端组件)
T2.1.1, T2.1.2, T2.1.3

### 🌊 Wave 3 ✅ — S3 标题翻译 (后端 + 前端)
T3.1.1, T3.1.2, T3.2.1, T3.2.2

### 🌊 Wave 4 ✅ — 集成验证
INT-S1, INT-S2, INT-S3

---

## 🌳 项目结构 (Project Tree)

> **注意**: 此部分由 `/genesis` 维护。

```text
antigravity-paper/
├── genesis/
│   ├── v1/                      # 历史架构文档（冻结）
│   ├── v2/                      # v2 架构文档（冻结）
│   └── v3/                      # 当前架构文档（轻量级翻译功能）
│       ├── 00_MANIFEST.md
│       ├── 01_PRD.md
│       ├── 02_ARCHITECTURE_OVERVIEW.md
│       └── 06_CHANGELOG.md
├── .agent/
│   ├── rules/                   # agents.md / 恢复锚点
│   └── workflows/               # genesis / blueprint / forge / change 等工作流
├── src/                         # React 19 前端
│   ├── components/
│   ├── layouts/
│   ├── lib/
│   ├── shared/
│   ├── stores/
│   └── styles/
├── src-tauri/                   # Tauri 2 + Rust 后端
│   ├── migrations/
│   ├── capabilities/
│   └── src/
│       ├── ai_integration/
│       ├── ipc/
│       ├── keychain/
│       ├── notebooklm_manager/
│       ├── storage/
│       ├── translation_manager/
│       └── zotero_connector/
├── rastro_translation_engine/   # PDF 翻译 HTTP 服务
├── antigravity_translate/       # PDF 翻译核心
└── rastro_notebooklm_engine/    # NotebookLM 本地代理
```

---

## 🧭 导航指南 (Navigation Guide)

> **注意**: 此部分由 `/genesis` 维护。

- **项目总览**: `CLAUDE.md`
- **v3 架构总览**: `genesis/v3/02_ARCHITECTURE_OVERVIEW.md`（轻量级翻译功能）
- **v3 PRD**: `genesis/v3/01_PRD.md`
- **v2 架构总览**: `genesis/v2/02_ARCHITECTURE_OVERVIEW.md`（已冻结）
- **ADR**: 架构决策见 `genesis/v2/03_ADR/` + v3 内联 ADR-301/302
- **详细设计**: 待 `/design-system` 执行后更新 (将填充 `genesis/v3/04_SYSTEM_DESIGN/`)
- **任务清单**: 待 `/blueprint` 执行后更新 (将生成 `genesis/v3/05_TASKS.md`)
- **v2 任务清单**: `genesis/v2/05_TASKS.md`（33 个任务 + 4 个 INT，全部完成）

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
- 前端: React 19 + TypeScript + Vite
- PDF 渲染: pdf.js
- PDF 翻译: rastro_translation_engine + antigravity_translate + pdf2zh (Python 3.12+)
- 存储: SQLite (rusqlite) + macOS Keychain
- 设计系统: Tailwind CSS v4 + Radix Themes + framer-motion

### 系统边界
- frontend-system: React UI、文档树、PDF 阅读器、聊天/总结/设置面板、搜索与筛选
- rust-backend-system: Tauri IPC、AI 集成、文档/产物存储、翻译任务管理、Zotero、Keychain
- translation-engine-system: rastro_translation_engine 服务 + antigravity_translate 核心，负责 PDF 翻译与产物生成
- notebooklm-service: rastro_notebooklm_engine 本地代理服务

### 活跃 ADR
- ADR-001: 技术栈选择 — Tauri 2.0 + React + PDFMathTranslate (Accepted)
- ADR-002: 多模型协作策略 — Claude+Gemini 前端 / Codex 后端 / 5 波次执行 (Accepted)
- ADR-003: 文档工作空间架构 — 统一产物模型 + 虚拟化树形视图 (Accepted)
- ADR-301: 翻译配置与主 AI 配置隔离 — 独立表 + 独立 Keychain 前缀 (Accepted)
- ADR-302: 标题翻译时机 — Zotero 同步后异步触发，非 hover 时实时翻译 (Accepted)

### 当前任务状态
- 任务清单: genesis/v3/05_TASKS.md
- 总任务数: 12 + 3 INT, P0: 11, P1: 1
- Sprint 数: 3 (S1 翻译基座 / S2 划词翻译 / S3 标题翻译)
- Wave 1 建议: T1.1.1, T1.1.2, T1.2.1, T1.2.2, T1.3.1
- 最近更新: 2026-03-18

<!-- AUTO:END -->

---
> **状态自检**: 准备好了？提醒用户运行 `/quickstart` 开始吧。
