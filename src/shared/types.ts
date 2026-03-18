// =============================================================================
// Rastro IPC 契约类型定义
// 权威源: rust-backend-system.md Section 7 (IPC Contract)
// 生成日期: 2026-03-11
// =============================================================================

// ---------------------------------------------------------------------------
// 通用枚举类型
// ---------------------------------------------------------------------------

/** AI 服务商标识 */
export type ProviderId = "openai" | "claude" | "gemini";

/** 翻译任务状态 */
export type TranslationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** 翻译阶段（更细粒度的进度描述） */
export type TranslationStage =
  | "preflight"
  | "queued"
  | "extracting"
  | "translating"
  | "postprocessing"
  | "completed"
  | "failed"
  | "cancelled";

/** 文档来源类型 */
export type DocumentSourceType = "local" | "zotero";

/** 翻译产物类型（v1） */
export type TranslationArtifactKind =
  | "translated_pdf"
  | "bilingual_pdf"
  | "figure_report"
  | "manifest";

/** 文档产物类型（v2 统一枚举，覆盖所有产物来源） */
export type ArtifactKind =
  | "original_pdf"
  | "translated_pdf"
  | "bilingual_pdf"
  | "ai_summary"
  | "notebooklm_mindmap"
  | "notebooklm_slides"
  | "notebooklm_quiz"
  | "notebooklm_flashcards"
  | "notebooklm_audio"
  | "notebooklm_report"
  | "figure_report"
  | "manifest";

/** 翻译输出模式 */
export type TranslationOutputMode = "translated_only" | "bilingual";

/** 总结 Prompt 配置 */
export type SummaryPromptProfile = "default" | "paper-review";

/** 聊天消息角色 */
export type ChatRole = "user" | "assistant" | "system";

/** 标注类型 */
export type AnnotationType = "highlight" | "underline" | "note";

/** 标注颜色 */
export type AnnotationColor =
  | "yellow"
  | "red"
  | "green"
  | "blue"
  | "purple"
  | "magenta"
  | "orange"
  | "gray";

// ---------------------------------------------------------------------------
// 统一错误模型
// ---------------------------------------------------------------------------

/** 应用错误码（共 23 个） */
export type AppErrorCode =
  // 文档相关
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_UNSUPPORTED"
  // 翻译引擎相关
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_PORT_CONFLICT"
  | "ENGINE_TIMEOUT"
  // Python 环境相关 (Challenge H4 新增)
  | "PYTHON_NOT_FOUND"
  | "PYTHON_VERSION_MISMATCH"
  | "PDFMATHTRANSLATE_NOT_INSTALLED"
  // NotebookLM 相关
  | "NOTEBOOKLM_AUTH_REQUIRED"
  | "NOTEBOOKLM_AUTH_EXPIRED"
  | "NOTEBOOKLM_ENGINE_UNAVAILABLE"
  | "NOTEBOOKLM_UPLOAD_FAILED"
  | "NOTEBOOKLM_GENERATION_FAILED"
  | "NOTEBOOKLM_DOWNLOAD_FAILED"
  | "NOTEBOOKLM_RATE_LIMITED"
  | "NOTEBOOKLM_UNKNOWN"
  // 翻译任务相关
  | "TRANSLATION_FAILED"
  | "TRANSLATION_CANCELLED"
  // AI Provider 相关
  | "PROVIDER_KEY_MISSING"
  | "PROVIDER_CONNECTION_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_INSUFFICIENT_CREDIT"
  | "UNSUPPORTED_TRANSLATION_PROVIDER"
  // Zotero 相关
  | "ZOTERO_NOT_FOUND"
  | "ZOTERO_DB_LOCKED"
  // 缓存相关
  | "CACHE_CORRUPTED"
  // 安全与校验
  | "INVALID_PROVIDER_BASE_URL"
  | "RESOURCE_OWNERSHIP_MISMATCH"
  // 精确语义替代
  | "PROVIDER_NOT_CONFIGURED"
  | "CHAT_SESSION_NOT_FOUND"
  // 标注相关
  | "ANNOTATION_NOT_FOUND"
  // 通用
  | "INTERNAL_ERROR";

