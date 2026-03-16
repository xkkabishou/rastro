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

- **最新架构版本**: `genesis/v2`
- **活动任务清单**: `genesis/v2/05_TASKS.md`
- **待办任务数**: 37 (33 任务 + 4 INT)
- **最近一次更新**: `2026-03-16`

### v1 历史 (已冻结)

v1 共 42 个任务，已完成 30 个。详见 `genesis/v1/05_TASKS.md`。

### 🌊 v2 Wave 1 ✅ — 数据基石 (S1)
T1.1.1, T1.1.2, T1.1.3, T1.2.1, T1.2.2, T1.2.3, T1.2.4, T2.1.1, T2.1.2

### 🌊 v2 Wave 2-3 ✅ — 前端基础 (S2)
T2.2.1, T2.2.4, T2.2.5

### 🌊 v2 Wave 4 ✅ — 组件提取与状态增强 (S2)
T2.2.2, T2.2.3, T2.3.1, T2.3.2

### 🌊 v2 Wave 5 ✅ — S3 产物管理 (入口任务)
T2.4.1, T2.4.3, T2.4.5

### 🌊 v2 Wave 6 ✅ — S3 操作绑定
T2.4.2, T2.4.4, T2.4.6

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

- **架构总览**: `genesis/v2/02_ARCHITECTURE_OVERVIEW.md`
- **ADR**: 架构决策见 `genesis/v2/03_ADR/`
- **frontend-system**: 源码 `src/` → 设计 `genesis/v2/04_SYSTEM_DESIGN/frontend-system.md`
- **rust-backend-system**: 源码 `src-tauri/` → 设计 `genesis/v2/04_SYSTEM_DESIGN/rust-backend-system.md`
- **translation-engine-system**: PDFMathTranslate → 设计 `genesis/v2/04_SYSTEM_DESIGN/translation-engine-system.md`
- **任务清单**: `genesis/v2/05_TASKS.md`

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
- ADR-003: 文档工作空间架构 — 统一产物模型 + 虚拟化树形视图 (Accepted)

### 当前任务状态
- 任务清单: genesis/v2/05_TASKS.md
- 总任务数: 33, P0: 21, P1: 8, P2: 4
- Sprint 数: 4 (S1-S4)
- Wave 1 建议: T1.1.1, T1.1.2, T1.1.3, T1.2.1, T1.2.2, T1.2.3, T1.2.4, T2.1.1, T2.1.2
- 最近更新: 2026-03-16

<!-- AUTO:END -->

---
> **状态自检**: 准备好了？提醒用户运行 `/quickstart` 开始吧。
