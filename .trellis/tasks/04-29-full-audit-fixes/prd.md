# 全面优化修复（P0-P3 三波次）

## Goal

基于 2026-04-29 全面审查报告，修复 28 个跨层（Rust / TS / SQL / CSS / Python）的优化点。
覆盖崩溃风险、性能瓶颈、内存泄漏、设计系统违规、可维护性。
最终目标：让 Rastro 在 5k+ 文档、100k+ 消息规模下仍稳定，并消除暖色调主题中的冷色硬编码。

## Requirements (final)

### Wave 1 — P0 必修 + 设计系统颜色统一（高 ROI / 用户可感知）
1. **SQLite 同步阻塞修复**：所有 `storage.connection()` 在 async 函数中改为 `tokio::task::spawn_blocking` 包装
2. **流式 RAF 缓冲修复**：`useChatStore.ts:221` flush 后清空 `_rafContent` / `_rafThinking`
3. **ChatMessage 流式渲染优化**：流式中纯文本渲染，完成后再渲 Markdown / KaTeX
4. **ChatPanel dragLeaveTimer 清理**：useEffect cleanup 中 clearTimeout
5. **翻译事件监听器生命周期**：`useDocumentStore.ts:254-282` 引入 unlisten 数组
6. **设计系统颜色统一**：
   - `Button.tsx:12` ring-blue-500 → `var(--color-border-focus)`
   - 全局 grep 替换 `text-emerald-500` / `text-red-400` / `bg-blue-500/10`
   - 暗色模式选中态修复

### Wave 2 — P1 性能与正确性 + 索引 + FastAPI
7. **翻译完成事务化**：`apply_engine_job_status` 用 `connection.transaction()` 包裹
8. **状态机自愈**：启动时扫描超时 running 任务转 failed；Worker 心跳 30s
9. **调度循环竞态修复**：mark_idle 前再查 queue_len
10. **缓存 cache_key 完整性**：补单测验证 base_url 计入；如有缺失补齐
11. **Tauri Event emit 错误日志化**：`let _ = ...` 改为 if let Err 写日志
12. **熔断器退避上限**：`MAX_BACKOFF = 300s` 兜底
13. **缓存淘汰原子化**：先删文件后删 DB；文件失败不删 DB
14. **LRU 受保护期限制**：受保护 job 最多 5 分钟
15. **SSE 行解析**：换 `tokio_util::codec::LinesCodec`
16. **错误码补全**：`FILE_NOT_FOUND` → `AppErrorCode::FileNotFound`
17. **PdfViewer EventBus 卸载**：显式 `eventBus.off()` 每个 handler
18. **聊天虚拟滚动**：接入 `@tanstack/react-virtual`
19. **同文档重开 pdfUrl 重置**：`useDocumentStore.ts:108-116`
20. **LazyMotion 改造**：framer-motion 入口换 LazyMotion + domAnimation
21. **数据库索引 migration（002）**：
    - `idx_translation_jobs_status`
    - `idx_translation_jobs_cache_key`
    - `idx_translation_jobs_doc_status`（复合）
    - `idx_documents_file_sha256`
    - `idx_usage_events_composite`
    - `PRAGMA journal_mode = WAL`（启动时执行）
22. **FastAPI/uvicorn 升级**（已确认纳入）：
    - 替换 `rastro_translation_engine/server.py` 的 stdlib `HTTPServer` → FastAPI + uvicorn
    - **不动** `pdf2zh` / `BabelDOC` / `antigravity_translate/`
    - 翻译排版输出与旧版字节级对比验证
    - Rust `http_client.rs` 错误码映射保持兼容

### Wave 3 — P2 / P3 Polish
23. 链路 ID 日志（job_id / session_id / stream_id 全覆盖）
24. AppError.details 路径脱敏
25. AI 取消后用户消息标记 `cancelled`
26. `pdf-text-extractor.ts` 两处 `as any` 用类型声明合并替换
27. 错误文案重写（去技术词，配合设置面板跳转）
28. 翻译进度 spinner + 百分比（`TranslationSwitch.tsx`）
29. ZoteroList 加载脉冲 1.2s → 0.8s
30. ProviderCard 间距 `space-y-2.5` → `space-y-3`
31. EngineSupervisor 实现 `Drop`
32. 高风险组件补 ErrorBoundary（ChatMessage / SettingsPanel）
33. `prefers-reduced-motion` 适配
34. `Sidebar.tsx:148` TODO 完成或删除（实际由 Wave 进展决定）

## Acceptance Criteria

- [ ] `cargo test` 全绿；新增 ≥ 5 项回归测试覆盖：spawn_blocking 重构、状态机自愈、cache_key 完整性、调度循环竞态、缓存淘汰原子化
- [ ] `npm test` 全绿；新增针对 useChatStore RAF 缓冲、useDocumentStore 文档切换、ChatMessage 流式渲染的测试
- [ ] `npm run build` 无 warning
- [ ] `cargo clippy --all-targets -- -D warnings` 通过
- [ ] migration 002 在已有 `~/Library/Application Support/com.rastro.app/app.db` 上执行无报错
- [ ] 设计系统硬编码扫描归零：`rg "ring-blue-|text-emerald-|text-red-4|bg-blue-5"` 在 src/ 下结果为 0
- [ ] FastAPI 升级后翻译产物字节比对：选 3 篇典型 PDF 翻译，新旧引擎输出 PDF md5 一致或人工核验排版相同
- [ ] 用户人工 smoke test 通过（开 PDF / 翻译 / AI 流式 / 切文档 / Light↔Dark）

