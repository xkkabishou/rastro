# 精读模式（Deep Read Mode）实施计划

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** 在 Chat Panel 增加"精读"按钮，提取 PDF 全文注入为 system prompt + 对话历史，实现连续多轮学术问答。

**Architecture:** 前端提取全文 → IPC 保存到 `documents.deep_read_text` → 后端 `ask_ai` 自行读取 → 组装 `Vec<PromptMessage>`（system + history + user）→ 三 Provider 各自序列化。精读状态按文档持久化。

**Tech Stack:** Rust (Tauri IPC, SQLite, rusqlite), TypeScript/React (framer-motion, pdfjs-dist), OpenAI/Claude/Gemini API

---

## Proposed Changes

### 数据层

---

### Task 1: 数据库 Migration — 新增 `deep_read_text` 列

**Files:**
- Create: `src-tauri/migrations/010_deep_read.sql`
- Modify: `src-tauri/src/storage/migrations.rs:13-77`

**Step 1: 创建 migration SQL**

```sql
-- 010_deep_read.sql
ALTER TABLE documents ADD COLUMN deep_read_text TEXT;
```

**Step 2: 注册 migration**

在 `migrations.rs` 添加：

```rust
const DEEP_READ_SQL: &str = include_str!("../../migrations/010_deep_read.sql");

// 在 MIGRATIONS 数组末尾追加：
Migration {
    version: 10,
    name: "deep_read",
    sql: DEEP_READ_SQL,
},
```

**Step 3: 更新 migration 测试**

修改 `migrations.rs` 测试中的 `assert_eq!(current_version(...), 9)` → `10`，新增断言：

```rust
assert!(
    column_exists(&connection, "documents", "deep_read_text"),
    "documents.deep_read_text should exist after migration"
);
```

**Step 4: 运行测试验证**

Run: `cd src-tauri && cargo test storage::migrations`
Expected: PASS，version = 10，deep_read_text 列存在

**Step 5: Commit**

```
git add src-tauri/migrations/010_deep_read.sql src-tauri/src/storage/migrations.rs
git commit --no-gpg-sign -m "feat(db): migration 10 — documents.deep_read_text 列"
```

---

### Task 2: Storage 层 — 精读文本读写函数

**Files:**
- Modify: `src-tauri/src/storage/documents.rs`

需要在 `documents.rs` 中添加两个函数：

**Step 1: 写入精读文本**

```rust
/// 保存精读全文到 documents 表
pub fn save_deep_read_text(
    connection: &Connection,
    document_id: &str,
    text: &str,
) -> rusqlite::Result<bool> {
    let updated = connection.execute(
        "UPDATE documents SET deep_read_text = ?1 WHERE document_id = ?2",
        params![text, document_id],
    )?;
    Ok(updated > 0)
}

/// 清除精读文本
pub fn clear_deep_read_text(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<bool> {
    let updated = connection.execute(
        "UPDATE documents SET deep_read_text = NULL WHERE document_id = ?1",
        params![document_id],
    )?;
    Ok(updated > 0)
}

/// 读取精读文本（仅返回文本，不加载整个 DocumentRecord）
pub fn get_deep_read_text(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT deep_read_text FROM documents WHERE document_id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map(|v| v.flatten())
}
```

**Step 2: 写单元测试**

```rust
#[test]
fn save_and_read_deep_read_text() {
    let connection = test_connection();
    let doc = insert_test_document(&connection);
    
    assert_eq!(get_deep_read_text(&connection, &doc.document_id).unwrap(), None);
    
    save_deep_read_text(&connection, &doc.document_id, "全文内容").unwrap();
    assert_eq!(
        get_deep_read_text(&connection, &doc.document_id).unwrap(),
        Some("全文内容".to_string())
    );
    
    clear_deep_read_text(&connection, &doc.document_id).unwrap();
    assert_eq!(get_deep_read_text(&connection, &doc.document_id).unwrap(), None);
}
```

**Step 3: 运行测试**

Run: `cd src-tauri && cargo test storage::documents`
Expected: PASS

**Step 4: Commit**

```
git add src-tauri/src/storage/documents.rs
git commit --no-gpg-sign -m "feat(storage): save/clear/get deep_read_text 函数"
```

---

### 后端 IPC + AI 改造

---

### Task 3: IPC 命令 — save/clear/get deep read

