# 精读模式设计方案（Deep Read Mode）

## 背景

当前 AI 问答（`ask_ai`）存在两个核心问题：

1. **AI 对文章一无所知**：`build_chat_prompt()` 仅拼接用户拖拽的 `contextQuote` + `userMessage`，没有文章全文、摘要、或 system prompt
2. **无对话历史**：每次问答独立发送，AI 不记得之前聊了什么，无法连续追问

用户需求：在 Chat Panel 添加"精读"按钮，手动触发后提取文章全文作为 AI 上下文，并按文档持久化。

## 设计决策

### 为什么选全文注入而非 Summary？

- DeepSeek V3 输入价格 $0.14/M tokens，10 轮全文对话总成本 < ¥0.1
- 64K-128K 上下文窗口装 10 页论文（~7K tokens）绰绰有余
- 全文保留原始信息，不存在 Summary 的信息损失

### 为什么按文档持久化？

- 用户的"精读"是一个主动决策，表示这篇文献值得深度研究
- 下次打开同一文档自动恢复精读状态，无需重复提取

## 架构概览

```
用户点击"精读" → 前端 extractPdfText() → IPC save_deep_read_text → SQLite 落库
                                                                          ↓
后续 ask_ai 调用 → 后端读取 deep_read_text → 组装 system prompt + 历史消息 + 用户问题 → AI Provider
```

## 改动范围

### 1. 数据库：新增 migration

新增 `010_deep_read.sql`：

```sql
ALTER TABLE documents ADD COLUMN deep_read_text TEXT;
```

- `deep_read_text`：`NULL` 表示未开启精读，有值表示已开启
- 不再需要额外的布尔标志，`IS NOT NULL` 即为开启状态

### 2. 后端 Rust

#### 2.1 新增 IPC 命令

- `save_deep_read_text(documentId, text)` — 保存提取的全文
- `clear_deep_read_text(documentId)` — 清除精读状态（可选）
- `get_deep_read_status(documentId)` — 查询精读状态（返回 boolean，不返回全文）

#### 2.2 修改 `AskAiRequest` 结构体

```rust
pub struct AskAiRequest {
    pub document_id: String,
    pub session_id: Option<String>,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub user_message: String,
    pub context_quote: Option<String>,
    // 不新增字段——后端自己从 DB 读取 deep_read_text
}
```

> 决策：不在请求中传全文，后端自行从 SQLite 读取。避免每次前端发送 7K+ tokens 的 IPC 负载。

#### 2.3 改造 `build_chat_prompt` → `build_chat_messages`

当前：单条 user message string
改为：`Vec<ChatMessage>` 多轮消息数组

```rust
struct PromptMessage {
    role: &'static str, // "system" | "user" | "assistant"
    content: String,
}

fn build_chat_messages(
    input: &AskAiRequest,
    deep_read_text: Option<&str>,
    history: &[ChatMessageRow],
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
    for msg in history.iter().rev().take(10).rev() {
        messages.push(PromptMessage {
            role: msg.role.as_str(),
            content: msg.content_md.clone(),
        });
    }

    // 3. 当前用户消息（带引用段落）
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

#### 2.4 改造 `build_stream_request`

当前签名：`fn build_stream_request(client, config, prompt: &str)`
改为：`fn build_stream_request(client, config, messages: &[PromptMessage])`

将 messages 序列化为各 Provider 对应的 API 格式：
- OpenAI/DeepSeek：`messages` 数组（原生支持 system/user/assistant）
- Claude：`system` 字段 + `messages` 数组
- Gemini：`systemInstruction` + `contents` 数组

### 3. 前端 TypeScript/React

#### 3.1 Chat Panel 新增"精读"按钮

在 `ChatPanel.tsx` 顶部标题栏位置（`<Sparkles>` 旁边）添加：
- 未精读：显示"📖 精读"按钮（正常状态）
- 加载中：显示 spinner + "正在提取全文..."
- 已精读：显示"📖 精读中"徽章（绿色，可点击关闭）

#### 3.2 精读触发逻辑

点击按钮 → 调用已有的 `extractPdfText(filePath, { maxPages: 50, maxChars: 60000 })` → 调用新 IPC `saveDeepReadText(documentId, text)` → 更新 UI 状态

#### 3.3 IPC Client 扩展

在 `ipc-client.ts` 新增：
- `saveDeepReadText(documentId, text): Promise<void>`
- `clearDeepReadText(documentId): Promise<void>`
- `getDeepReadStatus(documentId): Promise<boolean>`

#### 3.4 文档打开时恢复状态

在文档加载流程中查询 `getDeepReadStatus`，Chat Panel 根据结果显示对应 UI。

## Token 安全阈值

- 全文字符截断上限：60,000 字符（≈ 15,000-20,000 tokens）
- 对话历史上限：最近 10 轮
- 如果 `deep_read_text + history + userMessage` 超过模型上下文窗口 80%，日志警告并截断全文

## 不做的事情（YAGNI）

- ❌ 不做 RAG / Embedding / 向量检索（YAGNI，当前规模不需要）
- ❌ 不做自动精读（用户明确说了手动触发）
- ❌ 不做全文传输优化（DeepSeek 价格极低，不值得优化）
- ❌ 不修改 Summary 功能（精读与总结是独立功能）

## 验证计划

### 自动化测试

1. **Rust 单元测试**：`build_chat_messages()` 的三种场景
   - 无精读 + 无历史 → 仅 1 条 user message
   - 有精读 + 无历史 → system + user
   - 有精读 + 有历史 + 有引用 → system + history + user（含引用格式）
   
2. **Rust 单元测试**：`build_stream_request()` 多消息格式
   - OpenAI 格式序列化正确
   - Claude system 字段分离
   - Gemini systemInstruction 格式

3. **运行命令**：`cd src-tauri && cargo test`

### 手动验证

1. 打开一篇 PDF → 点击精读按钮 → 确认提取成功
2. 在精读模式下提问 → 确认 AI 回答基于文章内容
3. 连续追问 → 确认 AI 记得前几轮对话
4. 关闭 App 重新打开同一 PDF → 确认精读状态恢复
5. 确认非精读模式下的问答行为不受影响
