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
  UpdateProviderConfigInput,
  FetchModelsResult,
  // F. 使用统计
  GetUsageStatsInput,
  UsageStatsDto,
  // G. Zotero
  ZoteroStatusDto,
  ZoteroCollectionDto,
  FetchZoteroItemsInput,
  FetchZoteroCollectionItemsInput,
  PagedZoteroItemsDto,
  OpenZoteroAttachmentInput,
  // V2: 文档工作空间
  DocumentArtifactDto,
  AISummaryDto,
  DocumentFilter,
  CacheStatsDto,
  DeleteCacheResult,
  DeleteSummaryResult,
  RemoveDocumentResult,
  ToggleFavoriteResult,
  // H. 自定义提示词
  CustomPromptDto,
  ResetCustomPromptResult,
  PromptKey,
  // I. 标注
  SaveAnnotationInput,
  UpdateAnnotationInput,
  AnnotationDto,
  DeleteAnnotationResult,
  // J. 翻译 Provider 配置
  TranslationProviderConfigDto,
  TranslationConnectivityDto,
  TranslateTextResult,
  // K. 标题翻译缓存
  TitleTranslationDto,
  BatchTranslateTitlesResult,
  // L. Obsidian 笔记同步
  ObsidianConfigDto,
  ValidateVaultResult,
  ExportSummaryResult,
  ExportChatsResult,
  DetectedVault,
  ZoteroExportResult,
  // M. 精读模式
  DeepReadStatus,
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

  /** 获取最近文档列表（v2: 支持搜索和筛选） */
  listRecentDocuments: (limit?: number, query?: string, filter?: DocumentFilter) =>
    safeInvoke<DocumentSnapshot[]>(IPC_COMMANDS.LIST_RECENT_DOCUMENTS, { limit, query, filter }),

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

  /** 更新 Provider 配置（base_url、model） */
  updateProviderConfig: (input: UpdateProviderConfigInput) =>
    safeInvoke<ProviderConfigDto>(IPC_COMMANDS.UPDATE_PROVIDER_CONFIG, { ...input }),

  /** 拉取可用模型列表 */
  fetchAvailableModels: (provider: string) =>
    safeInvoke<FetchModelsResult>(IPC_COMMANDS.FETCH_AVAILABLE_MODELS, { provider }),

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

  /** 获取 Zotero 文献条目（全部，分页） */
  fetchZoteroItems: (input?: FetchZoteroItemsInput) =>
    safeInvoke<PagedZoteroItemsDto>(IPC_COMMANDS.FETCH_ZOTERO_ITEMS, input ? { ...input } : {}),

  /** 获取 Zotero 所有 collections（文件夹树） */
  fetchZoteroCollections: () =>
    safeInvoke<ZoteroCollectionDto[]>(IPC_COMMANDS.FETCH_ZOTERO_COLLECTIONS),

  /** 获取指定 collection 下的文献（分页），collectionId 为 null 时返回未分类文献 */
  fetchZoteroCollectionItems: (input: FetchZoteroCollectionItemsInput) =>
    safeInvoke<PagedZoteroItemsDto>(IPC_COMMANDS.FETCH_ZOTERO_COLLECTION_ITEMS, { ...input }),

  /** 打开 Zotero 附件 */
  openZoteroAttachment: (itemKey: string) =>
    safeInvoke<DocumentSnapshot>(IPC_COMMANDS.OPEN_ZOTERO_ATTACHMENT, { itemKey }),

  // =========================================================================
  // V2: 文档工作空间
  // =========================================================================

  /** 获取文献下所有产物（翻译/总结） */
  listDocumentArtifacts: (documentId: string) =>
    safeInvoke<DocumentArtifactDto[]>(IPC_COMMANDS.LIST_DOCUMENT_ARTIFACTS, { documentId }),

  /** 删除文档的翻译缓存 */
  deleteTranslationCache: (documentId: string) =>
    safeInvoke<DeleteCacheResult>(IPC_COMMANDS.DELETE_TRANSLATION_CACHE, { documentId }),

  /** 获取已保存的 AI 总结 */
  getDocumentSummary: (documentId: string) =>
    safeInvoke<AISummaryDto | null>(IPC_COMMANDS.GET_DOCUMENT_SUMMARY, { documentId }),

  /** 保存 AI 总结 */
  saveDocumentSummary: (documentId: string, contentMd: string, provider: string, model: string) =>
    safeInvoke<AISummaryDto>(IPC_COMMANDS.SAVE_DOCUMENT_SUMMARY, {
      documentId, contentMd, provider, model,
    }),

  /** 删除 AI 总结 */
  deleteDocumentSummary: (documentId: string) =>
    safeInvoke<DeleteSummaryResult>(IPC_COMMANDS.DELETE_DOCUMENT_SUMMARY, { documentId }),

  /** 从历史记录中移除文档（软删除） */
  removeRecentDocument: (documentId: string) =>
    safeInvoke<RemoveDocumentResult>(IPC_COMMANDS.REMOVE_RECENT_DOCUMENT, { documentId }),

  /** 收藏/取消收藏文档 */
  toggleDocumentFavorite: (documentId: string, favorite: boolean) =>
    safeInvoke<ToggleFavoriteResult>(IPC_COMMANDS.TOGGLE_DOCUMENT_FAVORITE, {
      documentId, favorite,
    }),

  /** 在 Finder 中显示文件 */
  revealInFinder: (filePath: string) =>
    safeInvoke<void>(IPC_COMMANDS.REVEAL_IN_FINDER, { filePath }),

  /** 获取缓存统计 */
  getCacheStats: () =>
    safeInvoke<CacheStatsDto>(IPC_COMMANDS.GET_CACHE_STATS),

  /** 清理所有翻译缓存 */
  clearAllTranslationCache: () =>
    safeInvoke<{ freedBytes: number }>(IPC_COMMANDS.CLEAR_ALL_TRANSLATION_CACHE),

  // --- H. 自定义提示词 ---

  /** 获取自定义提示词（含默认值） */
  getCustomPrompt: (promptKey: PromptKey) =>
    safeInvoke<CustomPromptDto>(IPC_COMMANDS.GET_CUSTOM_PROMPT, { promptKey }),

  /** 保存自定义提示词 */
  saveCustomPrompt: (promptKey: PromptKey, content: string) =>
    safeInvoke<CustomPromptDto>(IPC_COMMANDS.SAVE_CUSTOM_PROMPT, { promptKey, content }),

  /** 重置提示词为默认值 */
  resetCustomPrompt: (promptKey: PromptKey) =>
    safeInvoke<ResetCustomPromptResult>(IPC_COMMANDS.RESET_CUSTOM_PROMPT, { promptKey }),

  // =========================================================================
  // I. 标注
  // =========================================================================

  /** 创建标注 */
  saveAnnotation: (input: SaveAnnotationInput) =>
    safeInvoke<AnnotationDto>(IPC_COMMANDS.SAVE_ANNOTATION, { input }),

  /** 更新标注 */
  updateAnnotation: (input: UpdateAnnotationInput) =>
    safeInvoke<AnnotationDto>(IPC_COMMANDS.UPDATE_ANNOTATION, { input }),

  /** 删除标注 */
  deleteAnnotation: (annotationId: string) =>
    safeInvoke<DeleteAnnotationResult>(IPC_COMMANDS.DELETE_ANNOTATION, { annotationId }),

  /** 获取文档所有标注 */
  listAnnotations: (documentId: string) =>
    safeInvoke<AnnotationDto[]>(IPC_COMMANDS.LIST_ANNOTATIONS, { documentId }),

  /** 获取文档指定页标注 */
  listAnnotationsByPage: (documentId: string, pageNumber: number) =>
    safeInvoke<AnnotationDto[]>(IPC_COMMANDS.LIST_ANNOTATIONS_BY_PAGE, { documentId, pageNumber }),

  // =========================================================================
  // J. 翻译 Provider 配置与翻译
  // =========================================================================

  /** 列出所有翻译 Provider 配置 */
  listTranslationProviderConfigs: () =>
    safeInvoke<TranslationProviderConfigDto[]>(IPC_COMMANDS.LIST_TRANSLATION_PROVIDER_CONFIGS),

  /** 保存翻译 Provider API Key */
  saveTranslationProviderKey: (provider: string, apiKey: string) =>
    safeInvoke<TranslationProviderConfigDto>(IPC_COMMANDS.SAVE_TRANSLATION_PROVIDER_KEY, { provider, apiKey }),

  /** 设置活跃翻译 Provider */
  setActiveTranslationProvider: (provider: string, model: string) =>
    safeInvoke<TranslationProviderConfigDto>(IPC_COMMANDS.SET_ACTIVE_TRANSLATION_PROVIDER, { provider, model }),

  /** 更新翻译 Provider 配置 */
  updateTranslationProviderConfig: (provider: string, baseUrl?: string, model?: string) =>
    safeInvoke<TranslationProviderConfigDto>(IPC_COMMANDS.UPDATE_TRANSLATION_PROVIDER_CONFIG, { provider, baseUrl, model }),

  /** 测试翻译 Provider 连接 */
  testTranslationConnection: (provider: string) =>
    safeInvoke<TranslationConnectivityDto>(IPC_COMMANDS.TEST_TRANSLATION_CONNECTION, { provider }),

  /** 翻译文本 */
  translateText: (text: string) =>
    safeInvoke<TranslateTextResult>(IPC_COMMANDS.TRANSLATE_TEXT, { text }),

  // =========================================================================
  // K. 标题翻译缓存
  // =========================================================================

  /** 查询单个标题的缓存翻译 */
  getTitleTranslation: (title: string) =>
    safeInvoke<TitleTranslationDto>(IPC_COMMANDS.GET_TITLE_TRANSLATION, { title }),

  /** 批量翻译标题（缓存优先 + 串行限速） */
  batchTranslateTitles: (titles: string[]) =>
    safeInvoke<BatchTranslateTitlesResult>(IPC_COMMANDS.BATCH_TRANSLATE_TITLES, { titles }),

  // =========================================================================
  // L. Obsidian 笔记同步
  // =========================================================================

  /** 获取 Obsidian 配置 */
  getObsidianConfig: () =>
    safeInvoke<ObsidianConfigDto>(IPC_COMMANDS.GET_OBSIDIAN_CONFIG),

  /** 保存 Obsidian 配置 */
  saveObsidianConfig: (vaultPath?: string, autoSync?: boolean) =>
    safeInvoke<ObsidianConfigDto>(IPC_COMMANDS.SAVE_OBSIDIAN_CONFIG, { vaultPath, autoSync }),

  /** 校验 Vault 路径 */
  validateObsidianVault: (vaultPath: string) =>
    safeInvoke<ValidateVaultResult>(IPC_COMMANDS.VALIDATE_OBSIDIAN_VAULT, { vaultPath }),

  /** 导出总结到 Obsidian */
  exportSummaryToObsidian: (documentId: string, title: string, contentMd: string, summaryType?: string) =>
    safeInvoke<ExportSummaryResult>(IPC_COMMANDS.EXPORT_SUMMARY_TO_OBSIDIAN, { documentId, title, contentMd, summaryType }),

  /** 批量导出聊天到 Obsidian */
  exportChatsToObsidian: (documentId: string, title: string, sessionIds: string[]) =>
    safeInvoke<ExportChatsResult>(IPC_COMMANDS.EXPORT_CHATS_TO_OBSIDIAN, { documentId, title, sessionIds }),

  /** 自动检测本机 Obsidian Vault 列表 */
  detectObsidianVaults: () =>
    safeInvoke<DetectedVault[]>(IPC_COMMANDS.DETECT_OBSIDIAN_VAULTS),

  // -------------------------------------------------------------------------
  // Zotero 导出
  // -------------------------------------------------------------------------

  /** 将 Markdown 内容作为附件写入 Zotero 文献条目 */
  exportMdToZotero: (zoteroItemKey: string, filename: string, content: string, contentType?: string) =>
    safeInvoke<ZoteroExportResult>(IPC_COMMANDS.EXPORT_MD_TO_ZOTERO, { zoteroItemKey, filename, content, contentType }),

  /** 将磁盘上已有的 PDF 文件拷贝到 Zotero 附件 */
  exportPdfToZotero: (zoteroItemKey: string, sourceFilePath: string, targetFilename: string) =>
    safeInvoke<ZoteroExportResult>(IPC_COMMANDS.EXPORT_PDF_TO_ZOTERO, { zoteroItemKey, sourceFilePath, targetFilename }),

  // -------------------------------------------------------------------------
  // M. 精读模式
  // -------------------------------------------------------------------------

  /** 保存精读全文 */
  saveDeepReadText: (documentId: string, text: string) =>
    safeInvoke<DeepReadStatus>(IPC_COMMANDS.SAVE_DEEP_READ_TEXT, { documentId, text }),

  /** 清除精读文本 */
  clearDeepReadText: (documentId: string) =>
    safeInvoke<DeepReadStatus>(IPC_COMMANDS.CLEAR_DEEP_READ_TEXT, { documentId }),

  /** 查询精读状态 */
  getDeepReadStatus: (documentId: string) =>
    safeInvoke<DeepReadStatus>(IPC_COMMANDS.GET_DEEP_READ_STATUS, { documentId }),
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
