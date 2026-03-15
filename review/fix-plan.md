# Rastro 修复执行文档

生成时间：2026-03-13  
来源：基于当前仓库静态审查、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`python3 -m compileall antigravity_translate rastro_translation_engine`

## 使用方式

这份文档给“下一轮修复实现”使用，不是再次审查的起点。  
默认原则：

- 先修真实断点和契约问题，再修体验和结构问题。
- 按批次推进，不并行乱改。
- 每修完一个 issue，必须跑最小相关验证，再更新 `review/fix-backlog.csv`。
- 不做与 issue 无关的大重构，不顺手改 UI 风格。

## 固定约束

- 保持现有技术栈：React 19 + Zustand + Tauri 2 + Rust + Python。
- 优先复用现有 IPC、store、worker 结构，不引入新的后端服务。
- 允许新增小型 store / bridge 组件 / helper，但不要重做整体架构。
- 所有修复完成后，至少保证：
  - `npm run build` 通过
  - `cargo test --manifest-path src-tauri/Cargo.toml` 全绿
  - 触及 Python 翻译链路时 `python3 -m compileall antigravity_translate rastro_translation_engine` 通过

## 修复顺序

### Batch A：AI 流稳定性与边界

先做这批，因为它会影响聊天和总结两条链路。

- `AG-005` 把 AI 流事件监听从面板组件生命周期里拿出来，做成稳定桥接层。
- `AG-006` 限制 `session_id` 只能用于当前 `document_id`。
- `AG-008` 修复 SSE EOF 时残余 buffer 丢失。
- `AG-009` 让 Rust 测试重新全绿，禁止忽略或跳过失败用例。

### Batch B：文献总结链路

- `AG-001` 接通 SummaryPanel 参数与真实文档内容输入，不允许继续只把文件路径交给远端模型。

### Batch C：翻译链路契约与取消

- `AG-003` 修复翻译状态跟踪、前后端阶段值漂移、译文 URL 没进入渲染路径的问题。
- `AG-004` 让运行中的翻译任务可以真正取消。
- `AG-007` 去掉 Python 翻译配置里的危险默认值。

### Batch D：NotebookLM 功能诚实化

- `AG-002` 当前版本不要继续保留“伪完成”的假功能；要么实现真实集成，要么明确降级为外链/WIP。
- 本轮默认选择：先做“诚实化降级”，不在本轮实现真实 webview 自动化。

## Issue 规格

### AG-005 AI 流事件桥接不稳定

**目标**  
聊天和总结都依赖 `ai://stream-*` 事件，但当前监听写在 `ChatPanel` / `SummaryPanel` 组件里，切 tab、关闭右侧面板、切文档时会丢事件或让旧流污染新上下文。要把监听放到稳定生命周期里。

**主文件**

- `src/components/chat-panel/ChatPanel.tsx`
- `src/components/summary/SummaryPanel.tsx`
- `src/components/panel/RightPanel.tsx`
- `src/layouts/AppLayout.tsx`
- `src/stores/useChatStore.ts`

**实施决策**

- 新增一个稳定挂载的桥接层，例如 `AiStreamBridge`，放在 `AppLayout` 内，整个应用生命周期只注册一次 `ipcEvents.onAiStreamChunk / Finished / Failed`。
- 聊天与总结不要再自己直接 `listen`。
- 为总结新增独立 store，避免 Summary 状态跟随组件卸载而丢失。
- 切换文档时，如果 `useChatStore.activeStreamId` 存在，先调用 `ipcClient.cancelAiStream()`，再清空聊天状态。
- 关闭右侧面板或切换 tab 不应中断事件消费；中断只能由显式取消触发。

**验收条件**

- 聊天生成过程中切换到“设置”或“总结”tab，再切回来，流还能正常结束。
- 总结生成过程中切换 tab，不会丢 chunk 或卡死在 loading。
- 切文档时旧流被取消，旧文档的增量不会写进新文档 UI。

