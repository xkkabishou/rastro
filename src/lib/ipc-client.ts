import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  IPC_COMMANDS,
  IPC_EVENTS,
  // 错误
  AppError,
  // A. 文档与应用状态
  BackendHealth,
  OpenDocumentInput,
  DocumentSnapshot,
  // B. Translation Engine 生命周期
  EnsureTranslationEngineInput,
  ShutdownTranslationEngineInput,
  TranslationEngineStatus,
  // C. 翻译任务
  RequestTranslationInput,
  TranslationJobDto,
  GetTranslationJobInput,
  CancelTranslationInput,
  CancelTranslationResult,
  LoadCachedTranslationInput,
  // D. AI 问答与总结
  AskAiInput,
  AIStreamHandle,
  CancelAiStreamInput,
  CancelAiStreamResult,
  GenerateSummaryInput,
  ListChatSessionsInput,
  ChatSessionDto,
  GetChatMessagesInput,
  ChatMessageDto,
  // E. Provider 配置
  ProviderConfigDto,
  SaveProviderKeyInput,
  RemoveProviderKeyInput,
  RemoveProviderKeyResult,
  SetActiveProviderInput,
  TestProviderConnectionInput,
  ProviderConnectivityDto,
  // F. 使用统计
  GetUsageStatsInput,
  UsageStatsDto,
  // G. Zotero
  ZoteroStatusDto,
  FetchZoteroItemsInput,
  PagedZoteroItemsDto,
  OpenZoteroAttachmentInput,
  // Event Payloads
  AiStreamChunkPayload,
  AiStreamFinishedPayload,
  AiStreamFailedPayload,
  TranslationJobProgressPayload,
  TranslationJobCompletedPayload,
  TranslationJobFailedPayload,
} from '../shared/types';

// ---------------------------------------------------------------------------
// 通用 IPC 调用封装（统一错误处理）
// ---------------------------------------------------------------------------

async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    console.error(`IPC 错误 [${command}]:`, err);
    throw err as AppError;
  }
}

// ---------------------------------------------------------------------------
// IPC Client — 类型安全的 Tauri Command 封装层
// ---------------------------------------------------------------------------

