[根目录](../CLAUDE.md) > **src-tauri (Rust 后端)**

# src-tauri - Rust 后端模块

## 模块职责

Tauri 2 桌面应用后端，提供 25 个 IPC Command 和 6 个 Event，管理 SQLite 数据库、macOS Keychain 凭据、翻译引擎进程、Zotero 数据库只读集成、AI Provider（OpenAI/Claude/Gemini）流式问答与总结。

## 入口与启动

- **入口文件**：`src-tauri/src/main.rs`
- **Tauri Builder** 注册 25 个 Command（分 A-G 七组），`.setup()` 中初始化 `AppState`
- **AppState** (`app_state.rs`)：全局单例，持有 `Storage`、`KeychainService`、`AiIntegration`、`TranslationManager`、`TranslationEngineStatus`（Arc<Mutex>）、`ZoteroStatus`（Arc<Mutex>）

## 对外接口

### IPC Command (25 个)

| 分组 | 数量 | Command | 文件 |
|------|------|---------|------|
| A. 文档与应用状态 | 4 | `get_backend_health`, `open_document`, `list_recent_documents`, `get_document_snapshot` | `ipc/document.rs` |
| B. 翻译引擎生命周期 | 3 | `ensure_translation_engine`, `shutdown_translation_engine`, `get_translation_engine_status` | `ipc/translation.rs` |
| C. 翻译任务 | 4 | `request_translation`, `get_translation_job`, `cancel_translation`, `load_cached_translation` | `ipc/translation.rs` |
| D. AI 问答与总结 | 5 | `ask_ai`, `cancel_ai_stream`, `generate_summary`, `list_chat_sessions`, `get_chat_messages` | `ipc/ai.rs` |
| E. Provider 配置 | 7 | `list_provider_configs`, `save_provider_key`, `remove_provider_key`, `set_active_provider`, `test_provider_connection`, `update_provider_config`, `fetch_available_models` | `ipc/settings.rs` |
| F. 使用统计 | 1 | `get_usage_stats` | `ipc/settings.rs` |
| G. Zotero 集成 | 3 | `detect_zotero_library`, `fetch_zotero_items`, `open_zotero_attachment` | `ipc/zotero.rs` |

### Tauri Event (6 个)

| Event | Payload |
|-------|---------|
| `translation://job-progress` | `TranslationJobDto` |
| `translation://job-completed` | `TranslationJobDto` |
| `translation://job-failed` | `{ jobId, error }` |
| `ai://stream-chunk` | `{ streamId, delta }` |
| `ai://stream-finished` | `{ streamId, sessionId, messageId }` |
| `ai://stream-failed` | `{ streamId, error }` |

## 关键依赖与配置

| crate | 版本 | 用途 |
|-------|------|------|
| tauri | 2 | 桌面应用框架 |
| rusqlite | 0.37 (bundled) | SQLite 数据库 |
| reqwest | 0.12 (rustls-tls) | HTTP 客户端（AI API + 翻译引擎） |
| tokio | 1 (full) | 异步运行时 |
| serde / serde_json | 1 | JSON 序列化 |
| chrono | 0.4 | 时间处理 |
| sha2 | 0.10 | 文档哈希计算 |
| uuid | 1 (v4) | 唯一 ID 生成 |
| parking_lot | 0.12 | 高性能互斥锁 |
| security-framework | 3 (macOS) | Keychain 读写 |

## 数据模型

### SQLite Schema (7 张表)

```
documents           -- 文档元数据（SHA256 去重）
chat_sessions       -- 聊天会话（关联 document）
chat_messages       -- 聊天消息（关联 session）
translation_jobs    -- 翻译任务（状态机：queued->running->completed/failed/cancelled）
translation_artifacts -- 翻译产物（translated_pdf/bilingual_pdf/figure_report/manifest）
usage_events        -- 使用统计（按 provider/feature 维度）
provider_settings   -- Provider 配置（3 个预置行：openai/claude/gemini）
```