**Files:**
- Create: `src-tauri/src/ipc/deep_read.rs`
- Modify: `src-tauri/src/ipc/mod.rs`
- Modify: `src-tauri/src/main.rs`（注册命令）

**Step 1: 创建 IPC 模块**

`deep_read.rs` 包含 3 个 `#[tauri::command]` 函数：

```rust
use serde::Serialize;
use tauri::State;
use crate::{app_state::AppState, errors::AppError, storage::documents};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepReadStatus {
    pub enabled: bool,
    pub char_count: Option<u32>,
}

#[tauri::command]
pub fn save_deep_read_text(
    state: State<'_, AppState>,
    document_id: String,
    text: String,
) -> Result<DeepReadStatus, AppError> {
    let char_count = text.chars().count() as u32;
    let connection = state.storage.connection();
    documents::save_deep_read_text(&connection, &document_id, &text)?;
    Ok(DeepReadStatus { enabled: true, char_count: Some(char_count) })
}

#[tauri::command]
pub fn clear_deep_read_text(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeepReadStatus, AppError> {
    let connection = state.storage.connection();
    documents::clear_deep_read_text(&connection, &document_id)?;
    Ok(DeepReadStatus { enabled: false, char_count: None })
}

#[tauri::command]
pub fn get_deep_read_status(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DeepReadStatus, AppError> {
    let connection = state.storage.connection();
    let text = documents::get_deep_read_text(&connection, &document_id)?;
    Ok(DeepReadStatus {
        enabled: text.is_some(),
        char_count: text.as_ref().map(|t| t.chars().count() as u32),
    })
}
```

**Step 2: 在 `mod.rs` 中导出**

```rust
pub mod deep_read;
```

**Step 3: 在 `main.rs` 注册命令**

在 `tauri::generate_handler![]` 中添加：
```rust
ipc::deep_read::save_deep_read_text,
ipc::deep_read::clear_deep_read_text,
ipc::deep_read::get_deep_read_status,
```

**Step 4: 运行编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过

**Step 5: Commit**

```
git add src-tauri/src/ipc/deep_read.rs src-tauri/src/ipc/mod.rs src-tauri/src/main.rs
git commit --no-gpg-sign -m "feat(ipc): save/clear/get deep read 三个 IPC 命令"
```

---

### Task 4: 改造 `build_chat_prompt` → `build_chat_messages` 多消息数组

**Files:**
- Modify: `src-tauri/src/ai_integration/chat_service.rs:539-548` (build_chat_prompt → build_chat_messages)
- Modify: `src-tauri/src/ai_integration/chat_service.rs:176-259` (start_chat — 读 DB + 历史)
- Modify: `src-tauri/src/ai_integration/chat_service.rs:20-28` (PreparedStream — prompt → messages)

**核心变更：**

1. 新增 `PromptMessage` 结构体：
```rust
#[derive(Debug, Clone, Serialize)]
pub struct PromptMessage {
    pub role: &'static str,
    pub content: String,
}
```

2. `PreparedStream.prompt: String` → `PreparedStream.messages: Vec<PromptMessage>`

3. `build_chat_messages` 替代 `build_chat_prompt`：
```rust
fn build_chat_messages(
    input: &AskAiRequest,
    deep_read_text: Option<&str>,
    history: &[chat_messages::ChatMessageRecord],
) -> Vec<PromptMessage> {
    let mut messages = Vec::new();
    
    // 1. System prompt（精读全文）
    if let Some(text) = deep_read_text {
        messages.push(PromptMessage {
            role: "system",
            content: format!(
                "你是一位学术文献阅读助手。以下是用户正在精读的论文全文，请基于此内容回答问题。\n\n{}",
                text
            ),
        });
    }
    
    // 2. 对话历史（最近 10 轮）
    for msg in history.iter().rev().take(20).rev() {
        messages.push(PromptMessage {
            role: if msg.role == "user" { "user" } else { "assistant" },
            content: msg.content_md.clone(),
        });
    }
    
    // 3. 当前用户消息
    let user_content = match &input.context_quote {
        Some(quote) if !quote.trim().is_empty() => format!(
            "引用段落：\n{}\n\n问题：{}",
            quote.trim(), input.user_message.trim()
        ),
        _ => input.user_message.trim().to_string(),
    };
    messages.push(PromptMessage { role: "user", content: user_content });
    
    messages
}
```

