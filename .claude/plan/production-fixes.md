# 生产修复计划 v2 — Rastro 代码审查问题修复

> 基于 Codex（后端）+ Gemini（前端）双模型交叉审查结果，整合双方架构建议
> 共 3 Critical + 9 Warning + 8 Info

---

## 任务类型
- [x] 前端 (→ Gemini)
- [x] 后端 (→ Codex)
- [x] 全栈 (→ 并行)

## 修复顺序策略

> **Codex 建议采纳**：先固定错误码语义基线（I2），再做安全修复——因为 C1/C2 需要使用新增的错误码。

```
阶段 0: 错误码语义基线 (I2, I1)      — 为后续修复建立正确的错误码体系
阶段 1: 安全修复 (C1, C2)            — 最高优先级，阻止潜在攻击
阶段 2: 核心架构重构 (C3, W7, I5)    — 前端流式架构一次性重构
阶段 3: 可靠性修复 (W1-W6, W8)       — 错误处理、性能、数据库
阶段 4: 代码质量 (W9, I3, I4, I6-I8) — 可访问性、一致性、测试
```

---

## 阶段 0：错误码语义基线 [Info → 前置依赖]

### Fix 0.1 — I2: 新增精确错误码

**问题**：错误码语义复用混乱（`ProviderKeyMissing` 用于配置缺失，`DocumentNotFound` 用于会话缺失）

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/errors.rs` | 修改 | 新增 `InvalidProviderBaseUrl`、`ResourceOwnershipMismatch`、`ProviderNotConfigured`、`ChatSessionNotFound` |
| `src/shared/types.ts` | 修改 | 同步新增对应的 `AppErrorCode` 值 |
| `src-tauri/src/ai_integration/provider_registry.rs` | 修改 | 缺失配置改用 `ProviderNotConfigured` |
| `src-tauri/src/ai_integration/chat_service.rs` | 修改 | 缺失会话改用 `ChatSessionNotFound` |
| `src-tauri/src/translation_manager/mod.rs` | 修改 | 缺失翻译任务改用精确码 |

**伪代码**：

```rust
// errors.rs — 新增错误码
pub enum AppErrorCode {
    // ... 现有 19 个 ...
    InvalidProviderBaseUrl,      // C1 使用：base_url 域名非法
    ResourceOwnershipMismatch,   // C2 使用：document_id 和 file_path 不对应
    ProviderNotConfigured,       // 替代原 ProviderKeyMissing 的配置缺失场景
    ChatSessionNotFound,         // 替代原 DocumentNotFound 的会话缺失场景
}
```

```typescript
// src/shared/types.ts — 同步新增
export type AppErrorCode =
  | 'INVALID_PROVIDER_BASE_URL'
  | 'RESOURCE_OWNERSHIP_MISMATCH'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'CHAT_SESSION_NOT_FOUND'
  // ... 现有值 ...
```

**测试策略**：
- 扩展错误码序列化对齐测试，确认新增码前后端一致
- 补 IPC 序列化断言

**复杂度**：M | **风险**：中（前后端契约变更，需同步）

---

### Fix 0.2 — I1: 错误码持久化格式修复

**问题**：`fail_job()` 用 `format!("{:?}", error.code).to_uppercase()` 得到 `ENGINEUNAVAILABLE` 而非 `ENGINE_UNAVAILABLE`

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/errors.rs` | 修改 | 新增 `as_contract_str()` 方法 |
| `src-tauri/src/translation_manager/mod.rs:704` | 修改 | 使用新方法持久化 |

**伪代码**：

```rust
// errors.rs — 新增稳定字符串转换
impl AppErrorCode {
    pub fn as_contract_str(&self) -> &'static str {
        // 使用 serde 序列化得到的字面量，保证与前端契约一致
        match self {
            Self::EngineUnavailable => "ENGINE_UNAVAILABLE",
            Self::ProviderConnectionFailed => "PROVIDER_CONNECTION_FAILED",
            // ... 所有枚举值
        }
    }
}

// translation_manager/mod.rs
// Before: format!("{:?}", error.code).to_uppercase()
// After:  error.code.as_contract_str().to_string()
```

**复杂度**：S | **风险**：低

---

## 阶段 1：安全修复 [Critical]

