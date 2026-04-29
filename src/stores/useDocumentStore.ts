import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import type {
  DocumentSnapshot,
  TranslationJobDto,
  DocumentArtifactDto,
  DocumentFilter,
} from '../shared/types';
import { ipcClient, ipcEvents } from '../lib/ipc-client';
import { useChatStore } from './useChatStore';
import { useSummaryStore } from './useSummaryStore';

function toProgressPercentage(progress: number): number {
  const normalized = progress > 1 ? progress / 100 : progress;
  return Math.round(Math.min(100, Math.max(0, normalized * 100)));
}

/** 根据文档快照的 cachedTranslation 解析翻译 PDF 的 Tauri asset URL */
function resolveCachedTranslationUrl(
  cached: DocumentSnapshot['cachedTranslation'] | undefined,
): string | null {
  const filePath = cached?.translatedPdfPath ?? cached?.bilingualPdfPath ?? null;
  return filePath ? convertFileSrc(filePath) : null;
}

function shouldSyncLiveTranslationJob(
  store: DocumentState,
  job: TranslationJobDto,
): boolean {
  if (store.currentDocument?.documentId === job.documentId) {
    return true;
  }

  return store.translationJob?.jobId === job.jobId;
}

interface DocumentState {
  /** 当前打开的文档 */
  currentDocument: DocumentSnapshot | null;
  /** 当前缩放级别 */
  zoomLevel: number;
  /** 是否处于双语模式（按住 Option 键时显示原文） */
  bilingualMode: boolean;
  /** 翻译状态 */
  translationJob: TranslationJobDto | null;
  /** 翻译进度 (0-100) */
  translationProgress: number;
  /** 最近文档列表 */
  recentDocuments: DocumentSnapshot[];
  /** 当前 PDF 的 URL (本地文件或 objectURL) */
  pdfUrl: string | null;
  /** 翻译后 PDF 的 URL */
  translatedPdfUrl: string | null;

  // V2: 树形侧栏状态
  /** 文档产物缓存，key = documentId */
  artifactsByDocId: Record<string, DocumentArtifactDto[]>;
  /** 已展开的文档 ID 集合 */
  expandedDocIds: Set<string>;
  /** 侧栏搜索关键词 */
  searchQuery: string;
  /** 侧栏筛选条件 */
  activeFilter: DocumentFilter;

  // Actions (v1)
  setCurrentDocument: (doc: DocumentSnapshot | null) => void;
  setZoomLevel: (level: number) => void;
  setBilingualMode: (mode: boolean) => void;
  setTranslationJob: (job: TranslationJobDto | null) => void;
  setTranslationProgress: (progress: number) => void;
  setRecentDocuments: (docs: DocumentSnapshot[]) => void;
  setPdfUrl: (url: string | null) => void;
  setTranslatedPdfUrl: (url: string | null) => void;
  reset: () => void;

  // Actions (v2)
  /** 展开/折叠文档节点；首次展开时自动加载产物 */
  toggleExpand: (docId: string) => void;
  /** 加载文档产物（forceRefresh=true 时忽略缓存） */
  loadArtifacts: (docId: string, forceRefresh?: boolean) => Promise<void>;
  /** 设置侧栏搜索关键词 */
  setSearchQuery: (query: string) => void;
  /** 设置侧栏筛选条件 */
  setActiveFilter: (filter: DocumentFilter) => void;
  /** 清除指定文档的产物缓存 */
  invalidateArtifacts: (docId: string) => void;
  /** T2.4.2: 刷新单个文档快照数据（操作后同步侧栏状态） */
  refreshDocumentSnapshot: (docId: string) => Promise<void>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  currentDocument: null,
  zoomLevel: 100,
  bilingualMode: false,
  translationJob: null,
  translationProgress: 0,
  recentDocuments: [],
  pdfUrl: null,
  translatedPdfUrl: null,

  // V2 初始值
  artifactsByDocId: {},
  expandedDocIds: new Set<string>(),
  searchQuery: '',
  activeFilter: {},