## Definition of Done

- 自动测试全绿
- 三波 commit message 规范，描述清晰
- PRD 持续更新，记录实际遇到的偏差
- 性能验证：流式 50 tokens/s 下 CPU < 50%（用户在 Activity Monitor 抽样）
- 索引 migration 在 1k 模拟文档库下查询时间下降可观

## Decision (ADR-lite)

### D1 — FastAPI 升级
- **Context**：Python 端 stdlib HTTPServer 单线程，卡住的请求会瘫整个引擎进程
- **Decision**：纳入本任务 Wave 2，完整升级 FastAPI + uvicorn
- **Consequences**：+1 天工作量；**翻译核心完全不动**（pdf2zh/BabelDOC/排版保留）；解决根因；后续可支持并发翻译（虽暂仍单 worker）

### D2 — Commit 粒度
- **Context**：用户偏好简洁 git 历史，main 单分支
- **Decision**：三波 = 三个独立 commit，留在 main，每波独立完整闭环
- **Consequences**：commit 历史清晰；回滚粒度可接受；**禁止跨波次混 commit**

### D3 — 验证流程
- **Context**：用户禁止本小姐自动 commit；需要人工 smoke test 兜底
- **Decision**：每波完成后本小姐跑 `cargo test` + `npm test` + `npm run build` + `cargo clippy`，贴报告；用户人工跑 `npm run tauri dev` 验证关键交互；用户明确说"提交"后本小姐才执行 commit
- **Consequences**：稳健；交付节奏由用户控制；本小姐每波末有明确等待人工验证的 checkpoint

## Out of Scope

- 翻译核心算法改造（BabelDOC 已稳定）
- 新 AI Provider 接入
- 测试框架更换（保留 vitest + cargo test）
- 国际化 i18n（仅改中文文案）
- UI 整体重设计
- SQLite FTS5 全文搜索（改为后续独立任务）

## Technical Notes

### 关键约束
- `parking_lot::Mutex` + rusqlite 必须 `spawn_blocking` 包装；不可改 `tokio::sync::Mutex`（API 表面变化大）
- 设计 token 已在 `src/styles/globals.css` 定义：`--color-border-focus` / `--color-success` / `--color-destructive` / `--color-selected`
- migration 命名沿用 `001_init.sql` 风格：`002_indexes_and_wal.sql`
- 现有未提交变更（.agents/、.codex/、.cursor/、.trellis/* 11 项）不在本次修复范围，保持不动

### Wave 1 涉及文件（清单）
- `src-tauri/src/translation_manager/mod.rs`
- `src-tauri/src/translation_manager/job_registry.rs`
- `src-tauri/src/translation_manager/cache_eviction.rs`（部分）
- `src-tauri/src/storage/*` （所有 connection 调用点）
- `src-tauri/src/ai_integration/chat_service.rs`
- `src/stores/useChatStore.ts`
- `src/stores/useDocumentStore.ts`
- `src/components/chat-panel/ChatPanel.tsx`
- `src/components/chat-panel/ChatMessage.tsx`
- `src/components/ui/Button.tsx`
- `src/components/sidebar/DocumentNode.tsx`
- 多个使用 emerald-500 / red-400 / blue-500 的组件（待 grep 列出）

### Wave 2 涉及文件
- `src-tauri/migrations/002_indexes_and_wal.sql`（新建）
- `src-tauri/src/storage/mod.rs`（WAL pragma）
- `src-tauri/src/translation_manager/mod.rs`（事务、自愈）
- `src-tauri/src/translation_manager/engine_supervisor.rs`（熔断器上限）
- `src-tauri/src/translation_manager/http_client.rs`（错误码映射）
- `src-tauri/src/translation_manager/artifact_index.rs`（cache_key 验证）
- `src-tauri/src/ai_integration/chat_service.rs`（SSE 行解析、emit 日志化）
- `src/components/pdf-viewer/PdfViewer.tsx`
- `src/components/chat-panel/ChatPanel.tsx`（虚拟滚动）
- `src/main.tsx` 或 framer-motion 入口（LazyMotion）
- `rastro_translation_engine/server.py`（FastAPI 重写）
- `rastro_translation_engine/worker.py`（async 化少量改动）
- `requirements.txt`（新增 fastapi / uvicorn）

### Wave 3 涉及文件
- `src-tauri/src/translation_manager/*`（日志 ID、details 脱敏）
- `src-tauri/src/translation_manager/engine_supervisor.rs`（Drop）
- `src/components/pdf-viewer/TranslationSwitch.tsx`（spinner）
- `src/components/sidebar/ZoteroList.tsx`（动画）
- `src/components/settings/ProviderCard.tsx`（间距）
- `src/lib/pdf-text-extractor.ts`（类型声明）
- 需要 ErrorBoundary 包裹的高风险组件
- 错误文案文件（多处）

## Research References

无需额外研究：FastAPI 模式标准；其余皆为本仓内代码修复。