### 领域枚举 (`models.rs`)

`ProviderId`(openai/claude/gemini)、`DocumentSourceType`(local/zotero)、`ChatRole`(user/assistant/system)、`TranslationJobStatus`(5 种)、`TranslationStage`(9 种)、`ArtifactKind`(4 种)、`SummaryPromptProfile`(default/paper-review)、`UsageFeature`(chat/summary/translation)

### 错误模型 (`errors.rs`)

`AppError` + `AppErrorCode`（19 个），与 TypeScript `AppError` 一一对应。实现了 `From<rusqlite::Error>`、`From<io::Error>`、`From<reqwest::Error>` 自动转换。

## 子模块说明

### `storage/` -- SQLite 持久层
- `Storage` 结构体：`Arc<Mutex<Connection>>` 包装，提供 `connection()` 和 `healthcheck()`
- 每张表对应一个子模块（`documents.rs`, `chat_sessions.rs`, `chat_messages.rs`, `translation_jobs.rs`, `translation_artifacts.rs`, `usage_events.rs`, `provider_settings.rs`）
- `migrations.rs`：执行 `001_init.sql`

### `ai_integration/` -- AI Provider 集成

**核心结构**：`AiIntegration` 单例，持有 reqwest Client（10s connect / 60s timeout）、Storage、KeychainService、StreamRegistry（`Arc<Mutex<HashMap<StreamId, CancellationToken>>>`）

**流式问答架构** (`chat_service.rs`, 536 行)：
- `start_chat()` → 立即返回 `StreamHandleResult`，实际流式处理在 `tokio::spawn` 后台任务中执行
- `run_stream_request()` 核心循环：`tokio::select!` 同时监听 CancellationToken 和 SSE bytes_stream
- SSE 行缓冲解析：处理 `data: {...}` JSON，识别 `[DONE]` 标记
- Tauri 事件反馈：`ai://stream-chunk`（增量）、`ai://stream-finished`（完成）、`ai://stream-failed`（失败）
- 取消语义：静默取消，不发送失败事件；用户消息已预先插入数据库，取消后不回滚

**Provider 路由** (`provider_registry.rs`, 356 行)：
- `resolve_runtime_config()`：DB 查询 active provider → Keychain 获取 API Key → 本地开发模式 `http://127.0.0.1:*` 使用 dummy key
- 三个 Provider 的请求构建差异：
  - OpenAI: `/v1/chat/completions`, Bearer token, `stream_options: {include_usage}`
  - Claude: `/v1/messages`, `x-api-key` header, `max_tokens: 2048`
  - Gemini: `/v1beta/models/{model}:streamGenerateContent`, URL param `?key=...`
- HTTP 错误映射：429 → `ProviderRateLimited`(retryable)、402 → `ProviderInsufficientCredit`、其他 4xx/5xx → `ProviderConnectionFailed`

**总结服务** (`summary_service.rs`, 15 行)：薄封装，委托给 `chat_service::start_summary_flow()`，始终创建新会话

**使用量计量** (`usage_meter.rs`, 104 行)：优先使用 Provider 返回的 token 计数，回退到文本估算（4字符 ≈ 1 token）

**设计决策**：
- 无 trait 抽象，使用 `match provider` 显式分支（仅 3 个 Provider，清晰可审计）
- 60s 全局超时（适用于整个流式响应，非 per-chunk，长摘要可能超时）
- 用户消息在流式开始前预插入（UX 优先，但取消后可能留下无回复的消息）

### `translation_manager/` -- 翻译管理

**核心结构**：`TranslationManager`（Arc 可克隆），协调翻译任务全生命周期

**引擎监管** (`engine_supervisor.rs`, 815 行)：
- **子进程管理**：`python -m rastro_translation_engine`，启动前校验 Python ≥3.12 及所需模块
- **健康检查**：每 500ms 轮询 `/healthz`，启动超时 15s
- **关闭流程**：SIGTERM → 等待 5s → 可选 SIGKILL
- **熔断器** (Circuit Breaker)：
  - 5 分钟窗口内累计 3 次失败 → 熔断打开
  - 退避序列：30s → 60s → 180s
  - 冷却期过后自动半开，允许重试
  - `reap_exited_child()` 检测异常退出并记录失败