### Fix 1.1 — C1: API Key 泄露防护（base_url 白名单 + 双重校验）

**问题**：前端可设置任意 `base_url`，后端会把 Keychain 中的 API Key 发往该地址

> **Codex 建议采纳**：不仅在写入时校验，读取时（`resolve_runtime_config`）也要再次校验，防止历史脏数据；localhost 仅在开发模式或 `cfg(test)` 下放行。

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/ai_integration/provider_registry.rs` | 修改 | 新增 `validate_base_url()` 函数 |
| `src-tauri/src/ipc/settings.rs:194` | 修改 | `update_provider_config` 写入前校验 |
| `src-tauri/src/ipc/settings.rs:280` | 修改 | `fetch_available_models` 读取后再次校验（防脏数据） |
| `src-tauri/src/ai_integration/provider_registry.rs:79` | 修改 | `resolve_runtime_config` 读取后校验 |

**伪代码**：

```rust
// provider_registry.rs — 新增
const ALLOWED_DOMAINS: &[&str] = &[
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
];

pub fn validate_base_url(provider: ProviderId, url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::new(AppErrorCode::InvalidProviderBaseUrl, "无效的 URL 格式", false))?;

    let host = parsed.host_str().unwrap_or("");
    let is_local = host == "127.0.0.1" || host == "localhost";

    // 1. 必须是 HTTPS（开发模式下 localhost 例外）
    if parsed.scheme() != "https" && !is_local {
        return Err(AppError::new(
            AppErrorCode::InvalidProviderBaseUrl,
            "自定义 base_url 必须使用 HTTPS 协议",
            false,
        ));
    }

    // 2. localhost 仅在 debug 模式放行
    #[cfg(not(debug_assertions))]
    if is_local {
        return Err(AppError::new(
            AppErrorCode::InvalidProviderBaseUrl,
            "生产环境不允许使用 localhost 作为 API 地址",
            false,
        ));
    }

    // 3. 域名白名单
    if !is_local && !ALLOWED_DOMAINS.iter().any(|d| host.ends_with(d)) {
        return Err(AppError::new(
            AppErrorCode::InvalidProviderBaseUrl,
            format!("不支持的 API 域名: {}。仅允许官方 API 域名或 localhost", host),
            false,
        ));
    }

    // 4. 禁止 URL 中包含 userinfo（防凭据注入）
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(AppError::new(
            AppErrorCode::InvalidProviderBaseUrl,
            "base_url 不允许包含用户名或密码",
            false,
        ));
    }

    Ok(())
}

// ipc/settings.rs — 写入时校验
pub fn update_provider_config(...) -> Result<...> {
    if let Some(ref url) = base_url {
        crate::ai_integration::provider_registry::validate_base_url(provider, url)?;
    }
    // ... 现有逻辑
}

// ipc/settings.rs — fetch_available_models 读取后再次校验
pub async fn fetch_available_models(...) -> Result<...> {
    let base_url = record.base_url.map(|v| normalize_base_url(provider, &v))
        .unwrap_or_else(|| default_base_url(provider).to_string());
    // 读取后再次校验（防止历史脏数据）
    validate_base_url(provider, &base_url)?;
    // 校验通过后再取 key
    let api_key = state.keychain.get_key(provider.as_str())?;
    // ...
}

// provider_registry.rs — resolve_runtime_config 同样增加校验
```

**测试策略**：
- 单元测试 `validate_base_url`：官方域名通过、恶意域名拒绝、HTTP 拒绝、IP literal、带 userinfo 的 URL、localhost（debug vs release）
- 命令级测试：非法 URL 在保存阶段被拒；历史脏数据在运行阶段也会被拦截且不发出请求

**复杂度**：M | **风险**：低（新增验证，不改已有逻辑）

---

### Fix 1.2 — C2: 翻译产物归属校验（彻底不信任前端路径）

**问题**：`prepare_request()` 不校验 `file_path` 与 `document_id` 的对应关系

> **Codex 建议采纳**：校验后一律使用 `document.file_path` 作为真实路径，彻底不信任 `input.file_path`。

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/translation_manager/mod.rs:306-330` | 修改 | 校验路径 + 使用 DB 记录路径 |

**伪代码**：

