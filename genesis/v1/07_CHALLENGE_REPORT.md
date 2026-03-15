# Rastro 质疑报告 (Challenge Report)

> **审查日期**: 2026-03-11  
> **审查范围**: genesis/v1 全部设计文档  
> **累计轮次**: 1

---

## 📋 问题总览

### 第一轮（2026-03-11，7/12 已修复 — 2026-03-15 更新）

| ID | 严重度 | 摘要 | 状态 |
|----|--------|------|------|
| H1 | 🟠 | 前后端 IPC 命令命名不一致 | ✅ 已修复 — 代码统一使用后端命名（`open_document`），`ipc-client.ts` 31 个函数全部对齐 |
| H2 | 🟠 | NotebookLM 在后端 IPC 契约中完全缺失 | ✅ 已修复 — 新增 `notebooklm_manager` Rust 模块 + 11 个 IPC 命令 + Python engine 骨架 |
| H3 | 🟠 | 翻译 Overlay vs 翻译 PDF 交互模型矛盾 | ✅ 已修复 — 采用翻译 PDF 方案，`TranslationSwitch` 组件实现原文/译文切换 |
| H4 | 🟠 | Python 环境缺失场景设计不充分 | ✅ 已修复 — `errors.rs` 新增 `PYTHON_NOT_FOUND` 等错误码，`SetupWizard` 组件引导安装 |
| H5 | 🟠 | 进程熔断机制对桌面场景过于严格 | ✅ 已修复 — `engine_supervisor.rs` 改为指数退避 + 用户手动重启选项 |
| M1 | 🟡 | 聊天消息接口缺少分页参数 | ⏳ 未处理 — 当前 `get_chat_messages` 仍一次加载全部 |
| M2 | 🟡 | 翻译缓存 LRU 淘汰策略缺具体设计 | ✅ 已修复 — `cache_eviction.rs` 实现 LRU 淘汰逻辑 |
| M3 | 🟡 | 大 PDF SHA-256 哈希计算性能影响 | ⏳ 未处理 — 暂无异步哈希或分块计算 |
| M4 | 🟡 | 孤儿 Python 进程接管行为未完全定义 | ⏳ 未处理 — 进程清理仍依赖 supervisor 简单 kill |
| M5 | 🟡 | AI Stream chunk 缺乏 batching 策略 | ✅ 已修复 — AG-005 实现了 pending 队列避免事件丢失 |
| L1 | 🟢 | 进程日志缺少轮转策略 | ⏳ 后续优化 |
| L2 | 🟢 | AnthropicAdapter 合约测试策略粗略 | ⏳ 后续优化 |


---

## 🎯 审查方法论

本次审查模式: **DESIGN**

1. **设计审查** (design-reviewer skill) — 执行 — 系统设计 / 运行模拟 / 工程实现 三维度
2. **任务审查** (task-reviewer skill) — 跳过 — `05_TASKS.md` 不存在
3. **Pre-Mortem** — 预演失败 + 假设验证
4. **合并评定** — 统一严重度分级 + 综合判断

---

## 🔥 第1轮详细审查（当前活跃）

### 📊 本轮问题统计

| 严重度 | 数量 | 占比 |
|--------|------|------|
| Critical | 0 | 0% |
| High | 5 | 42% |
| Medium | 5 | 42% |
| Low | 2 | 16% |
| **Total** | **12** | **100%** |

| 维度 | 问题数 |
|------|--------|
| 设计审查 (design-reviewer) | 9 |
| Pre-Mortem + 假设验证 | 3 |

---

## 🟠 High 级别

### H1. 前后端 IPC 命令命名不一致

**严重度**: High  
**文档**: `frontend-system.md` Section 5 vs `rust-backend-system.md` Section 7.3

**问题描述**:
两份系统设计文档对 Tauri IPC Command 的命名存在明确冲突：