- **环境变量**：`RASTRO_ENGINE_HOST`(127.0.0.1)、`RASTRO_ENGINE_PORT`(8890)、`RASTRO_ENGINE_PYTHON`(检测 .venv 或 python3)

**HTTP 客户端** (`http_client.rs`, 388 行)：
- 端点：`GET /healthz`、`POST /v1/jobs`、`GET /v1/jobs/{id}`、`DELETE /v1/jobs/{id}`、`POST /control/shutdown`
- 错误映射：`ENGINE_BUSY` → `EngineUnavailable`、`PROVIDER_AUTH_MISSING` → `ProviderKeyMissing`、`TRANSLATION_TIMEOUT` → `EngineTimeout`、连接超时/拒绝 → retryable

**任务队列** (`job_registry.rs`, 230 行)：
- 内存队列，最大深度 `MAX_QUEUED_JOBS = 3`
- 单 Worker 模式：`try_mark_worker_running()` 防止并发调度
- cache_key → job_id 映射，支持重复请求检测
- 状态：register → dequeue → active → finish/cancel

**翻译请求流程** (`mod.rs`, 730 行)：
1. `prepare_request()`：验证文件路径 → 获取 Provider 配置 + API Key → 计算 cache_key（SHA256）
2. 缓存检查：相同 cache_key 的已完成任务 → 直接返回；同 cache_key 在途任务 → 返回进行中
3. `ensure_engine()` → 启动 Python 子进程（尊重熔断器，`force=true` 可跳过）
4. DB 创建 job (status: queued) → 注册到队列 → 触发 `dispatch_loop()`
5. **调度循环**：逐个出队 → `process_job()` → 提交到引擎 → 每 1s 轮询状态 → 完成后持久化产物

**产物索引** (`artifact_index.rs`, 399 行)：
- cache_key = SHA256(doc_sha256 + provider + model + langs + modes + flags)
- 产物类型：`translated_pdf`、`bilingual_pdf`、`figure_report`、`manifest`
- 产物目录：`cache_root/translations/{doc_sha}/{cache_key}/`
- 验证：产物路径必须为绝对路径且文件存在

**缓存淘汰** (`cache_eviction.rs`, 387 行)：
- LRU 策略，限额 500MB
- 排序依据：document.last_opened_at（最旧优先）→ job.finished_at
- 当前正在完成的 job 受保护，不被淘汰
- 触发时机：每次翻译任务完成后

**关键常量**：
| 常量 | 值 | 说明 |
|------|---|------|
| `DEFAULT_ENGINE_PORT` | 8890 | 引擎监听端口 |
| `DEFAULT_TIMEOUT_SECONDS` | 1800 | 翻译超时（30分钟）|
| `STARTUP_TIMEOUT` | 15s | 引擎启动超时 |
| `CIRCUIT_WINDOW` | 5min | 熔断器失败窗口 |
| `BACKOFF_SEQUENCE` | [30s, 60s, 180s] | 熔断退避序列 |
| `MAX_QUEUED_JOBS` | 3 | 队列深度限制 |
| `MAX_CACHE_SIZE_BYTES` | 500MB | LRU 缓存限额 |

### `zotero_connector/` -- Zotero 集成
- `ZoteroConnector`：只读连接 Zotero SQLite 数据库
- 支持 `storage:`、`file://`、`attachments:` 三种路径格式
- 自动探测 macOS 上的 Zotero 数据库位置

### `keychain/` -- macOS Keychain
- `KeychainService`：基于 `security-framework` 的 API Key 安全存储
- 服务名：`com.rastro.ai`，账户格式：`provider:{provider_id}`

## 测试与质量