**实现备注（2026-03-13）**

- 已新增稳定挂载的 `AiStreamBridge`，放在 `AppLayout` 中统一注册 `ai://stream-*` 监听，右侧面板卸载不再影响流消费。
- 已新增 `useSummaryStore`，把总结内容、生成中状态、活跃 `streamId` 从 `SummaryPanel` 组件本地状态迁出。
- 桥接层增加了短暂 pending 队列，避免 `streamId` 刚返回前的早到事件被直接丢弃；文档切换时会先发起取消，再清空 chat / summary 状态。
- AG-005 最小验证已完成：`npm run build` 通过。

### AG-006 聊天会话可以跨文档复用

**目标**  
后端当前只检查 `session_id` 是否存在，没有检查它是否属于当前 `document_id`。这会把新文档消息写入旧文档会话。

**主文件**

- `src-tauri/src/ai_integration/chat_service.rs`

**实施决策**

- 在 `start_chat()` 中，当 `input.session_id` 存在时：
  - 如果 session 不存在，继续返回当前错误。
  - 如果 session 存在但 `existing.document_id != input.document_id`，返回 `AppErrorCode::DocumentNotFound`，消息明确为“聊天会话不属于当前文档”。
- 为“会话属于别的文档”补 Rust 单元测试。

**验收条件**

- 同一文档可继续复用已有 session。
- 不同文档传入旧 session 会失败，不会写入错误会话。

**实现备注（2026-03-13）**

- `start_chat()` 现在会在复用已有 `session_id` 前校验 `existing.document_id == input.document_id`。
- 已新增 Rust 用例 `start_chat_rejects_session_from_another_document`，确认跨文档复用返回 `DocumentNotFound`，且旧会话没有被写入用户消息。
- AG-006 最小验证已完成：`cargo test --manifest-path src-tauri/Cargo.toml start_chat_rejects_session_from_another_document -- --nocapture` 通过。

### AG-008 SSE EOF 丢最后一个分片

**目标**  
SSE 解析循环只在遇到 `\n` 时处理 `buffer`，EOF 时如果最后一条 `data:` 没有换行会被静默丢弃。

**主文件**

- `src-tauri/src/ai_integration/chat_service.rs`

**实施决策**

- 把“处理一行 SSE data”提取为独立 helper。
- 在 `None` 分支结束前，先尝试消费 `buffer` 中剩余的最后一条 `data:` 记录，再执行 `finalize_stream_outcome()`。
- 保持 `[DONE]`、thinking、usage 逻辑不变。

**验收条件**

- 为“无尾换行的最后一个 data 块”新增测试并通过。
- 空流、正常流、兼容网关流三个路径都还能通过现有测试。

**实现备注（2026-03-13）**

- 已把单条 `data:` SSE 记录的解析抽到 `process_sse_data_line()`，复用现有 `[DONE]`、thinking、usage 处理逻辑。
- 在 `bytes_stream` EOF 分支里会先尝试消费 `buffer` 中残留的最后一条记录，再进入 `finalize_stream_outcome()`。
- 已新增 `run_stream_request_consumes_last_sse_payload_without_trailing_newline` 用例，并把 OpenAI mock 路由补齐到 `/v1/chat/completions`，避免测试与真实请求路径漂移。
- AG-008 最小验证已完成：`cargo test --manifest-path src-tauri/Cargo.toml run_stream_request_consumes_last_sse_payload_without_trailing_newline -- --nocapture` 通过。

### AG-009 Rust 测试基线恢复为全绿

**目标**  
当前 `cargo test --manifest-path src-tauri/Cargo.toml` 有 1 个失败用例，不能带红交付。

**主文件**

- `src-tauri/src/ai_integration/chat_service.rs`

**实施决策**

- 先完成 `AG-008`，再重新跑目标测试：
  - `cargo test --manifest-path src-tauri/Cargo.toml run_stream_request_returns_error_when_provider_finishes_without_text -- --nocapture`