| 场景 | `frontend-system.md` 的命名 | `rust-backend-system.md` 的命名 |
|------|------|------|
| 打开 PDF | `invoke("load_pdf_metadata")` | `invoke("open_document")` |
| NotebookLM | `invoke("trigger_notebooklm")` | **不存在** |
| 翻译 | `invoke("request_translation")` | `invoke("request_translation")` ✅ |
| AI 问答 | `invoke("ask_ai")` | `invoke("ask_ai")` ✅ |
| Zotero | `invoke("fetch_zotero_items")` | `invoke("fetch_zotero_items")` ✅ |

**证据**:
- `frontend-system.md` 第 109 行：`invoke("load_pdf_metadata")`
- `rust-backend-system.md` 第 412 行：`open_document` — 请求参数和返回类型也完全不同
- ADR-002 的核心原则是"接口契约驱动并行开发（Wave 0 先定义契约）"

**影响**:
- Wave 1a (Codex/Rust) 和 Wave 1b (Claude+Gemini/React) 用不同的命令名开发，联调时必然冲突返工
- 违反了 ADR-002 "接口契约驱动" 的核心设计决策

**建议**:
以 `rust-backend-system.md` 的 Command 列表为 **Source of Truth**（更完整、有详细 DTO 定义），更新 `frontend-system.md` 的接口调度表与之对齐。Wave 0 的产出应是一份统一的 `types.ts` + Rust trait 定义。

---

### H2. NotebookLM 在后端 IPC 契约中完全缺失

**严重度**: High  
**文档**: `rust-backend-system.md` Section 7.3 全部 Command 列表、`02_ARCHITECTURE_OVERVIEW.md` Section 4

**问题描述**:
PRD [REQ-006] 要求 NotebookLM 一键生成功能（P1）。`frontend-system.md` 定义了 `invoke("trigger_notebooklm")` Command。但 `rust-backend-system.md` 的完整 Command 列表（A-G 共 7 大类）中**没有任何 NotebookLM 相关的 Command**。

同时 `02_ARCHITECTURE_OVERVIEW.md` 第 203 行明确指出："Frontend 直接操作 NotebookLM WebView（不经过 Backend）"。

**证据**:
- `rust-backend-system.md` Section 3 第 23 行："不负责: NotebookLM WebView 自动化"
- `frontend-system.md` Section 5 第 113 行定义了 `invoke("trigger_notebooklm")`
- 两者设计矛盾：一个说 Backend 不管，另一个说通过 Backend IPC 调用

**影响**:
- 开发者无法确定 NotebookLM 功能是 Frontend 自治还是经过 Backend 代理
- 如果 Frontend 直接操作 WebView（Architecture Overview 的设计），则 `frontend-system.md` 中不应出现 `invoke("trigger_notebooklm")`
- 如果需要 Backend 参与（如上传 PDF 路径），则 `rust-backend-system.md` 需要补充 Command

**建议**:
按 Architecture Overview 的设计意图，NotebookLM WebView 自动化由 Frontend 直接完成。从 `frontend-system.md` 移除虚假的 `invoke("trigger_notebooklm")` Command，改为前端内部模块调用。如果 Backend 需要提供 PDF 文件路径作为 NotebookLM 上传前的准备操作，可在 `open_document` 的 `DocumentSnapshot` 中附加 `filePath` 信息（已有）。

---

### H3. 翻译 Overlay vs 翻译 PDF 交互模型矛盾

**严重度**: High  
**文档**: `frontend-system.md` Section 4.1 + 10、`translation-engine-system.md` Section 8

**问题描述**:
存在两种设计定义对"翻译结果如何展示"的矛盾理解：

**方案 A（Translation Engine 设计）**:
`translation-engine-system.md` 的输出是**完整的翻译后 PDF 文件**（`translated.pdf` + `bilingual.pdf`），由 PDFMathTranslate 生成布局保留的全新 PDF。前端只需用 pdf.js 渲染翻译后的 PDF。

**方案 B（Frontend 设计）**:
`frontend-system.md` 定义了 `Translation Overlay` 组件（Section 4.1 第 56-57 行），并在 Section 10 提到"Translation Overlay 利用 `will-change: opacity` 甚至单独抽出成 `canvas` 覆盖层"。这暗示翻译结果是作为 DOM/Canvas 覆盖层叠加在原始 PDF 渲染之上。