4. `start_chat` 中读取精读全文和对话历史：
```rust
// 在 session_id 确定之后
let deep_read_text = {
    let connection = ai.storage.connection();
    documents::get_deep_read_text(&connection, &input.document_id)?
};

let history = {
    let connection = ai.storage.connection();
    chat_messages::list_by_session(&connection, &session_id)?
};

let messages = build_chat_messages(&input, deep_read_text.as_deref(), &history);
```

5. `build_stream_request` 签名改为 `messages: &[PromptMessage]`，按 Provider 序列化为各自 API 格式。

**Step 1: 写 `build_chat_messages` 单元测试（3 场景）**

```rust
#[test]
fn build_chat_messages_without_deep_read_or_history() {
    let input = AskAiRequest {
        document_id: "d1".into(), session_id: None,
        provider: None, model: None,
        user_message: "什么是 XRD？".into(), context_quote: None,
    };
    let messages = build_chat_messages(&input, None, &[]);
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, "user");
}

#[test]
fn build_chat_messages_with_deep_read_and_history() {
    let input = AskAiRequest {
        document_id: "d1".into(), session_id: None,
        provider: None, model: None,
        user_message: "作者用了什么方法？".into(),
        context_quote: Some("Using XRF analysis...".into()),
    };
    let history = vec![/* mock ChatMessageRecord */];
    let messages = build_chat_messages(&input, Some("论文全文..."), &history);
    assert_eq!(messages[0].role, "system");
    assert!(messages[0].content.contains("论文全文..."));
    assert!(messages.last().unwrap().content.contains("引用段落"));
}
```

**Step 2: 实现代码变更**

**Step 3: 运行全部测试**

Run: `cd src-tauri && cargo test ai_integration::chat_service`
Expected: 全部 PASS

**Step 4: Commit**

```
git add src-tauri/src/ai_integration/chat_service.rs src-tauri/src/ai_integration/provider_registry.rs
git commit --no-gpg-sign -m "feat(ai): build_chat_messages 多消息 + 精读全文 + 对话历史"
```

---

### Task 5: 改造 `build_stream_request` 支持多消息

**Files:**
- Modify: `src-tauri/src/ai_integration/provider_registry.rs:161-228`

**核心变更：** 签名从 `prompt: &str` 改为 `messages: &[PromptMessage]`

- **OpenAI/DeepSeek**: `messages` 数组直接映射
- **Claude**: 提取 `system` role 到顶层 `system` 字段，其余放 `messages`
- **Gemini**: 提取 `system` role 到 `systemInstruction`，其余放 `contents`

**Step 1: 写测试**（验证三种 Provider 的序列化结果正确）

> 注意：当前 `build_stream_request` 返回 `RequestBuilder` 不方便测试内容。我们新增一个纯函数 `build_messages_payload` 返回 `serde_json::Value` 用于测试，`build_stream_request` 内部调用它。

**Step 2: 实现变更**

**Step 3: 运行测试**

Run: `cd src-tauri && cargo test provider_registry`
Expected: PASS

**Step 4: Commit**

```
git add src-tauri/src/ai_integration/provider_registry.rs src-tauri/src/ai_integration/chat_service.rs
git commit --no-gpg-sign -m "feat(provider): build_stream_request 支持多消息数组"
```

---

### 前端 IPC + UI

---

### Task 6: 前端 IPC Client + Types 扩展

**Files:**
- Modify: `src/shared/types.ts`（新增 IPC 命令名和类型）
- Modify: `src/lib/ipc-client.ts`（新增 3 个方法）

**Step 1: 在 `types.ts` 的 `IPC_COMMANDS` 中添加**

```typescript
SAVE_DEEP_READ_TEXT: 'save_deep_read_text',
CLEAR_DEEP_READ_TEXT: 'clear_deep_read_text',
GET_DEEP_READ_STATUS: 'get_deep_read_status',
```

新增类型：
```typescript
export interface DeepReadStatus {
  enabled: boolean;
  charCount: number | null;
}
```

**Step 2: 在 `ipc-client.ts` 中添加方法**

```typescript
// 精读模式
saveDeepReadText: (documentId: string, text: string) =>
  safeInvoke<DeepReadStatus>(IPC_COMMANDS.SAVE_DEEP_READ_TEXT, { documentId, text }),

clearDeepReadText: (documentId: string) =>
  safeInvoke<DeepReadStatus>(IPC_COMMANDS.CLEAR_DEEP_READ_TEXT, { documentId }),

getDeepReadStatus: (documentId: string) =>
  safeInvoke<DeepReadStatus>(IPC_COMMANDS.GET_DEEP_READ_STATUS, { documentId }),
```