- 如果失败根因是实现没有走到 `build_empty_stream_error()`，修实现。
- 如果失败根因只是断言写得过脆，允许把断言调整为“错误码 + payloadCount + 稳定中文关键词”，但不允许简单删除断言。

**验收条件**

- 目标测试通过。
- 全量 `cargo test --manifest-path src-tauri/Cargo.toml` 通过。

**实现备注（2026-03-13）**

- `run_stream_request_returns_error_when_provider_finishes_without_text` 已恢复为绿色，用例继续断言稳定契约字段：错误码、中文错误关键词、`payloadCount`。
- 同步修正了 OpenAI mock server 的 `/v1/chat/completions` 路由，避免测试环境与运行时请求路径不一致。
- Batch A 统一验证已完成：`cargo test --manifest-path src-tauri/Cargo.toml` 全绿（52 passed, 0 failed）。

### AG-001 文献总结链路未接通真实内容

**目标**  
SummaryPanel 当前没有拿到 `documentId/filePath`，即使接通后，后端 prompt 也只把“文件路径”发给模型。要让总结功能真正基于文档内容工作。

**主文件**

- `src/components/panel/RightPanel.tsx`
- `src/components/summary/SummaryPanel.tsx`
- `src/shared/types.ts`
- `src/lib/ipc-client.ts`
- `src-tauri/src/ipc/ai.rs`
- `src-tauri/src/ai_integration/mod.rs`
- `src-tauri/src/ai_integration/chat_service.rs`

**实施决策**

- `SummaryPanel` 改为直接从 `useDocumentStore` 读取当前文档，不再依赖父组件 props 注入。
- 前端在发起 `generateSummary` 前，使用 `pdfjs-dist` 对当前 PDF 做文本提取：
  - 默认提取前 20 页；
  - 提取后做简单拼接与清洗；
  - 总字符数截断到 40,000 字符以内，避免 prompt 失控。
- 扩展 `GenerateSummaryInput` / `GenerateSummaryRequest`，新增 `sourceText: string` 字段。
- 后端 `build_summary_prompt()` 改为基于 `sourceText + filePath + promptProfile` 组织 prompt，不再宣称“直接读取正文”。
- 如果前端提取不到任何文本，SummaryPanel 要显示明确错误，不允许继续发送只有路径的空摘要请求。
- 该实现依赖 `AG-005`，总结流状态应使用独立 store 承接。

**验收条件**

- 打开 PDF 后，“生成总结”可正常启动。
- Rust 端收到 `sourceText`，prompt 中包含文本摘录而不是只含文件路径。
- 总结内容明显来自论文正文，不是“基于文件名给阅读提纲”。

**实现备注（2026-03-13）**

- `SummaryPanel` 已直接读取 `useDocumentStore.currentDocument`，不再依赖父组件 props 注入。
- 前端新增 `extractPdfText()`，默认提取前 20 页并截断到 40,000 字符；提取不到正文时会在 UI 中给出明确错误，不再发送只有文件路径的空请求。
- `GenerateSummaryInput` / `GenerateSummaryRequest` 已新增 `sourceText`，后端 `build_summary_prompt()` 现在明确基于“PDF 正文摘录 + 文件路径 + prompt profile”组装请求。
- 生成期间如果用户切换文档，SummaryPanel 会放弃旧文档摘要请求；如果流句柄已返回，会主动取消旧流。
- AG-001 指定验证已完成：`npm run build` 通过。

### AG-003 翻译状态与视图切换未打通

**目标**  
当前翻译链路有四个断点：前端未订阅真实进度、后端未发事件、Python stage 值与 TS 契约不一致、`translatedPdfUrl` 根本没有进入 PdfViewer 渲染路径。

**主文件**

- `src/components/pdf-viewer/PdfViewer.tsx`
- `src/components/pdf-viewer/TranslationSwitch.tsx`
- `src/stores/useDocumentStore.ts`
- `src/shared/types.ts`
- `rastro_translation_engine/worker.py`