**证据**:
- `frontend-system.md` 架构图中明确有独立的 `TranslationLayer["Translation Overlay"]` 组件
- `translation-engine-system.md` 产出的是文件级 PDF，不是块级文本数据
- PRD [REQ-002] 的"隐式双语对照"要求：默认中文，快捷键切换原文

**影响**:
- 这决定了前端渲染架构的根本思路：是渲染两个 PDF 切换，还是一个 PDF + DOM 覆盖层
- 如果用翻译后的 PDF 文件，"隐式双语对照"应是 pdf.js 在原始 PDF 和翻译 PDF 之间切换渲染
- 如果用 DOM 覆盖层，Translation Engine 需要返回结构化的文本块 + 位置坐标，而不仅仅是 PDF 文件

**建议**:
统一为"翻译后 PDF 切换"方案（方案 A），理由：
1. PDFMathTranslate 的核心能力就是生成保留布局的翻译 PDF，这是它的护城河
2. DOM 覆盖层方案需要 Translation Engine 额外输出每个文本块的精确坐标，增加大量复杂度
3. "隐式双语对照"可以通过 pdf.js 切换渲染源 PDF 实现（原始 PDF / 翻译 PDF），配合 Option 键触发
4. 保留 `Translation Overlay` 概念，但仅用于"切换中的过渡动画"或"图表翻译的注释浮层"，而非全文覆盖

---

### H4. Python 环境缺失场景设计不充分

**严重度**: High  
**文档**: `rust-backend-system.md` Section 7.2-7.3、`frontend-system.md`（缺失）

**问题描述**:
多处文档提到"首次启动自动检测引导安装 Python 环境"，但**没有任何设计文档给出具体的检测和引导流程**：
1. Rust 后端的 `ensure_translation_engine` 没有 `PYTHON_NOT_FOUND` 错误码——只有 `ENGINE_UNAVAILABLE`
2. 前端设计中没有"首次启动引导"页面或组件的设计
3. 异常场景未覆盖：Python 已安装但版本不对（如 3.9）、PDFMathTranslate 包未安装、pip 包版本不兼容

**证据**:
- `rust-backend-system.md` 第 335-348 行的 `AppError.code` 枚举中无 Python 环境相关错误码
- ADR-001 第 92-95 行缓解措施提到了"自动检测/引导安装"，但停留在理念层面
- PRD 第 245 行 [约束]："用户本地需要 Python 3.12 环境"

**影响**:
- 用户首次使用翻译功能时遇到"引擎不可用"的模糊错误，无法自助解决
- 安装引导是用户体验的第一关，设计缺失会导致高弃用率

**建议**:
1. 在 `AppError.code` 中增加 `PYTHON_NOT_FOUND`、`PYTHON_VERSION_MISMATCH`、`PDFMATHTRANSLATE_NOT_INSTALLED` 三个错误码
2. `ensure_translation_engine` 在启动 Python 前增加预检步骤：检测 `python3 --version` 和 `python3 -c "import pdf2zh"` 的输出
3. `frontend-system.md` 增加 `setup-wizard` 组件设计：当后端返回上述错误码时显示分步安装引导

---

### H5. 进程熔断机制对桌面场景过于严格

**严重度**: High  
**文档**: `rust-backend-system.md` Section 8.3 第 7 条

**问题描述**:
设计要求"连续 3 次异常退出进入熔断，10 分钟内不自动重启"。

**证据**:
- 桌面 App 的用户预期是"始终可用"，10 分钟的熔断窗口对于桌面场景过长
- 没有定义"连续 3 次异常退出"的时间窗口——如果 3 次失败分散在 3 天内也算连续？
- 没有设计用户手动覆盖熔断的 UI 操作（如"重试"按钮）
- 未区分「启动失败」(Python 环境问题，重试无意义) vs「运行中崩溃」(可能是偶发，重试有意义)

**影响**:
- 用户在熔断期间看到翻译功能完全不可用，只能等 10 分钟
- 无法自助恢复，感知为"软件 bug"