```rust
fn prepare_request(&self, input: RequestTranslationInput) -> Result<PendingTranslationRequest, AppError> {
    // 1. 先查文档记录
    let document = {
        let connection = self.inner.storage.connection();
        documents::get_by_id(&connection, &input.document_id)?
    }.ok_or_else(|| AppError::new(
        AppErrorCode::DocumentNotFound,
        "未找到对应文档记录",
        false,
    ))?;

    // 2. 校验路径一致性
    let canonical_input = std::fs::canonicalize(&input.file_path)
        .map_err(|_| AppError::new(AppErrorCode::DocumentNotFound, "无法解析文件路径", false))?;
    let canonical_doc = std::fs::canonicalize(&document.file_path)
        .map_err(|_| AppError::new(AppErrorCode::DocumentNotFound, "文档记录的路径已失效，请重新打开文档", false))?;

    if canonical_input != canonical_doc {
        return Err(AppError::new(
            AppErrorCode::ResourceOwnershipMismatch,
            "file_path 与 document_id 对应的文件路径不一致",
            false,
        ));
    }

    // 3. 后续一律使用 document.file_path，不再信任 input.file_path
    let trusted_file_path = document.file_path.clone();

    // ... 继续现有逻辑，用 trusted_file_path 替代 input.file_path ...
}
```

**测试策略**：
- `document_id=A + file_path=B` → `ResourceOwnershipMismatch`
- 符号链接指向同一文件 → 通过
- 文档记录路径失效 → 明确错误提示

**复杂度**：S | **风险**：低

---

## 阶段 2：前端核心架构重构 [Critical + Warning]

### Fix 2.1 — W7 + I5: useChatStore 状态规范化

**问题**：消息数组低效更新 + isStreaming 冗余状态

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/useChatStore.ts` | 修改 | 消息改为 Record + 移除 isStreaming |
| `src/stores/useDocumentStore.ts` | 修改 | 移除冗余 translationProgress |
| `src/components/chat-panel/ChatPanel.tsx` | 修改 | 适配新数据结构 |
| `src/components/chat-panel/ChatMessage.tsx` | 修改 | 适配新数据结构 |

**伪代码**：

```typescript
// useChatStore.ts — 新状态结构
interface ChatState {
  documentId: number | null;
  messages: Record<string, ChatMessage>;  // 原 ChatMessage[]
  messageOrder: string[];                  // 维护顺序
  activeStreamId: string | null;
  // 移除: isStreaming (从 activeStreamId 派生)
}

// 更新操作变为 O(1)
appendStreamChunk: (streamId, delta, kind) => {
  const messageId = `stream-${streamId}`;
  set(state => {
    const existing = state.messages[messageId];
    if (!existing) return {};
    return {
      messages: {
        ...state.messages,
        [messageId]: {
          ...existing,
          content: kind === 'thinking' ? existing.content : existing.content + delta,
          thinkingContent: kind === 'thinking' ? (existing.thinkingContent ?? '') + delta : existing.thinkingContent,
        }
      }
    };
  });
}

// 组件中派生
const isStreaming = useChatStore(state => !!state.activeStreamId);
const messageOrder = useChatStore(state => state.messageOrder);
const messages = useChatStore(state => state.messages);

// useDocumentStore — 移除 translationProgress
// 组件中: const progress = useDocumentStore(state => state.translationJob?.progress ?? 0);
```

**复杂度**：M | **风险**：中（需要更新所有消费 messages 的组件）

---

### Fix 2.2 — C3: 移除 AiStreamBridge，事件监听移入 Store

**问题**：AiStreamBridge 存在竞态条件、依赖项遗漏、内存泄漏

**修改文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/useChatStore.ts` | 修改 | 底部新增 Tauri 事件监听 |
| `src/stores/useSummaryStore.ts` | 修改 | 底部新增 Tauri 事件监听 |
| `src/components/ai-stream/AiStreamBridge.tsx` | **删除** | 不再需要 |
| `src/layouts/AppLayout.tsx` | 修改 | 移除 `<AiStreamBridge />` |

**伪代码**：