/** 统一错误对象——所有 Command 失败时返回此类型 */
export interface AppError {
  /** 错误码 */
  code: AppErrorCode;
  /** 用户可读的错误信息 */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 附加诊断信息 */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// A. 文档与应用状态
// ---------------------------------------------------------------------------

/** 文档快照（包含缓存可用性 + v2 状态字段） */
export interface DocumentSnapshot {
  documentId: string;
  filePath: string;
  fileSha256: string;
  title: string;
  pageCount: number;
  sourceType: DocumentSourceType;
  zoteroItemKey?: string;
  cachedTranslation?: {
    available: boolean;
    provider?: ProviderId;
    model?: string;
    translatedPdfPath?: string;
    bilingualPdfPath?: string;
    updatedAt?: string;
  };
  /** v2: 是否有已保存的 AI 总结 */
  hasSummary: boolean;
  /** v2: 是否已收藏 */
  isFavorite: boolean;
  /** v2: 文档关联的产物总数（翻译+总结+NotebookLM） */
  artifactCount: number;
  lastOpenedAt: string;
}

/** 后端健康状态 */
export interface BackendHealth {
  /** 数据库连接状态 */
  database: boolean;
  /** Keychain 可访问 */
  keychain: boolean;
  /** 翻译引擎状态 */
  translationEngine: TranslationEngineStatus;
  /** Zotero 探测状态 */
  zotero: ZoteroStatusDto;
  /** 后端版本 */
  version: string;
}

/** open_document 请求 */
export interface OpenDocumentInput {
  filePath: string;
  sourceType?: DocumentSourceType;
  zoteroItemKey?: string;
}

/** list_recent_documents 请求（v2 扩展：支持搜索和筛选） */
export interface ListRecentDocumentsInput {
  limit?: number;
  /** v2: 搜索关键词（匹配标题/文件名） */
  query?: string;
  /** v2: 筛选条件 */
  filter?: DocumentFilter;
}

/** get_document_snapshot 请求 */
export interface GetDocumentSnapshotInput {
  documentId: string;
}

// ---------------------------------------------------------------------------
// B. Translation Engine 生命周期
// ---------------------------------------------------------------------------

/** 翻译引擎状态 */
export interface TranslationEngineStatus {
  /** 是否正在运行 */
  running: boolean;
  /** PID（运行时） */
  pid?: number;
  /** 监听端口 */
  port: number;
  /** 引擎版本（健康检查返回） */
  engineVersion?: string;
  /** 是否处于熔断状态 */
  circuitBreakerOpen: boolean;
  /** 上次健康检查时间 */
  lastHealthCheck?: string;
}

/** ensure_translation_engine 请求 */
export interface EnsureTranslationEngineInput {
  expectedPort?: number;
  /** 强制重启，绕过熔断状态 (Challenge H5) */
  force?: boolean;
}

/** shutdown_translation_engine 请求 */
export interface ShutdownTranslationEngineInput {
  force?: boolean;
}

// ---------------------------------------------------------------------------
// C. 翻译任务
// ---------------------------------------------------------------------------

/** 翻译任务 DTO */
export interface TranslationJobDto {
  jobId: string;
  documentId: string;
  engineJobId?: string;
  status: TranslationJobStatus;
  stage: TranslationStage;
  /** 进度百分比 0-100 */
  progress: number;
  provider: ProviderId;
  model: string;
  translatedPdfPath?: string;
  bilingualPdfPath?: string;
  figureReportPath?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/** request_translation 请求 */
export interface RequestTranslationInput {
  documentId: string;
  filePath: string;
  sourceLang?: "en";
  targetLang?: "zh-CN";
  provider?: ProviderId;
  model?: string;
  outputMode?: TranslationOutputMode;
  figureTranslation?: boolean;
  skipReferencePages?: boolean;
  forceRefresh?: boolean;
}

/** get_translation_job 请求 */
export interface GetTranslationJobInput {
  jobId: string;
}

/** cancel_translation 请求 */
export interface CancelTranslationInput {
  jobId: string;
}

/** cancel_translation 响应 */
export interface CancelTranslationResult {
  jobId: string;
  cancelled: boolean;
}

/** load_cached_translation 请求 */
export interface LoadCachedTranslationInput {
  documentId: string;
  provider?: ProviderId;
  model?: string;
}

// ---------------------------------------------------------------------------
// C2. NotebookLM 集成
// ---------------------------------------------------------------------------

export type NotebookLMArtifactType =
  | "mind-map"
  | "slide-deck"
  | "quiz"
  | "flashcards"
  | "audio-overview"
  | "report";

export type NotebookLMTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface NotebookLMEngineStatus {
  running: boolean;
  pid?: number;
  port: number;
  engineVersion?: string;
  circuitBreakerOpen: boolean;
  lastHealthCheck?: string;
}

export interface NotebookLMAuthStatus {
  authenticated: boolean;
  authExpired: boolean;
  lastAuthAt?: string | null;
  lastError?: string | null;
}

export interface NotebookSummary {
  id: string;
  title: string;
  sourceCount: number;
  updatedAt?: string | null;
}

export interface NotebookLMTask {
  id: string;
  kind: "upload" | "generate" | "download";
  artifactType?: NotebookLMArtifactType | null;
  status: NotebookLMTaskStatus;
  progressMessage?: string | null;
  errorCode?: AppErrorCode | null;
  errorMessage?: string | null;
  notebookId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookArtifactSummary {
  id: string;
  notebookId: string;
  type: NotebookLMArtifactType;
  title: string;
  downloadStatus: "not-downloaded" | "downloaded" | "failed";
  localPath?: string | null;
  createdAt?: string | null;
}

export interface NotebookLMStatus {
  engine: NotebookLMEngineStatus;
  auth: NotebookLMAuthStatus;
  notebooks: NotebookSummary[];
}

export interface CreateNotebookInput {
  title: string;
  description?: string;
}

export interface AttachCurrentPdfInput {
  notebookId: string;
  pdfPath: string;
}

export interface GenerateArtifactInput {
  notebookId: string;
  artifactType: NotebookLMArtifactType;
}

export interface DownloadArtifactInput {
  artifactId: string;
  artifactType: NotebookLMArtifactType;
  title: string;
}

// ---------------------------------------------------------------------------
// D. AI 问答与总结
// ---------------------------------------------------------------------------

/** AI 流式句柄 */
export interface AIStreamHandle {
  streamId: string;
  sessionId: string;
  provider: ProviderId;
  model: string;
  startedAt: string;
}

/** ask_ai 请求 */
export interface AskAiInput {
  documentId: string;
  sessionId?: string;
  provider?: ProviderId;
  model?: string;
  userMessage: string;
  contextQuote?: string;
}

/** cancel_ai_stream 请求 */
export interface CancelAiStreamInput {
  streamId: string;
}

/** cancel_ai_stream 响应 */
export interface CancelAiStreamResult {
  streamId: string;
  cancelled: boolean;
}

/** generate_summary 请求 */
export interface GenerateSummaryInput {
  documentId: string;
  filePath: string;
  sourceText: string;
  provider?: ProviderId;
  model?: string;
  promptProfile?: SummaryPromptProfile;
}

/** 聊天会话 DTO */
export interface ChatSessionDto {
  sessionId: string;
  documentId: string;
  provider: ProviderId;
  model: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

/** list_chat_sessions 请求 */
export interface ListChatSessionsInput {
  documentId: string;
}

/** 聊天消息 DTO */
export interface ChatMessageDto {
  messageId: string;
  sessionId: string;
  role: ChatRole;
  contentMd: string;
  thinkingMd?: string;
  contextQuote?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  createdAt: string;
}

/** get_chat_messages 请求 */
export interface GetChatMessagesInput {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// E. Provider 配置与凭据
// ---------------------------------------------------------------------------

/** Provider 配置 DTO（脱敏） */
export interface ProviderConfigDto {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  isActive: boolean;
  /** 脱敏后的 API Key 摘要，如 "sk-...3Fz" */
  maskedKey?: string;
  lastTestStatus?: string;
  lastTestedAt?: string;
}

/** save_provider_key 请求 */
export interface SaveProviderKeyInput {
  provider: ProviderId;
  apiKey: string;
}

/** update_provider_config 请求 */
export interface UpdateProviderConfigInput {
  provider: ProviderId;
  baseUrl?: string;
  model?: string;
}

/** 可用模型信息 */
export interface ModelInfo {
  id: string;
  name?: string;
}

/** fetch_available_models 响应 */
export interface FetchModelsResult {
  provider: ProviderId;
  models: ModelInfo[];
}

/** remove_provider_key 请求 */
export interface RemoveProviderKeyInput {
  provider: ProviderId;
}

/** remove_provider_key 响应 */
export interface RemoveProviderKeyResult {
  provider: ProviderId;
  removed: boolean;
}

/** set_active_provider 请求 */
export interface SetActiveProviderInput {
  provider: ProviderId;
  model: string;
}

/** test_provider_connection 请求 */
export interface TestProviderConnectionInput {
  provider: ProviderId;
  model?: string;
}

/** Provider 连接测试结果 */
export interface ProviderConnectivityDto {
  provider: ProviderId;
  model: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// F. 使用统计
// ---------------------------------------------------------------------------

/** get_usage_stats 请求 */
export interface GetUsageStatsInput {
  from?: string;
  to?: string;
  provider?: ProviderId;
}

/** 使用统计 DTO */
export interface UsageStatsDto {
  /** 各 Provider 子统计 */
  byProvider: ProviderUsageDto[];
  /** 汇总 */
  total: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    currency: string;
  };
}

/** 单 Provider 使用统计 */
export interface ProviderUsageDto {
  provider: ProviderId;
  model: string;
  /** 各功能维度统计 */
  byFeature: FeatureUsageDto[];
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

/** 单功能维度使用统计 */
export interface FeatureUsageDto {
  feature: "chat" | "summary" | "translation";
  count: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

// ---------------------------------------------------------------------------
// G. Zotero 集成
// ---------------------------------------------------------------------------

/** Zotero 状态 */
export interface ZoteroStatusDto {
  /** 是否已发现 Zotero */
  detected: boolean;
  /** Zotero 数据库路径 */
  databasePath?: string;
  /** 总文献数 */
  itemCount?: number;
  /** 状态描述 */
  statusMessage: string;
}

/** Zotero 文件夹（collection） */
export interface ZoteroCollectionDto {
  collectionId: number;
  key: string;
  name: string;
  parentCollectionId: number | null;
  itemCount: number;
}

/** fetch_zotero_items 请求 */
export interface FetchZoteroItemsInput {
  query?: string;
  offset?: number;
  limit?: number;
}

/** fetch_zotero_collection_items 请求 */
export interface FetchZoteroCollectionItemsInput {
  collectionId?: number | null;
  query?: string;
  offset?: number;
  limit?: number;
}

/** 分页 Zotero 文献列表 */
export interface PagedZoteroItemsDto {
  items: ZoteroItemDto[];
  total: number;
  offset: number;
  limit: number;
}

/** Zotero 文献条目 */
export interface ZoteroItemDto {
  itemKey: string;
  title: string;
  authors: string[];
  year?: number;
  publicationTitle?: string;
  /** 关联的 PDF 附件路径 */
  pdfPath?: string;
  dateAdded: string;
}

/** open_zotero_attachment 请求 */
export interface OpenZoteroAttachmentInput {
  itemKey: string;
}

// ---------------------------------------------------------------------------
// V2: 文档工作空间 DTO
// ---------------------------------------------------------------------------

/** 文档产物统一 DTO（对齐 artifact_aggregator.rs::DocumentArtifactDto） */
export interface DocumentArtifactDto {
  artifactId: string;
  documentId: string;
  kind: ArtifactKind;
  title: string;
  filePath?: string;
  contentPreview?: string;
  provider?: ProviderId;
  model?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt: string;
}

/** AI 总结 DTO（对齐 ai.rs::AISummaryDto） */
export interface AISummaryDto {
  summaryId: string;
  documentId: string;
  contentMd: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

/** 文档筛选条件（对齐 document.rs::DocumentFilterInput） */
export interface DocumentFilter {
  hasTranslation?: boolean;
  hasSummary?: boolean;
  isFavorite?: boolean;
}

/** 缓存统计 DTO */
export interface CacheStatsDto {
  totalBytes: number;
  translationBytes: number;
  summaryBytes: number;
  summaryCount: number;
  documentCount: number;
}

// ---------------------------------------------------------------------------
// 自定义提示词 DTO（对齐 settings.rs）
// ---------------------------------------------------------------------------

/** 提示词 key 类型 */
export type PromptKey = "translation" | "summary";

/** 自定义提示词 DTO */
export interface CustomPromptDto {
  promptKey: PromptKey;
  content: string | null;
  isCustom: boolean;
  defaultContent: string;
}

/** 重置提示词结果 */
export interface ResetCustomPromptResult {
  reset: boolean;
}

// ---------------------------------------------------------------------------
// I. 标注
// ---------------------------------------------------------------------------

/** 标注矩形 DTO（PDF 归一化坐标） */
export interface AnnotationRectDto {
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
}

/** 标注 DTO */
export interface AnnotationDto {
  annotationId: string;
  documentId: string;
  type: AnnotationType;
  color: AnnotationColor;
  pageNumber: number;
  text: string;
  noteContent?: string;
  rects: AnnotationRectDto[];
  createdAt: string;
  updatedAt: string;
}

/** save_annotation 请求 */
export interface SaveAnnotationInput {
  documentId: string;
  type: AnnotationType;
  color: AnnotationColor;
  pageNumber: number;
  text: string;
  noteContent?: string;
  rects: AnnotationRectDto[];
}

/** update_annotation 请求 */
export interface UpdateAnnotationInput {
  annotationId: string;
  color?: AnnotationColor;
  noteContent?: string;
}

/** delete_annotation 响应 */
export interface DeleteAnnotationResult {
  deleted: boolean;
}

/** 删除翻译缓存结果（对齐 translation.rs::DeleteCacheResult） */
export interface DeleteCacheResult {
  deleted: boolean;
  freedBytes: number;
}

// ---------------------------------------------------------------------------
// J. 翻译 Provider 配置（ADR-301 独立配置）
// ---------------------------------------------------------------------------

/** 翻译 Provider 配置 DTO（对齐 translation_settings.rs::TranslationProviderConfigDto） */
export interface TranslationProviderConfigDto {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  isActive: boolean;
  maskedKey?: string;
}

/** 翻译 Provider 连接测试结果 */
export interface TranslationConnectivityDto {
  provider: ProviderId;
  model: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/** translate_text 返回值 */
export interface TranslateTextResult {
  translated: string;
}

// ---------------------------------------------------------------------------
// K. 标题翻译缓存 (v3)
// ---------------------------------------------------------------------------

/** 单个标题翻译查询结果 */
export interface TitleTranslationDto {
  originalTitle: string;
  translatedTitle: string | null;
}

/** 批量翻译标题结果 */
export interface BatchTranslateTitlesResult {
  /** 原始标题 → 翻译结果 */
  results: Record<string, string>;
  /** 跳过的标题数量（非英文或已缓存） */
  skipped: number;
  /** 实际翻译的标题数量 */
  translated: number;
}

/** 删除 AI 总结结果（对齐 ai.rs::DeleteSummaryResult） */
export interface DeleteSummaryResult {
  deleted: boolean;
}

/** 移除文档结果 */
export interface RemoveDocumentResult {
  removed: boolean;
}

/** 收藏切换结果 */
export interface ToggleFavoriteResult {
  updated: boolean;
}

// ---------------------------------------------------------------------------
// Tauri Event Payloads
// ---------------------------------------------------------------------------

/** translation://job-progress 事件 payload */
export type TranslationJobProgressPayload = TranslationJobDto;

/** translation://job-completed 事件 payload */
export type TranslationJobCompletedPayload = TranslationJobDto;

/** translation://job-failed 事件 payload */
export interface TranslationJobFailedPayload {
  jobId: string;
  error: AppError;
}

/** ai://stream-chunk 事件 payload */
export interface AiStreamChunkPayload {
  streamId: string;
  delta: string;
  kind?: "content" | "thinking";
}

/** ai://stream-finished 事件 payload */
export interface AiStreamFinishedPayload {
  streamId: string;
  sessionId: string;
  messageId: string;
}

/** ai://stream-failed 事件 payload */
export interface AiStreamFailedPayload {
  streamId: string;
  error: AppError;
}

// ---------------------------------------------------------------------------
// Command 名称常量（便于前端 IPC Client 引用）
// ---------------------------------------------------------------------------

/** 全部 Tauri IPC Command 名称 */
export const IPC_COMMANDS = {
  // A. 文档与应用状态
  GET_BACKEND_HEALTH: "get_backend_health",
  OPEN_DOCUMENT: "open_document",
  LIST_RECENT_DOCUMENTS: "list_recent_documents",
  GET_DOCUMENT_SNAPSHOT: "get_document_snapshot",
  // B. Translation Engine 生命周期
  ENSURE_TRANSLATION_ENGINE: "ensure_translation_engine",
  SHUTDOWN_TRANSLATION_ENGINE: "shutdown_translation_engine",
  GET_TRANSLATION_ENGINE_STATUS: "get_translation_engine_status",
  // C. 翻译任务
  REQUEST_TRANSLATION: "request_translation",
  GET_TRANSLATION_JOB: "get_translation_job",
  CANCEL_TRANSLATION: "cancel_translation",
  LOAD_CACHED_TRANSLATION: "load_cached_translation",
  // C2. NotebookLM 集成
  NOTEBOOKLM_GET_STATUS: "notebooklm_get_status",
  NOTEBOOKLM_BEGIN_LOGIN: "notebooklm_begin_login",
  NOTEBOOKLM_OPEN_EXTERNAL: "notebooklm_open_external",
  NOTEBOOKLM_LOGOUT: "notebooklm_logout",
  NOTEBOOKLM_LIST_NOTEBOOKS: "notebooklm_list_notebooks",
  NOTEBOOKLM_CREATE_NOTEBOOK: "notebooklm_create_notebook",
  NOTEBOOKLM_ATTACH_CURRENT_PDF: "notebooklm_attach_current_pdf",
  NOTEBOOKLM_GENERATE_ARTIFACT: "notebooklm_generate_artifact",
  NOTEBOOKLM_GET_TASK: "notebooklm_get_task",
  NOTEBOOKLM_LIST_ARTIFACTS: "notebooklm_list_artifacts",
  NOTEBOOKLM_DOWNLOAD_ARTIFACT: "notebooklm_download_artifact",
  // D. AI 问答与总结
  ASK_AI: "ask_ai",
  CANCEL_AI_STREAM: "cancel_ai_stream",
  GENERATE_SUMMARY: "generate_summary",
  LIST_CHAT_SESSIONS: "list_chat_sessions",
  GET_CHAT_MESSAGES: "get_chat_messages",
  // E. Provider 配置与凭据
  LIST_PROVIDER_CONFIGS: "list_provider_configs",
  SAVE_PROVIDER_KEY: "save_provider_key",
  REMOVE_PROVIDER_KEY: "remove_provider_key",
  SET_ACTIVE_PROVIDER: "set_active_provider",
  TEST_PROVIDER_CONNECTION: "test_provider_connection",
  UPDATE_PROVIDER_CONFIG: "update_provider_config",
  FETCH_AVAILABLE_MODELS: "fetch_available_models",
  // F. 使用统计
  GET_USAGE_STATS: "get_usage_stats",
  // G. Zotero 集成
  DETECT_ZOTERO_LIBRARY: "detect_zotero_library",
  FETCH_ZOTERO_ITEMS: "fetch_zotero_items",
  FETCH_ZOTERO_COLLECTIONS: "fetch_zotero_collections",
  FETCH_ZOTERO_COLLECTION_ITEMS: "fetch_zotero_collection_items",
  OPEN_ZOTERO_ATTACHMENT: "open_zotero_attachment",
  // V2: 文档工作空间
  LIST_DOCUMENT_ARTIFACTS: "list_document_artifacts",
  DELETE_TRANSLATION_CACHE: "delete_translation_cache",
  GET_DOCUMENT_SUMMARY: "get_document_summary",
  SAVE_DOCUMENT_SUMMARY: "save_document_summary",
  DELETE_DOCUMENT_SUMMARY: "delete_document_summary",
  REMOVE_RECENT_DOCUMENT: "remove_recent_document",
  TOGGLE_DOCUMENT_FAVORITE: "toggle_document_favorite",
  REVEAL_IN_FINDER: "reveal_in_finder",
  GET_CACHE_STATS: "get_cache_stats",
  CLEAR_ALL_TRANSLATION_CACHE: "clear_all_translation_cache",
  // H. 自定义提示词
  GET_CUSTOM_PROMPT: "get_custom_prompt",
  SAVE_CUSTOM_PROMPT: "save_custom_prompt",
  RESET_CUSTOM_PROMPT: "reset_custom_prompt",
  // I. 标注
  SAVE_ANNOTATION: "save_annotation",
  UPDATE_ANNOTATION: "update_annotation",
  DELETE_ANNOTATION: "delete_annotation",
  LIST_ANNOTATIONS: "list_annotations",
  LIST_ANNOTATIONS_BY_PAGE: "list_annotations_by_page",
  // J. 翻译 Provider 配置
  LIST_TRANSLATION_PROVIDER_CONFIGS: "list_translation_provider_configs",
  SAVE_TRANSLATION_PROVIDER_KEY: "save_translation_provider_key",
  SET_ACTIVE_TRANSLATION_PROVIDER: "set_active_translation_provider",
  UPDATE_TRANSLATION_PROVIDER_CONFIG: "update_translation_provider_config",
  TEST_TRANSLATION_CONNECTION: "test_translation_connection",
  TRANSLATE_TEXT: "translate_text",
  // K. 标题翻译缓存
  GET_TITLE_TRANSLATION: "get_title_translation",
  BATCH_TRANSLATE_TITLES: "batch_translate_titles",
} as const;

/** Tauri Event 名称常量 */
export const IPC_EVENTS = {
  TRANSLATION_JOB_PROGRESS: "translation://job-progress",
  TRANSLATION_JOB_COMPLETED: "translation://job-completed",
  TRANSLATION_JOB_FAILED: "translation://job-failed",
  AI_STREAM_CHUNK: "ai://stream-chunk",
  AI_STREAM_FINISHED: "ai://stream-finished",
  AI_STREAM_FAILED: "ai://stream-failed",
} as const;