现有测试（全部在 `src-tauri/src/` 内，`#[cfg(test)]` 模块）：

| 文件 | 测试内容 |
|------|---------|
| `errors.rs` | 19 个错误码序列化一致性、camelCase 字段名、details 可选序列化 |
| `storage/mod.rs` | 全表 CRUD 回归（in-memory SQLite） |
| `ipc/document.rs` | `open_document` Command 错误路径（文件不存在、非 PDF） |
| `ipc/translation.rs` | `request_translation` Command 错误路径（文件不存在） |
| `ipc/zotero.rs` | `fetch_zotero_items` Command 在 Zotero 缺失时的错误码 |
| `zotero_connector/mod.rs` | 年份解析、路径解析、完整 DB fixture 集成测试、DB locked 错误映射 |
| `translation_manager/mod.rs` | `normalize_output_mode` 值标准化 |
| `translation_manager/engine_supervisor.rs` | Python 版本校验(≥3.12)、健康签名验证、端口冲突检测、熔断器阻塞、Python 缺失/版本不匹配/模块缺失错误 |
| `translation_manager/http_client.rs` | 错误码映射(6 分支)、HTTP 408 → EngineTimeout、引擎错误信封解析 |
| `translation_manager/artifact_index.rs` | cache_key 随 model 变化、进度归一化(0-100% → 0.0-1.0)、缓存损坏检测、产物路径验证 |
| `translation_manager/cache_eviction.rs` | 最旧任务优先淘汰、受保护 job 不被淘汰、淘汰后 job 记录删除 |
| `translation_manager/job_registry.rs` | cache_key 映射清理、活跃任务跟踪、Worker running flag、取消标记传播 |
| `ai_integration/chat_service.rs` | mock Provider 流式写入 usage_event（存在竞态风险：测试未等待 spawned task 完成）|
| `keychain/mod.rs` | `mask_key` 脱敏函数 |

```bash
cd src-tauri && cargo test
```

## 常见问题 (FAQ)

**Q: 为什么所有 IPC DTO 都用 `#[serde(rename_all = "camelCase")]`？**
A: 保持与 TypeScript 前端 JSON 字段名一致，避免手动映射。

**Q: API Key 存在哪里？**
A: macOS Keychain，通过 `security-framework` crate 访问。非 macOS 平台无法存储。

**Q: 翻译引擎如何启动？**
A: Rust 端通过 `EngineSupervisor` 以子进程方式启动 `python -m rastro_translation_engine`，监听 127.0.0.1:8890。

**Q: 数据库文件在哪？**
A: `~/Library/Application Support/com.rastro.app/app.db`（macOS）。

## 相关文件清单

- `src-tauri/src/main.rs` -- 入口，注册 25 个 Command
- `src-tauri/src/app_state.rs` -- 全局状态初始化
- `src-tauri/src/errors.rs` -- 统一错误模型（19 个错误码）
- `src-tauri/src/models.rs` -- 领域枚举
- `src-tauri/src/ipc/` -- IPC Command 层（5 个文件）
- `src-tauri/src/storage/` -- SQLite 持久层（10 个文件）
- `src-tauri/src/ai_integration/` -- AI 集成（5 个文件）
- `src-tauri/src/translation_manager/` -- 翻译管理（6 个文件）
- `src-tauri/src/zotero_connector/mod.rs` -- Zotero 集成
- `src-tauri/src/keychain/mod.rs` -- Keychain 服务
- `src-tauri/Cargo.toml` -- Rust 依赖
- `src-tauri/tauri.conf.json` -- Tauri 配置
- `src-tauri/capabilities/default.json` -- 权限配置
- `src-tauri/migrations/001_init.sql` -- 数据库初始化 SQL
- `src-tauri/build.rs` -- 构建脚本

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-03-12 | 初始化 | 首次扫描生成 |
| 2026-03-12 | 补扫 | 深度扫描 ai_integration/ 和 translation_manager/ 全部子模块 |