**实施决策**

- 本轮不补 Tauri 翻译事件，直接改前端为轮询方案：
  - `requestTranslation` 成功后启动 polling，每 1 秒调用 `ipcClient.getTranslationJob(jobId)`；
  - 任务到终态后停止轮询。
- 轮询时持续更新 `translationJob`、`translationProgress`。
- 当任务完成且有 `translatedPdfPath/bilingualPdfPath` 时，写入 `translatedPdfUrl`。
- `PdfViewer` 必须根据 `translatedPdfUrl` 与 `bilingualMode` 决定当前展示的 URL：
  - 默认展示译文；
  - 按住 Option/Alt 时回到原文；
  - 没有译文时继续展示原文。
- Python worker 的 `stage` 值统一改成前端契约里的值：
  - `queued`
  - `preflight`
  - `extracting`
  - `translating`
  - `postprocessing`
  - `completed`
  - `failed`
  - `cancelled`

**验收条件**

- 提交翻译后 UI 进度会持续变化，不会永远停在初始值。
- 完成后 `TranslationSwitch` 提示出现，且视图真的能切到译文。
- 前端不会再收到契约外的 `stage` 字符串。

**实现备注（2026-03-13）**

- 前端已改成轮询本地 `getTranslationJob(jobId)`：提交任务后每 1 秒同步 `translationJob` 与 `translationProgress`，直到终态为止。
- `useDocumentStore.setCurrentDocument()` 现在会重置旧文档的翻译状态；`PdfViewer` 会根据缓存翻译或任务结果写入 `translatedPdfUrl`，并按“默认译文 / 按住 Option 回原文”的规则切换实际渲染 URL。
- `TranslationSwitch` 现在会同时显示 `queued` 和 `running` 状态；`translationProgress` 统一转成 0-100 百分比。
- Python worker 的阶段值已收敛为 `queued / preflight / extracting / translating / postprocessing / completed / failed / cancelled`，并去掉了 `preprocessing` / `completing` 这类契约外字符串。
- AG-003 最小验证已完成：`npm run build` 与 `python3 -m compileall rastro_translation_engine` 通过。

### AG-004 运行中的翻译任务无法真正取消

**目标**  
当前运行中任务只能“标记取消”，底层翻译仍继续跑完。

**主文件**

- `rastro_translation_engine/worker.py`
- `antigravity_translate/core.py`

**实施决策**

- `antigravity_translate.core.translate()` 改为支持取消：
  - 用 `subprocess.Popen` 替代 `subprocess.run`；
  - 循环轮询子进程状态；
  - 接收 `cancel_event` 或等价回调；
  - 取消时终止子进程并清理临时文件。
- `TranslationWorker._execute_job()` 在调用翻译核心时传入 `job._cancel_event`。
- 一旦取消生效，任务状态必须更新为：
  - `status = CANCELLED`
  - `stage = "cancelled"`
  - `error.code = "JOB_CANCELLED"` 或直接无 error 但终态清晰一致

**验收条件**

- 运行中的翻译任务在取消后尽快停止，不再继续产生输出文件。
- 前端看到的最终状态是 `cancelled`，不是继续变成 `completed` 或 `failed`。

**实现备注（2026-03-13）**

- `antigravity_translate.core.translate()` 已新增 `cancel_event` 参数，并把底层调用从 `subprocess.run` 改为可轮询的 `subprocess.Popen`。
- 一旦检测到取消信号，会终止子进程、清理当前任务输出目录里的译文 PDF 产物，并返回 `cancelled=True`。
- `TranslationWorker._execute_job()` 现在会把 `job._cancel_event` 传给翻译核心，并把取消后的终态统一写成 `status=cancelled / stage=cancelled / error.code=JOB_CANCELLED`。
- AG-004 最小验证已完成：`python3 -m compileall antigravity_translate rastro_translation_engine` 通过。

