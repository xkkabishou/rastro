# 产品需求文档 (PRD) — 轻量级翻译功能 v3

> Genesis v3 | 2026-03-18

## 1. 目标

为 Rastro 增加**轻量级翻译功能**，覆盖两个核心场景：

1. **划词翻译** — 在 PDF 阅读器中选中文字后，即时查看中文翻译
2. **文献标题翻译** — Zotero 入库的英文文献自动翻译标题，hover 显示中文译名

该功能使用独立的低成本 API 配置（用户原话："小数量多次数，仅垃圾模型就行了"），与现有 AI 对话/全文翻译使用的主 Provider 完全隔离。

## 2. Non-Goals（不做的事）

- NG1: 不做全文翻译流程的改动（已有 antigravity_translate 引擎处理）
- NG2: 不做选词翻译的历史记录/收藏功能
- NG3: 不做批量标题翻译的进度条/后台任务管理 UI
- NG4: 不做多目标语言支持（固定英→中）
- NG5: 不做选词翻译的离线/本地模型支持

## 3. 用户故事

---

### [REQ-301] 划词翻译 — 选中文字后翻译

- **优先级**: P0
- **用户价值**: 阅读英文论文时，遇到不理解的段落可以即时查看中文翻译，无需切换应用或复制粘贴。
- **涉及系统**: `frontend-system`, `rust-backend-system`
- **独立可测**: 选中 PDF 中一段英文文字，点击浮窗中的"翻译"按钮，观察翻译结果是否在毛玻璃气泡中正确显示。

**验收标准**:
- [ ] **Given** 用户在 PDF 阅读器中选中 ≥2 字符的文字, **When** 选中完成, **Then** 弹出毛玻璃风格浮窗菜单，包含「引用到对话」和「翻译」两个选项（水平或垂直排列）。
- [ ] **Given** 用户点击浮窗中的「翻译」按钮, **When** 翻译 API 已配置, **Then** 浮窗展开显示翻译结果区域，展示 loading 态后显示翻译文本。
- [ ] **Given** 翻译 API 未配置或调用失败, **When** 用户点击翻译, **Then** 显示友好的错误提示（"请先在设置中配置翻译 API"或"翻译失败，请稍后重试"），不阻塞其他操作。
- [ ] **边界情况**: 选中超长文本（>2000 字符）时，截断至前 2000 字符进行翻译并提示"已截断"。

---

### [REQ-302] 选项浮窗毛玻璃重设计

- **优先级**: P0
- **用户价值**: 统一视觉风格，与笔记弹窗 (`NotePopup`) 保持一致的毛玻璃美学。
- **涉及系统**: `frontend-system`
- **独立可测**: 选中文字后观察浮窗是否呈现毛玻璃效果（半透明背景 + 磨砂模糊 + 精致边框）。

**验收标准**:
- [ ] **Given** 浮窗弹出, **When** 渲染完成, **Then** 浮窗使用 `backdrop-blur-2xl backdrop-saturate-150` + 半透明背景（`rgba(255,251,245,0.38)` light / 暗色模式适配），带 `border-white/30 dark:border-white/10` 边框和 `shadow-xl` 阴影。
- [ ] **Given** 浮窗弹出, **When** 有 framer-motion 动画, **Then** 入场动画与 NotePopup 风格一致（`opacity: 0→1, scale: 0.9→1, y: -4→0`，duration 150ms）。
- [ ] **边界情况**: 浮窗出现在 PDF 底部边缘时，自动向上弹出，不被裁切。

---

### [REQ-303] 文献标题中文翻译（带缓存）

- **优先级**: P0
- **用户价值**: 快速浏览文献列表时看到中文标题，降低英文阅读压力。
- **涉及系统**: `frontend-system`, `rust-backend-system`, `storage-system`
- **独立可测**: 将一篇英文文献添加到 Zotero，同步到 Rastro 后 hover 该条目，观察中文译名是否出现。

**验收标准**:
- [ ] **Given** 新英文文献入库（Zotero 同步后首次出现）, **When** 翻译 API 已配置, **Then** 后端自动翻译标题并缓存到 SQLite（`title_translations` 表），不阻塞 UI 流程。
- [ ] **Given** 已有缓存的文献条目, **When** 鼠标 hover 该条目 ≥300ms, **Then** 显示毛玻璃风格的 tooltip 展示中文译名，不闪烁、不重复调用 API。
- [ ] **Given** 翻译 API 未配置, **When** 新文献入库, **Then** 不触发翻译，不报错，hover 时无 tooltip 或显示"翻译 API 未配置"。
- [ ] **边界情况**: 中文标题不翻译（后端检测标题是否为英文，非英文跳过）。

---

### [REQ-306] 启动时标题翻译缓存补全

- **优先级**: P0
- **用户价值**: 确保所有已入库的英文文献都有中文译名，包括配置翻译 API 之前已入库的文献，以及翻译失败过的条目。
- **涉及系统**: `rust-backend-system`, `storage-system`
- **独立可测**: 启动应用后，观察后端日志确认缓存补全任务已执行，之前未翻译的文献 hover 后可看到中文译名。