**Step 3: Commit**

```
git add src/shared/types.ts src/lib/ipc-client.ts
git commit --no-gpg-sign -m "feat(ipc-client): 精读三个 IPC 方法"
```

---

### Task 7: ChatPanel UI — 精读按钮

**Files:**
- Modify: `src/components/chat-panel/ChatPanel.tsx`

**Step 1: 添加精读状态管理**

```typescript
const [deepReadStatus, setDeepReadStatus] = useState<{ enabled: boolean; charCount: number | null }>({ enabled: false, charCount: null });
const [isExtractingText, setIsExtractingText] = useState(false);
```

**Step 2: 文档加载时查询精读状态**

```typescript
useEffect(() => {
  if (!currentDocument) return;
  ipcClient.getDeepReadStatus(currentDocument.documentId)
    .then(setDeepReadStatus)
    .catch(console.error);
}, [currentDocument?.documentId]);
```

**Step 3: 精读触发逻辑**

```typescript
const handleToggleDeepRead = useCallback(async () => {
  if (!currentDocument) return;
  if (deepReadStatus.enabled) {
    // 关闭精读
    const result = await ipcClient.clearDeepReadText(currentDocument.documentId);
    setDeepReadStatus(result);
    return;
  }
  // 开启精读
  setIsExtractingText(true);
  try {
    const { text } = await extractPdfText(currentDocument.filePath, {
      maxPages: 50,
      maxChars: 60000,
    });
    const result = await ipcClient.saveDeepReadText(currentDocument.documentId, text);
    setDeepReadStatus(result);
  } catch (err) {
    console.error('精读文本提取失败:', err);
  } finally {
    setIsExtractingText(false);
  }
}, [currentDocument, deepReadStatus.enabled]);
```

**Step 4: 顶部栏 UI**

在 `<Sparkles>` 旁边添加按钮：

```tsx
<button
  onClick={handleToggleDeepRead}
  disabled={isExtractingText || !currentDocument}
  className={`text-xs px-2 py-1 rounded-md transition-colors ${
    deepReadStatus.enabled
      ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
  }`}
>
  {isExtractingText ? '⏳ 提取中...' : deepReadStatus.enabled ? '📖 精读中' : '📖 精读'}
</button>
```

**Step 5: Commit**

```
git add src/components/chat-panel/ChatPanel.tsx
git commit --no-gpg-sign -m "feat(ui): ChatPanel 精读按钮 + 提取全文逻辑"
```

---

## 验证计划

### 自动化测试

1. **Migration 测试**
   - Run: `cd src-tauri && cargo test storage::migrations`
   - 验证 version = 10，`deep_read_text` 列存在

2. **Storage 层测试**
   - Run: `cd src-tauri && cargo test storage::documents`
   - 验证 save/get/clear 三个函数

3. **build_chat_messages 测试**
   - Run: `cd src-tauri && cargo test ai_integration::chat_service`
   - 3 场景：无精读、有精读有历史、有引用

4. **build_stream_request 多消息测试**
   - Run: `cd src-tauri && cargo test provider_registry`
   - 3 种 Provider 序列化正确

5. **全量回归**
   - Run: `cd src-tauri && cargo test`
   - Expected: 全部绿色

### 手动验证

由用户执行以下步骤：

1. 打开 App → 打开一篇 PDF → Chat Panel 应显示灰色「📖 精读」按钮
2. 点击按钮 → 显示「⏳ 提取中...」→ 变为绿色「📖 精读中」
3. 在精读模式下提问关于文章内容的问题 → AI 回答应基于文章内容
4. 连续追问 → AI 应记得之前的对话
5. 关闭 App 重新打开同一 PDF → Chat Panel 应自动显示绿色精读状态
6. 点击「📖 精读中」→ 恢复为灰色「📖 精读」（关闭精读）
7. 再次提问 → AI 应不知道文章内容（无 system prompt）

---

## 依赖关系

```
Task 1 (migration) → Task 2 (storage) → Task 3 (IPC)
                                            ↓
Task 4 (chat_messages) → Task 5 (provider) → Task 6 (front IPC) → Task 7 (UI)
```

Task 1-3 为后端数据链路，Task 4-5 为 AI 改造核心，Task 6-7 为前端。
