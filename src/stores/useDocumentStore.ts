import { create } from 'zustand';
import type { DocumentSnapshot, TranslationJobDto } from '../shared/types';
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

  // Actions
  setCurrentDocument: (doc: DocumentSnapshot | null) => void;
  setZoomLevel: (level: number) => void;
  setBilingualMode: (mode: boolean) => void;
  setTranslationJob: (job: TranslationJobDto | null) => void;
  setTranslationProgress: (progress: number) => void;
  setRecentDocuments: (docs: DocumentSnapshot[]) => void;
  setPdfUrl: (url: string | null) => void;
  setTranslatedPdfUrl: (url: string | null) => void;
  reset: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  currentDocument: null,
  zoomLevel: 100,
  bilingualMode: false,
  translationJob: null,
  translationProgress: 0,
  recentDocuments: [],
  pdfUrl: null,
  translatedPdfUrl: null,

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
  }),
}));