  setCurrentDocument: (doc) => {
    const prev = useDocumentStore.getState().currentDocument;
    const prevId = prev?.documentId ?? null;
    const nextId = doc?.documentId ?? null;

    // 同文档重新打开时只更新快照，不重置翻译状态（避免白屏）
    if (prevId && prevId === nextId) {
      set({ currentDocument: doc });
      return;
    }

    // 不同文档切换：根据目标文档的 cachedTranslation 自动恢复翻译视图。
    // 这里统一处理"打开文档时默认加载已有翻译"的意图，
    // 下游（如 Sidebar.case 'original_pdf'）可以在 setCurrentDocument 之后
    // 通过 setTranslatedPdfUrl(null) 显式覆盖，保证"点原文就看原文"的用户意图。
    set({
      currentDocument: doc,
      bilingualMode: false,
      translationJob: null,
      translationProgress: 0,
      translatedPdfUrl: resolveCachedTranslationUrl(doc?.cachedTranslation),
    });

    // 文档切换时：取消活跃流 + 清空聊天/总结
    if (prevId && prevId !== nextId) {
      const chatStreamId = useChatStore.getState().activeStreamId;
      const summaryStreamId = useSummaryStore.getState().activeStreamId;
      const activeIds = [chatStreamId, summaryStreamId].filter(Boolean) as string[];

      activeIds.forEach((streamId) => {
        ipcClient.cancelAiStream(streamId).catch((err: unknown) => {
          console.error('取消旧的 AI 流失败:', err);
        });
      });

      useChatStore.getState().clearChat();
      useSummaryStore.getState().resetSummary();
    }
  },
  setZoomLevel: (level) => set({ zoomLevel: Math.max(25, Math.min(400, level)) }),
  setBilingualMode: (mode) => set({ bilingualMode: mode }),
  setTranslationJob: (job) => set({ translationJob: job }),
  setTranslationProgress: (progress) => set({ translationProgress: progress }),
  setRecentDocuments: (docs) => set({ recentDocuments: docs }),
  setPdfUrl: (url) => set({ pdfUrl: url }),
  setTranslatedPdfUrl: (url) => set({ translatedPdfUrl: url }),
  reset: () => set({
    currentDocument: null,
    zoomLevel: 100,
    bilingualMode: false,
    translationJob: null,
    translationProgress: 0,
    pdfUrl: null,
    translatedPdfUrl: null,
    artifactsByDocId: {},
    expandedDocIds: new Set<string>(),
    searchQuery: '',
    activeFilter: {},
  }),

  // --- V2 Actions ---

  toggleExpand: (docId) => {
    const { expandedDocIds, artifactsByDocId } = get();
    const next = new Set(expandedDocIds);

    if (next.has(docId)) {
      // 折叠
      next.delete(docId);
      set({ expandedDocIds: next });
    } else {
      // 展开
      next.add(docId);
      set({ expandedDocIds: next });

      // 首次展开且无缓存时，自动加载产物
      if (!artifactsByDocId[docId]) {
        get().loadArtifacts(docId);
      }
    }
  },

  loadArtifacts: async (docId, forceRefresh = false) => {
    const { artifactsByDocId } = get();

    // 有缓存且不强制刷新时跳过
    if (artifactsByDocId[docId] && !forceRefresh) {
      return;
    }

    try {
      const artifacts = await ipcClient.listDocumentArtifacts(docId);
      set({
        artifactsByDocId: {
          ...get().artifactsByDocId,
          [docId]: artifacts,
        },
      });
    } catch (err) {
      console.error(`加载文档 ${docId} 产物失败:`, err);
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setActiveFilter: (filter) => set({ activeFilter: filter }),

  invalidateArtifacts: (docId) => {
    const { artifactsByDocId } = get();
    const next = { ...artifactsByDocId };
    delete next[docId];
    set({ artifactsByDocId: next });
  },

  // T2.4.2: 刷新单个文档快照（操作后同步侧栏状态 icon）
  refreshDocumentSnapshot: async (docId) => {
    try {
      const snapshot = await ipcClient.getDocumentSnapshot(docId);
      const { recentDocuments, currentDocument } = get();
      // 更新 recentDocuments 中对应的条目
      const updatedDocs = recentDocuments.map((d) =>
        d.documentId === docId ? snapshot : d,
      );
      const updates: Partial<DocumentState> = { recentDocuments: updatedDocs };
      // 如果当前文档就是被刷新的文档，也同步更新
      if (currentDocument?.documentId === docId) {
        updates.currentDocument = snapshot;
      }
      set(updates);
    } catch (err) {
      console.error(`刷新文档快照 ${docId} 失败:`, err);
    }
  },
}));