```typescript
// useChatStore.ts — 在 create() 之后、文件底部添加事件监听
import { ipcEvents } from '../lib/ipc-client';

// 模块级注册（应用启动时执行一次）
ipcEvents.onAiStreamChunk((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.appendStreamChunk(payload.streamId, payload.delta, payload.kind);
  }
});

ipcEvents.onAiStreamFinished((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.finishStream(payload.streamId, payload.messageId);
  }
});

ipcEvents.onAiStreamFailed((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.failStream(payload.streamId, payload.error.message);
  }
});

// useSummaryStore.ts — 同理注册 summary 相关事件
// AppLayout.tsx — 删除 <AiStreamBridge /> 引用
```

**迁移策略**：
1. 先完成 Fix 2.1（状态规范化）
2. 在两个 store 中添加事件监听
3. 删除 `AiStreamBridge.tsx` 和 `AppLayout.tsx` 中的引用
4. 端到端测试：聊天流、摘要流、文档切换中断流

**复杂度**：L | **风险**：中

---

## 阶段 3：可靠性修复 [Warning]

### Fix 3.1 — W1: 消除生产代码 expect() 调用

> **Codex 建议采纳**：`main.rs` 改为 `run_app() -> Result<()>` 模式；同时扫除 `storage/documents.rs` 和 `storage/translation_jobs.rs` 的 expect。

**修改文件**：`main.rs`, `ipc/settings.rs`, `storage/provider_settings.rs`, `provider_registry.rs`, `ai_integration/mod.rs`, `storage/documents.rs`, `storage/translation_jobs.rs`

**伪代码**：

```rust
// 通用模式：expect → Result 传播
// Before: .expect("provider should exist")
// After:  .ok_or_else(|| AppError::new(AppErrorCode::InternalError, "Provider 配置不存在", false))?

// main.rs — 改为返回 Result
fn main() {
    if let Err(e) = run_app() {
        eprintln!("Rastro 启动失败: {}", e);
        std::process::exit(1);
    }
}

fn run_app() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .setup(|app| {
            let state = app_state::AppState::initialize()?;
            app.manage(state);
            Ok(())
        })
        // ...
        .run(tauri::generate_context!())?;
    Ok(())
}
```

**复杂度**：M | **风险**：低

---

### Fix 3.2 — W2 + W5: 异步 I/O 防阻塞 + 流式哈希

> **Codex 建议采纳**：新增 `storage.read_blocking()` / `write_blocking()` 统一封装，而非各处散落 `spawn_blocking`。

**修改文件**：

| 文件 | 说明 |
|------|------|
| `src-tauri/src/storage/mod.rs` | 新增 `read_blocking` / `write_blocking` 封装 |
| `src-tauri/src/ipc/document.rs:100` | 使用封装 + 流式哈希（同时修复 W5） |
| `src-tauri/src/translation_manager/mod.rs:673` | 使用封装 |

**伪代码**：

```rust
// storage/mod.rs — 新增封装
impl Storage {
    pub async fn read_blocking<F, T>(&self, f: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.connection();
        tokio::task::spawn_blocking(move || f(&conn))
            .await
            .map_err(|e| AppError::new(AppErrorCode::InternalError, format!("阻塞任务失败: {}", e), false))?
    }
}

// ipc/document.rs — 流式哈希（同时修复 W5）
let hash = tokio::task::spawn_blocking(move || {
    use sha2::{Sha256, Digest};
    let file = std::fs::File::open(&path)?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher)?;
    Ok::<String, AppError>(format!("{:x}", hasher.finalize()))
}).await??;
```

**复杂度**：M | **风险**：中

---

### Fix 3.3 — W3: fetch_available_models 增加 HTTP 状态码检查

**修改文件**：`src-tauri/src/ipc/settings.rs:280`

```rust
// Before: let body: serde_json::Value = response.json().await?;
// After:
let status = response.status();
if !status.is_success() {
    let error_body = response.text().await.unwrap_or_default();
    return Err(map_provider_http_error(status.as_u16(), &error_body, provider));
}
let body: serde_json::Value = response.json().await?;
```

**复杂度**：S | **风险**：低

---

### Fix 3.4 — W4: Zotero N+1 查询优化

**修改文件**：`src-tauri/src/zotero_connector/mod.rs:115-120`