### AG-007 Python 翻译配置含危险默认值

**目标**  
`antigravity_translate/config.py` 里有真实外部网关默认值和默认 key 样式值。新环境未配置时不应自动访问外部服务。

**主文件**

- `antigravity_translate/config.py`

**实施决策**

- 去掉所有非空危险默认值：
  - `PDF2ZH_EXE` 默认改为空字符串；
  - `CLAUDE_BASE_URL` 默认改为空字符串；
  - `CLAUDE_API_KEY` 默认改为空字符串；
  - `CLAUDE_MODEL` 可以保留一个纯模型名默认值，或与上游注入保持一致，但不能带外部 host。
- 对缺失配置的错误信息保持显式，让调用方知道是配置问题。

**验收条件**

- 全新环境未设 env 时，不会自动请求任何外部域名。
- 翻译链路缺配置时给出明确错误，而不是隐式跑到陌生网关。

**实现备注（2026-03-13）**

- `antigravity_translate/config.py` 已去掉危险默认值：`PDF2ZH_EXE` / `CLAUDE_BASE_URL` / `CLAUDE_API_KEY` 默认全部改为空字符串，`CLAUDE_MODEL` 保留纯模型名默认值。
- `translate()` 在运行前会显式检查 `pdf2zh.exe` 路径、`CLAUDE_BASE_URL`、`CLAUDE_API_KEY`、`CLAUDE_MODEL` 是否配置；缺失时直接抛出清晰错误，而不是隐式请求外部网关。
- Batch C 统一验证已完成：`npm run build` 与 `python3 -m compileall antigravity_translate rastro_translation_engine` 通过。

### AG-002 NotebookLM 当前为伪实现

**目标**  
当前 NotebookLM 面板没有真实 webview，只是状态机和 `setTimeout` 假完成。不要继续把原型当成功能展示。

**主文件**

- `src/components/notebooklm/NotebookLMView.tsx`
- `src/lib/notebooklm-automation.ts`

**实施决策**

- 本轮默认做“诚实化降级”，不实现真实自动化。
- 去掉伪成功路径：
  - 不再显示“登录成功”“生成完成”的模拟状态；
  - 不再使用 `setTimeout` 伪造生成完成。
- 面板保留两个真实能力：
  - 显示当前文档标题；
  - 提供“在外部浏览器打开 NotebookLM”按钮。
- 面板正文改为明确说明“内嵌自动化暂未实现”，避免误导用户。

**验收条件**

- 用户不会再在本地 UI 中看到假的登录/生成成功流程。
- 现有按钮行为全部真实可解释。

**实现备注（2026-03-13）**

- `NotebookLMView` 已降级为静态说明面板，只保留两项真实能力：显示当前文档标题、在外部浏览器打开 NotebookLM。
- 原先的假登录、假生成、`setTimeout` 伪完成路径已不再出现在 UI 流程中。
- `notebooklm-automation.ts` 新增了明确的不可用说明文案，前端不会再暗示“内嵌自动化已可用”。
- AG-002 / Batch D 验证已完成：`npm run build` 通过。

## 统一验证清单

### Batch A 完成后

- `cargo test --manifest-path src-tauri/Cargo.toml`

### Batch B 完成后

- `npm run build`
- 手动验证：打开 PDF -> 总结 -> 切 tab -> 回来 -> 完成

### Batch C 完成后

- `npm run build`
- `python3 -m compileall antigravity_translate rastro_translation_engine`
- 手动验证：提交翻译 -> 进度变化 -> 完成后可切换译文；再验证取消

### Batch D 完成后

- `npm run build`
- 手动验证：NotebookLM 面板不再展示伪成功路径

## 当前建议起点

从 `AG-005` 开始，不要先碰 NotebookLM。  
理由：Summary 与 Chat 都依赖 AI 流；如果不先稳定事件桥接，后面修 Summary 还会重复返工。
