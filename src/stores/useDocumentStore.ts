import { create } from 'zustand';
import type {
  DocumentSnapshot,
  TranslationJobDto,
  DocumentArtifactDto,
  DocumentFilter,
} from '../shared/types';
import { ipcClient } from '../lib/ipc-client';
import { useChatStore } from './useChatStore';
import { useSummaryStore } from './useSummaryStore';

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

    set({
      currentDocument: doc,
      bilingualMode: false,
      translationJob: null,
      translationProgress: 0,
      translatedPdfUrl: null,
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
}));