export const ipcClient = {
  // =========================================================================
  // A. 文档与应用状态
  // =========================================================================

  /** 获取后端健康状态 */
  getBackendHealth: () =>
    safeInvoke<BackendHealth>(IPC_COMMANDS.GET_BACKEND_HEALTH),

  /** 打开文档 */
  openDocument: (input: OpenDocumentInput) =>
    safeInvoke<DocumentSnapshot>(IPC_COMMANDS.OPEN_DOCUMENT, { ...input }),

  /** 获取最近文档列表 */
  listRecentDocuments: (limit?: number) =>
    safeInvoke<DocumentSnapshot[]>(IPC_COMMANDS.LIST_RECENT_DOCUMENTS, { limit }),

  /** 获取文档快照 */
  getDocumentSnapshot: (documentId: string) =>
    safeInvoke<DocumentSnapshot>(IPC_COMMANDS.GET_DOCUMENT_SNAPSHOT, { documentId }),

  // =========================================================================
  // B. Translation Engine 生命周期
  // =========================================================================

  /** 确保翻译引擎运行 */
  ensureTranslationEngine: (input?: EnsureTranslationEngineInput) =>
    safeInvoke<TranslationEngineStatus>(IPC_COMMANDS.ENSURE_TRANSLATION_ENGINE, input ? { ...input } : {}),

  /** 关闭翻译引擎 */
  shutdownTranslationEngine: (input?: ShutdownTranslationEngineInput) =>
    safeInvoke<TranslationEngineStatus>(IPC_COMMANDS.SHUTDOWN_TRANSLATION_ENGINE, input ? { ...input } : {}),

  /** 获取翻译引擎状态 */
  getTranslationEngineStatus: () =>
    safeInvoke<TranslationEngineStatus>(IPC_COMMANDS.GET_TRANSLATION_ENGINE_STATUS),

  // =========================================================================
  // C. 翻译任务
  // =========================================================================

  /** 提交翻译请求 */
  requestTranslation: (input: RequestTranslationInput) =>
    safeInvoke<TranslationJobDto>(IPC_COMMANDS.REQUEST_TRANSLATION, { input }),

  /** 获取翻译任务状态 */
  getTranslationJob: (jobId: string) =>
    safeInvoke<TranslationJobDto>(IPC_COMMANDS.GET_TRANSLATION_JOB, { jobId }),

  /** 取消翻译任务 */
  cancelTranslation: (jobId: string) =>
    safeInvoke<CancelTranslationResult>(IPC_COMMANDS.CANCEL_TRANSLATION, { jobId }),

  /** 加载缓存翻译 */
  loadCachedTranslation: (input: LoadCachedTranslationInput) =>
    safeInvoke<TranslationJobDto | null>(IPC_COMMANDS.LOAD_CACHED_TRANSLATION, { ...input }),

  // =========================================================================
  // D. AI 问答与总结
  // =========================================================================

  /** 发起 AI 问答（流式） */
  askAi: (input: AskAiInput) =>
    safeInvoke<AIStreamHandle>(IPC_COMMANDS.ASK_AI, { input }),

  /** 取消 AI 流 */
  cancelAiStream: (streamId: string) =>
    safeInvoke<CancelAiStreamResult>(IPC_COMMANDS.CANCEL_AI_STREAM, { streamId }),

  /** 生成文献总结（流式） */
  generateSummary: (input: GenerateSummaryInput) =>
    safeInvoke<AIStreamHandle>(IPC_COMMANDS.GENERATE_SUMMARY, { input }),

  /** 获取聊天会话列表 */
  listChatSessions: (documentId: string) =>
    safeInvoke<ChatSessionDto[]>(IPC_COMMANDS.LIST_CHAT_SESSIONS, { documentId }),

  /** 获取聊天消息历史 */
  getChatMessages: (sessionId: string) =>
    safeInvoke<ChatMessageDto[]>(IPC_COMMANDS.GET_CHAT_MESSAGES, { sessionId }),

  // =========================================================================
  // E. Provider 配置与凭据
  // =========================================================================

  /** 列出所有 Provider 配置 */
  listProviderConfigs: () =>
    safeInvoke<ProviderConfigDto[]>(IPC_COMMANDS.LIST_PROVIDER_CONFIGS),

  /** 保存 Provider API Key */
  saveProviderKey: (input: SaveProviderKeyInput) =>
    safeInvoke<ProviderConfigDto>(IPC_COMMANDS.SAVE_PROVIDER_KEY, { ...input }),

  /** 移除 Provider API Key */
  removeProviderKey: (provider: string) =>
    safeInvoke<RemoveProviderKeyResult>(IPC_COMMANDS.REMOVE_PROVIDER_KEY, { provider }),

  /** 设置活跃 Provider */
  setActiveProvider: (input: SetActiveProviderInput) =>
    safeInvoke<ProviderConfigDto>(IPC_COMMANDS.SET_ACTIVE_PROVIDER, { ...input }),

  /** 测试 Provider 连接 */
  testProviderConnection: (input: TestProviderConnectionInput) =>
    safeInvoke<ProviderConnectivityDto>(IPC_COMMANDS.TEST_PROVIDER_CONNECTION, { ...input }),

  // =========================================================================
  // F. 使用统计
  // =========================================================================

  /** 获取使用统计 */
  getUsageStats: (input?: GetUsageStatsInput) =>
    safeInvoke<UsageStatsDto>(IPC_COMMANDS.GET_USAGE_STATS, input ? { ...input } : {}),

  // =========================================================================
  // G. Zotero 集成
  // =========================================================================

  /** 探测 Zotero 库 */
  detectZoteroLibrary: () =>
    safeInvoke<ZoteroStatusDto>(IPC_COMMANDS.DETECT_ZOTERO_LIBRARY),

  /** 获取 Zotero 文献条目 */
  fetchZoteroItems: (input?: FetchZoteroItemsInput) =>
    safeInvoke<PagedZoteroItemsDto>(IPC_COMMANDS.FETCH_ZOTERO_ITEMS, input ? { ...input } : {}),

  /** 打开 Zotero 附件 */
  openZoteroAttachment: (itemKey: string) =>
    safeInvoke<DocumentSnapshot>(IPC_COMMANDS.OPEN_ZOTERO_ATTACHMENT, { itemKey }),
};

// ---------------------------------------------------------------------------
// Event 监听封装 — 统一返回 UnlistenFn
// ---------------------------------------------------------------------------

export const ipcEvents = {
  // AI 流事件
  onAiStreamChunk: (callback: (payload: AiStreamChunkPayload) => void): Promise<UnlistenFn> =>
    listen<AiStreamChunkPayload>(IPC_EVENTS.AI_STREAM_CHUNK, (e) => callback(e.payload)),

  onAiStreamFinished: (callback: (payload: AiStreamFinishedPayload) => void): Promise<UnlistenFn> =>
    listen<AiStreamFinishedPayload>(IPC_EVENTS.AI_STREAM_FINISHED, (e) => callback(e.payload)),

  onAiStreamFailed: (callback: (payload: AiStreamFailedPayload) => void): Promise<UnlistenFn> =>
    listen<AiStreamFailedPayload>(IPC_EVENTS.AI_STREAM_FAILED, (e) => callback(e.payload)),

  // 翻译任务事件
  onTranslationProgress: (callback: (payload: TranslationJobProgressPayload) => void): Promise<UnlistenFn> =>
    listen<TranslationJobProgressPayload>(IPC_EVENTS.TRANSLATION_JOB_PROGRESS, (e) => callback(e.payload)),

  onTranslationCompleted: (callback: (payload: TranslationJobCompletedPayload) => void): Promise<UnlistenFn> =>
    listen<TranslationJobCompletedPayload>(IPC_EVENTS.TRANSLATION_JOB_COMPLETED, (e) => callback(e.payload)),

  onTranslationFailed: (callback: (payload: TranslationJobFailedPayload) => void): Promise<UnlistenFn> =>
    listen<TranslationJobFailedPayload>(IPC_EVENTS.TRANSLATION_JOB_FAILED, (e) => callback(e.payload)),
};