```rust
// Before: 每个 item 查一次 authors + 一次 attachments (1 + 2N 查询)
// After: 按 item_id IN (...) 批量查询后在 Rust 端组装 (3 次查询)
let item_ids: Vec<i64> = items.iter().map(|i| i.id).collect();
let authors_map = batch_query_authors(&conn, &item_ids)?;
let attachments_map = batch_query_attachments(&conn, &item_ids)?;
```

**复杂度**：M | **风险**：低

---

### Fix 3.5 — W6: get_usage_stats SQL 下推

**修改文件**：`src-tauri/src/storage/usage_events.rs:89`, `src-tauri/src/ipc/settings.rs:356`

```rust
// Before: SELECT * → Rust 内存过滤聚合
// After: SQL 侧完成过滤和聚合
let sql = "
    SELECT provider, model, feature, COUNT(*) as count, SUM(tokens) as total_tokens
    FROM usage_events
    WHERE timestamp >= ?1 AND timestamp <= ?2
    GROUP BY provider, model, feature
";
```

**复杂度**：M | **风险**：低

---

### Fix 3.6 — W8: safeInvoke 错误处理增强

**修改文件**：`src/lib/ipc-client.ts:45-55`

```typescript
function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    console.error(`IPC 错误 [${command}]:`, err);
    if (isAppError(err)) throw err;
    throw {
      code: 'INTERNAL_ERROR',
      message: typeof err === 'string' ? err : '发生了意外的 IPC 错误',
      retryable: false,
    } as AppError;
  }
}
```

**复杂度**：S | **风险**：低

---

## 阶段 4：代码质量 [Info + Warning]

### Fix 4.1 — W9 + I7: 可访问性修复

**修改文件**：`src/layouts/AppLayout.tsx:43,56,65`

- 蒙层 div 增加 `role="button"`, `tabIndex={0}`, `onKeyDown`, `aria-label`
- 按钮 `title` 改为 `aria-label`

**复杂度**：S | **风险**：极低

---

### Fix 4.2 — I3: summary_service 伪分层清理

删除 `summary_service.rs` 薄封装，让 `AiIntegration::generate_summary()` 直接调用 `chat_service::start_summary_flow()`。

**复杂度**：S | **风险**：低

---

### Fix 4.3 — I4: 补测试覆盖

新增 6 类回归测试：
1. C1 allowlist 校验
2. C2 ownership mismatch 拒绝
3. W3 HTTP error mapping (401/429/5xx)
4. I1 error_code 落库格式
5. W6 SQL 聚合正确性
6. W2/W5 异步阻塞回归

**复杂度**：M | **风险**：极低

---

### Fix 4.4 — I6: Button.tsx 类型安全

移除 `as any`，使用泛型多态组件模式。

**复杂度**：S | **风险**：低

---

### Fix 4.5 — I8: IPC 调用参数风格统一

审查后端 Tauri command 签名，统一前端调用为一致风格。

**复杂度**：S | **风险**：低

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| C1 白名单过严阻断用户自定义代理 | debug 模式放行 localhost；后续可增加用户确认弹窗 |
| C2 canonicalize 在符号链接场景的行为 | 单测覆盖符号链接指向同一文件的场景 |
| C3 重构后流式消息不工作 | 先在 dev 环境完整测试聊天+摘要流 |
| W7 规范化后组件消费方式变化 | 逐个组件适配，每步验证渲染正确 |
| I2 错误码变更打破前后端契约 | 同时更新 types.ts，跑 cargo test 验证 |
| W2 spawn_blocking 引入新的错误路径 | 统一用 read_blocking/write_blocking 封装 |

## 工作量估算

| 阶段 | 预估 | 说明 |
|------|------|------|
| 阶段 0 (I2+I1) | 0.5-1h | 错误码基线 |
| 阶段 1 (C1+C2) | 1-2h | 安全验证逻辑 |
| 阶段 2 (C3+W7+I5) | 3-4h | 核心架构重构 |
| 阶段 3 (W1-W6+W8) | 2-3h | 多个独立修复 |
| 阶段 4 (I3+I4+I6-I8+W9) | 2-3h | 质量改进和测试 |

## SESSION_ID（供 /ccg:execute 使用）

- CODEX_SESSION: 019ce7e0-d1e5-7610-a15a-e6f53d267c9c
- GEMINI_SESSION: fd355d84-7486-4b01-9af1-b780c3797fd0