**验收标准**:
- [ ] **Given** 应用启动完成, **When** 翻译 API 已配置, **Then** 后端自动扫描所有已入库文献的标题，找出未在 `title_translations` 表中缓存的英文标题，串行限速（1 req/s）调用翻译 API 补全缓存。
- [ ] **Given** 启动时缓存补全正在执行, **When** 用户正常操作应用, **Then** 补全任务在后台运行，不阻塞 UI、不影响应用启动速度。
- [ ] **Given** 所有标题均已缓存, **When** 应用再次启动, **Then** 扫描发现无缺失缓存，跳过执行（零 API 调用）。
- [ ] **边界情况**: 翻译 API 未配置时，跳过补全任务，不报错。

---

### [REQ-304] 文献标题 Tooltip 毛玻璃风格

- **优先级**: P1
- **用户价值**: 统一 hover 交互的视觉语言，与选词浮窗和笔记弹窗一致。
- **涉及系统**: `frontend-system`
- **独立可测**: hover 一个已翻译的文献条目，观察 tooltip 样式。

**验收标准**:
- [ ] **Given** tooltip 出现, **When** 渲染完成, **Then** 使用与 NotePopup 相同的毛玻璃样式（`backdrop-blur-2xl`, 半透明背景, 精致边框），通过 framer-motion `AnimatePresence` 动画淡入淡出。
- [ ] **Given** 多个条目快速滑动, **When** hover 从一个条目移到另一个, **Then** tooltip 平滑过渡或先消失再出现，不残留。
- [ ] **边界情况**: tooltip 在侧栏边缘时不超出窗口边界。

---

### [REQ-305] 翻译 API 独立配置

- **优先级**: P0
- **用户价值**: 翻译功能使用独立的低成本 API，不影响主 AI 功能的配置和费用。
- **涉及系统**: `frontend-system`, `rust-backend-system`, `storage-system`
- **独立可测**: 在设置页面新 Tab 中配置翻译 API，然后使用划词翻译验证配置生效。

**验收标准**:
- [ ] **Given** 用户打开设置页面, **When** 页面加载, **Then** 显示新的「翻译」Tab（图标: `Languages`），与现有模型配置、使用统计、存储管理、提示词 Tab 并列。
- [ ] **Given** 用户点击「翻译」Tab, **When** Tab 切换, **Then** 展示翻译 API 配置界面：Provider 选择（OpenAI/Claude/Gemini）、API Key 输入（脱敏显示）、Base URL（可选）、模型名输入/选择、测试连接按钮。
- [ ] **Given** 用户保存翻译 API 配置, **When** Key 存储完成, **Then** Key 安全存储于 macOS Keychain（前缀区分 `translation_`），DB 中存储独立的 `translation_provider_settings` 记录。
- [ ] **边界情况**: 翻译配置与主 AI 配置完全独立——修改一个不影响另一个。

---

## 4. 数据模型增量

### 新增表: `title_translations`
| 列 | 类型 | 说明 |
|---|---|---|
| title_hash | TEXT PK | 原始标题的 SHA-256 哈希 |
| original_title | TEXT NOT NULL | 原始英文标题 |
| translated_title | TEXT NOT NULL | 中文译名 |
| provider | TEXT NOT NULL | 使用的翻译 Provider |
| model | TEXT NOT NULL | 使用的模型 |
| created_at | TEXT NOT NULL | 翻译时间 (ISO 8601) |

### 新增表: `translation_provider_settings`
| 列 | 类型 | 说明 |
|---|---|---|
| provider | TEXT PK | Provider ID (openai/claude/gemini) |
| model | TEXT NOT NULL | 模型名 |
| base_url | TEXT | 自定义 Base URL |
| masked_key | TEXT | 脱敏 API Key 显示用 |
| is_active | INTEGER NOT NULL DEFAULT 0 | 是否为当前激活的翻译 Provider |

### Keychain 扩展
- 翻译 API Key 使用 `translation_{provider}` 前缀存储，与现有 `{provider}` 隔离。

## 5. 10 维歧义扫描

| # | 维度 | 状态 |
|---|------|:---:|
| 1 | 功能范围与行为 | ✅ Clear |
| 2 | 领域与数据模型 | ✅ Clear |
| 3 | 交互与 UX 流程 | ✅ Clear |
| 4 | 非功能性质量 | ✅ Clear — 单次翻译 <3s p99, 标题翻译串行限速 1 req/s |
| 5 | 集成与外部 | ✅ Clear — 复用现有 `ai_integration` 模块的 HTTP 请求逻辑 |
| 6 | 边界情况与故障 | ✅ Clear — 各 REQ 均含边界情况 |
| 7 | 约束与权衡 | ✅ Clear — [ASSUMPTION] 翻译固定英→中，目标语言不可配置 |
| 8 | 术语一致性 | ✅ Clear |
| 9 | 完成信号 | ✅ Clear — 每个 REQ 含验收标准 |
| 10 | 占位符 | ✅ Clear — 无未量化的模糊形容词 |