**建议**:
1. 区分熔断类型：环境预检失败（如 Python 找不到）不应进入时间熔断，应直接引导安装
2. 运行时崩溃的熔断窗口缩短为 3 分钟，并采用指数退避（30s → 1min → 3min）
3. 在前端提供"强制重启引擎"按钮，允许用户覆盖熔断状态
4. 明确计数窗口：只有在 5 分钟内连续 3 次崩溃才触发熔断

---

## 🟡 Medium 级别

### M1. 聊天消息接口缺少分页参数

**严重度**: Medium  
**文档**: `rust-backend-system.md` Section 7.3.D

**问题描述**:
`get_chat_messages` Command 仅接受 `{ sessionId: string }` 参数，没有 `limit` 和 `offset`。如果用户对同一文献有大量对话（数百条消息），一次全量加载可能影响前端渲染性能。

**建议**: 增加可选的 `limit` 和 `beforeMessageId` 游标参数。

---

### M2. 翻译缓存 LRU 淘汰策略缺具体设计

**严重度**: Medium  
**文档**: `rust-backend-system.md` Section 4.3、PRD [REQ-008]

**问题描述**:
PRD 假设缓存上限 500MB，超出后 LRU 淘汰。但后端设计中虽有 `artifact_index` 模块和 `file_size_bytes` 字段，却没有定义何时触发清理、如何计算当前缓存总大小、以及清理的具体 IPC Command。

**建议**: 在 `translation-manager` 中增加 `check_and_evict_cache()` 逻辑，在每次翻译完成后和 App 启动时检查。

---

### M3. 大 PDF SHA-256 哈希计算性能影响

**严重度**: Medium  
**文档**: `rust-backend-system.md` Section 12.1

**问题描述**:
`open_document` 性能目标 < 300ms，但大 PDF（100MB+） 的 SHA-256 计算可能需要 500ms-1s。设计承认了这一点（"不含首个 SHA-256 计算的冷启动"），但没有给出具体缓解策略。

**建议**: 采用 `file_size + mtime + 前 4KB 内容哈希` 做快速文件标识，完整 SHA-256 在后台异步计算。

---

### M4. 孤儿 Python 进程接管行为未完全定义

**严重度**: Medium  
**文档**: `rust-backend-system.md` Section 8.3

**问题描述**:
如果 Rastro App 被 force quit，Python 进程变成孤儿。`ensure_engine()` 设计了端口检测 + 健康签名验证可以接管，但未定义：如果孤儿进程卡在翻译中间（有 active job），接管后是否清理旧任务？

**建议**: 接管后先调用 `GET /v1/jobs` 检查活跃任务状态，如为 stale 则标记 cancelled。

---

### M5. AI Stream chunk 缺乏 batching 策略

**严重度**: Medium  
**文档**: `rust-backend-system.md` Section 9.2、`frontend-system.md` Section 10

**问题描述**:
AI 流式输出每收到一个 token 就通过 `ai://stream-chunk` 事件推送（约 50-100 次/秒）。同时 pdf.js 在 JS 主线程渲染。高频事件可能造成 Zustand store 更新引发的不必要 re-render。

**建议**: 后端对 stream chunk 做 100ms batching（合并多次 token 为一次 emit），或前端用 `requestAnimationFrame` 节流。

---

## 🟢 Low 级别

### L1. 进程日志缺少轮转策略

**严重度**: Low  
**文档**: `rust-backend-system.md` Section 5.2

**问题描述**: `translation-engine.stdout.log` 没有定义日志轮转策略和最大文件大小，长时间运行后日志可能膨胀。

**建议**: 设置单文件上限 10MB，最多保留 3 个历史文件。

---

### L2. AnthropicAdapter 合约测试策略粗略

**严重度**: Low  
**文档**: `translation-engine-system.md` Section 14.2

**问题描述**: Claude 自定义 adapter 并非上游原生支持路径，测试策略仅提到 "contract test"，但未定义具体的 test fixture 和上游 API 升级时的回归策略。