// ---------------------------------------------------------------------------
// R2-L1: 注册 Tauri 事件监听，实现产物状态实时更新
// ---------------------------------------------------------------------------

// 使用 unlisteners 数组替代单一 boolean flag：
// 1. 当已有监听器或注册仍在进行中时，重复 init 直接跳过（幂等）
// 2. 任一 listen 调用失败时回滚已注册监听器，下次 init 可重试
// 3. cleanup 会提升 generation，防止晚到的 listen Promise 在卸载后重新写入旧监听器
let unlisteners: Array<() => void> = [];
let listenerRegistrationInFlight = false;
let listenerGeneration = 0;

/** 初始化 Tauri 后端事件监听（幂等，仅首次生效） */
export function initDocumentEventListeners(): void {
  if (listenerRegistrationInFlight || unlisteners.length > 0) return;
  listenerRegistrationInFlight = true;
  const generation = listenerGeneration;

  const registerProgress = ipcEvents.onTranslationProgress((job) => {
    const store = useDocumentStore.getState();
    if (!shouldSyncLiveTranslationJob(store, job)) {
      return;
    }

    store.setTranslationJob(job);
    store.setTranslationProgress(toProgressPercentage(job.progress));
  });

  // 翻译完成事件 → 刷新对应文档的产物 + 快照
  const registerCompleted = ipcEvents.onTranslationCompleted((job) => {
    const docId = job.documentId;
    if (!docId) return;
    const store = useDocumentStore.getState();
    if (shouldSyncLiveTranslationJob(store, job)) {
      store.setTranslationJob(job);
      store.setTranslationProgress(toProgressPercentage(job.progress));
      // 使用 convertFileSrc 将文件路径转为 Tauri asset URL，否则 PdfViewer 无法加载
      const translatedPath = job.translatedPdfPath ?? job.bilingualPdfPath ?? null;
      store.setTranslatedPdfUrl(translatedPath ? convertFileSrc(translatedPath) : null);
    }
    store.invalidateArtifacts(docId);
    store.refreshDocumentSnapshot(docId);
    // 如果文档已展开，自动重新加载产物列表
    if (store.expandedDocIds.has(docId)) {
      store.loadArtifacts(docId, true);
    }
  });

  // AI 总结完成事件 → 刷新对应文档的产物 + 快照
  const registerSummaryFinished = listen<{ documentId: string }>(
    'ai://stream-finished',
    (event) => {
      const docId = event.payload?.documentId;
      if (!docId) return;
      const store = useDocumentStore.getState();
      store.invalidateArtifacts(docId);
      store.refreshDocumentSnapshot(docId);
      if (store.expandedDocIds.has(docId)) {
        store.loadArtifacts(docId, true);
      }
    },
  );

  Promise.allSettled([registerProgress, registerCompleted, registerSummaryFinished])
    .then((results) => {
      const registered = results
        .filter((result): result is PromiseFulfilledResult<() => void> => (
          result.status === 'fulfilled'
        ))
        .map((result) => result.value);
      const failed = results.filter((result) => result.status === 'rejected');

      if (generation !== listenerGeneration || failed.length > 0) {
        for (const unlisten of registered) {
          try {
            unlisten();
          } catch (err) {
            console.error('回滚文档事件监听器失败:', err);
          }
        }
      } else {
        unlisteners.push(...registered);
      }

      for (const result of failed) {
        console.error('注册文档事件监听失败:', result.reason);
      }
    })
    .finally(() => {
      if (generation === listenerGeneration) {
        listenerRegistrationInFlight = false;
      }
    });
}

/**
 * 清理所有已注册的文档事件监听器。
 * 调用后 `unlisteners` 数组为空，下次 `initDocumentEventListeners()` 可重新注册。
 */
export function cleanupDocumentEventListeners(): void {
  listenerGeneration += 1;
  listenerRegistrationInFlight = false;
  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch (err) {
      console.error('卸载文档事件监听器失败:', err);
    }
  }
  unlisteners = [];
}
