# Rastro × Vault MCP 集成构思（草稿）

> **状态**：早期构思，未完成
> **创建日期**：2026-04-14
> **下次继续**：想清楚"手动复制频率"和第一个要实现的 tool 后再讨论

---

## 起点问题

用户希望让 CC（Claude Code）订阅的 Claude 模型能深度参与文献工作流。
最初想法是"让 CC 做 PDF 翻译"，但技术上不划算（冷启动、速率限制、订阅套利）。
真正值得做的方向：**让 Rastro 通过 MCP 暴露阅读器侧的独有数据，供 vault 的 CC 调用**。

---

## 两套系统现状核对

### Vault（`/Users/alias/Documents/笔记/`）

- 已经是**成熟的 CC + NotebookLM + Trellis 研究平台**
- 主索引：`.research-data/paper_index.db`（75 篇文献，64 带 `zotero_key`）
- 核心 pipeline：`/import-paper`、`/read-paper`、`/literature-search`、`/research-pipeline`、`/track`
- 深度分析：NotebookLM（通用索引 + 北园黑陶专题）
- 产出：Obsidian markdown（`文献笔记/`、`综述笔记/`、`AI笔记/`）
- 工具链：grok-search（禁用内置 WebSearch）、Zotero CLI、NotebookLM CLI

### Rastro（本项目）

- 数据库：`app.db`，`documents` 表含 `zotero_item_key` 字段
- 独有能力：pdfjs 阅读器、pdf2zh 保排版翻译、结构化标注（高亮/笔记/页码）、AI 问答对话历史

### 重合 vs 互补

**重合（不要重复造）**：

- 文献列表 / Zotero 同步 / 主题搜索
- 深度内容分析（NotebookLM 已经是顶级方案）
- 引用追踪 / 跨文献对比（已有 `/research-pipeline`、`/track`）

**互补（Rastro 的独有价值）**：

- 翻译后的 PDF 正文段落（NotebookLM 不吐翻译产物）
- 用户在 PDF 上的结构化标注（高亮 + 页码 + 位置）
- AI 问答对话历史（增量理解过程）
- 精确章节/页码引用能力

---

## 定位：Rastro MCP = 阅读器侧数据桥

**范围收敛**：只暴露 vault 拿不到的东西，不做文献管理层的重复工作。

**连接键**：`zotero_key`（两侧天然共享）。

---

## 暴露的能力清单（精简版）

```text
rastro.get_translation(zotero_key, section?)   # 翻译后的章节文本
rastro.get_annotations(zotero_key)             # 高亮 + 笔记 + 页码
rastro.get_conversations(zotero_key)           # AI 问答历史
rastro.list_reading_progress()                 # 最近在读什么、读到哪页
```

**不暴露**：文献列表、跨库搜索、AI 总结——vault 已有更好实现。

---

## 典型工作流闭环

**场景**：在 Rastro 里精读一篇英文论文，然后在 vault 里写笔记

1. 用户在 Rastro 中划了 8 处高亮（方法论关键点）
2. 与 AI 讨论了 3 次（XRD 谱图解读等）
3. 翻译了全文
4. 切换到 vault，执行 `/read-paper` 或直接写 `文献笔记/Smith_2023_xxx.md`
5. CC 自动调用：
   - `rastro.get_annotations("SMITH2023A")` → 填"原文摘录"章节
   - `rastro.get_conversations(...)` → 整理"阅读过程中的疑问"
   - `rastro.get_translation(..., section="methods")` → 方法论段落翻译
6. 用户手动补充研究思考

**现状**：这个闭环目前是手动复制粘贴。
**MCP 之后**：自动化，减少重复劳动。

---

## 反方向（vault → Rastro）

不需要 MCP，直接让 Rastro 读 `paper_index.db` + 扫 vault markdown：

- 在 Rastro 打开论文时，侧栏展示 vault 里已有的笔记 / NotebookLM 分析
- 避免"在 Rastro 深入研究，结果 vault 里早已有笔记"的重复劳动

---

## 架构选择（暂定）

**方案 B：独立 Python MCP server + 只读 Rastro SQLite**

```text
rastro-mcp (Python, ~300 行)
├── pyproject.toml
├── rastro_mcp/
│   ├── server.py     # MCP stdio transport
│   ├── db.py         # 只读 ~/Library/Application Support/com.rastro.app/app.db
│   └── tools.py      # 4 个 tool，全部以 zotero_key 为入参
```

配置到 vault 的 `.claude/` MCP 清单中即可被 CC 调用。

**优点**：Rastro 不运行时也可用；职责清晰。
**风险**：Rastro schema 变更需同步 MCP（后续考虑维护只读 view）。

---

## 未决问题（下次继续想）

1. **第一手数据校准**：最近 10 次研究笔记写作中，从 Rastro 手动复制到 vault 的实际频率？< 1 次则暂缓，> 3 次才值得做
2. **Phase 1 从哪个 tool 开始**：倾向 `get_annotations`（价值最清晰、实现最简单、两边完全不重合）
3. **翻译产物如何暴露**：全文太大，需要按 section 切；还是只暴露"标注所在段落"？依赖 pdf2zh / BabelDOC 产物的段落结构
4. **对话历史的粒度**：按文档暴露所有对话？还是只暴露用户标记为"重要"的？
5. **schema 耦合风险**：要不要在 Rastro 侧维护一个稳定的只读 view，隔离 MCP 与业务表？
6. **安全边界**：MCP 只读还是允许写回（如 CC 写的笔记回到 Rastro annotations）？

---

## 明确否决的方向

1. **CC 当翻译 backend**（HTTP shim 包装 `claude -p`）——冷启动 + 速率限制 + 订阅套利，性价比低
2. **Rastro MCP 做文献列表 / 跨库搜索**——vault 已有 paper_index.db + grok-search
3. **Rastro MCP 做 AI 总结**——vault 已有 NotebookLM
4. **迁移翻译到其他方案**——pdf2zh 保排版效果好，保持现状

---

## 下一步（当用户想清楚后）

选一个作为起点：

1. **侦察**：整理 Rastro `documents` / `annotations` / `conversations` / `document_summaries` 表的可暴露字段清单
2. **原型**：搭 Phase 1 最小 MCP server（仅 `get_annotations`），跑通 vault CC → Rastro 数据闭环
3. **设计文档**：写 `rastro-vault-integration.md` 放到 `.trellis/spec/`，正式定稿 zotero_key 契约和 tool schema

---

## 附：关键事实备忘

- Rastro `storage/documents.rs`:18,43 已有 `zotero_item_key: Option<String>`
- vault `paper_index.db` 有 `idx_zotero_key` 索引，64/75 带 key
- vault CC 产物落盘规则见 `/Users/alias/Documents/笔记/.trellis/spec/guides/vault-structure.md`
- vault 禁用内置 WebSearch/WebFetch，统一走 grok-search 和 web-access skill