**建议**: 为 `AnthropicAdapter` 编写独立的 contract test suite，在 PDFMathTranslate 升级时作为 CI gate。

---

## 📋 建议行动清单

### P0 - 立即处理 (Blueprint 前阻塞)
1. **[H1]** 统一前后端 IPC 命令命名 → 以 `rust-backend-system.md` 为权威源，修订 `frontend-system.md`
2. **[H2]** 明确 NotebookLM 的架构归属 → Frontend 自治方案，从 `frontend-system.md` 移除虚假 IPC Command
3. **[H3]** 统一翻译展示模型 → 确认"翻译后 PDF 切换"方案，修订 Frontend 设计文档

### P1 - 近期处理 (Forge 前修复)
4. **[H4]** 补充 Python 环境预检和安装引导设计 → 增加错误码 + 前端引导组件
5. **[H5]** 调整熔断策略 → 缩短窗口 + 分类型处理 + 用户覆盖入口

### P2 - 持续改进 (实现时处理)
6. **[M1-M5]** 增加分页参数、缓存淘汰逻辑、哈希优化、孤儿进程清理、stream batching

### P3 - 后续优化
7. **[L1-L2]** 日志轮转、Adapter 测试强化

---

## 🚦 最终判断

- [ ] 🟢 项目可继续，风险可控
- [x] 🟡 项目可继续，但需先解决 P0 问题
- [ ] 🔴 项目需要重新评估

**判断依据**:
- 无 Critical 级问题 — 架构基本方向合理
- 5 个 High 级问题中，H1-H3 属于文档一致性问题（前后端系统设计文档未对齐），H4-H5 属于交互完整性不足
- P0 问题（H1-H3）本质是"设计文档之间的矛盾"，只需统一文档即可，不涉及架构方向调整
- P1 问题（H4-H5）需要补充设计，但不阻塞 Blueprint 任务拆解

> [!IMPORTANT]
> **可继续执行 Blueprint 的条件**：认可 P0 的修复方向（后端 IPC 契约为权威源、翻译后 PDF 切换方案、NotebookLM 前端自治），则 Blueprint 中的任务拆解直接基于修正后的设计意图进行，无需等待文档物理修复。

---

## 📚 附录

### A. Pre-Mortem 分析

| 失败场景 | Root Cause | 概率 | 对应问题 |
|---------|-----------|:----:|----------|
| 前后端联调大量返工 | IPC 契约不统一 | 🔴高 | H1, H2 |
| 翻译功能首次启动即失败 | Python 环境引导缺失 | 🟡中 | H4 |
| 翻译功能频繁"不可用" | 进程熔断过严格 | 🟡中 | H5 |
| 翻译效果不符合用户预期 | Overlay vs PDF 切换概念混乱 | 🔴高 | H3 |
| 长时间使用后磁盘膨胀 | 缓存清理策略缺失 | 🟢低 | M2, L1 |
| AI 聊天掉帧 | Stream chunk 高频 re-render | 🟡中 | M5 |

### B. 假设验证结果

| 假设 | 验证方法 | 结果 | 风险 |
|------|---------|------|:----:|
| PDFMathTranslate 可包装为本地 HTTP 服务 | zotero-pdf2zh 案例分析 | 已有成功案例 | ✅ 已验证 |
| Tauri IPC 对流式推送足够高效 | 技术文档分析 + 负载推算 | 单用户场景可行，需 batching | ⚠️ 有条件 |
| SQLite WAL 模式满足桌面并发写入 | 写入频率推算 (< 5次/秒) | 远低于 SQLite 能力上限 | ✅ 已验证 |
| 用户本地有 Python 3.12 | 无数据 | 科研用户群体可能已安装，但不确定 | ⚠️ 未验证 |
| NotebookLM WebView 自动化稳定 | 设计文档分析 | Google 可能更新 UI，需定期维护 | ⚠️ 已知风险 |
| Claude 可作为 PDFMathTranslate 翻译后端 | 上游源码分析 | 需自定义 Adapter，可行但有维护成本 | ⚠️ 有条件 |
