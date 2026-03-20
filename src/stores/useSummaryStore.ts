import { create } from 'zustand';
import type { AiStreamChunkPayload } from '../shared/types';
import { ipcEvents, ipcClient } from '../lib/ipc-client';
import { useObsidianStore } from './useObsidianStore';
import { useDocumentStore } from './useDocumentStore';

interface SummaryState {
  summaryContent: string;
  isGenerating: boolean;
  activeStreamId: string | null;
  hasGenerated: boolean;
  /** T2.4.5: 已保存的总结 ID（来自持久化） */
  savedSummaryId: string | null;
  /** T2.4.5: 当前总结关联的文档 ID */
  currentDocumentId: string | null;
  /** T2.4.5: 是否正在加载已保存的总结 */
  isLoadingSaved: boolean;
  startGeneration: () => void;
  setActiveStreamId: (streamId: string | null) => void;
  appendStreamChunk: (
    streamId: string,
    delta: string,
    kind?: AiStreamChunkPayload['kind'],
  ) => void;
  finishStream: (streamId: string) => void;
  failStream: (streamId: string | null, errorMessage: string) => void;
  resetSummary: () => void;
  /** T2.4.5: 加载已保存的总结 */
  loadSavedSummary: (documentId: string) => Promise<void>;
  /** T2.4.5: 设置已保存的总结内容 */
  setSavedContent: (content: string, summaryId: string, documentId: string) => void;
}

const buildErrorContent = (existingContent: string, errorMessage: string) => (
  existingContent.trim()
    ? `${existingContent}\n\n⚠️ ${errorMessage}`
    : `⚠️ ${errorMessage}`
);

export const useSummaryStore = create<SummaryState>((set, get) => ({
  summaryContent: '',
  isGenerating: false,
  activeStreamId: null,
  hasGenerated: false,
  savedSummaryId: null,
  currentDocumentId: null,
  isLoadingSaved: false,

  startGeneration: () => set({
    summaryContent: '',
    isGenerating: true,
    activeStreamId: null,
    hasGenerated: true,
    savedSummaryId: null,
  }),

  setActiveStreamId: (streamId) => set({ activeStreamId: streamId }),

  appendStreamChunk: (streamId, delta, kind = 'content') => {
    if (kind === 'thinking') {
      return;
    }

    set((state) => {
      if (state.activeStreamId !== streamId) {
        return state;
      }

      return {
        summaryContent: `${state.summaryContent}${delta}`,
      };
    });
  },

  finishStream: (streamId) => {
    const state = get();
    if (state.activeStreamId !== streamId) return;

    set({
      isGenerating: false,
      activeStreamId: null,
    });

    // T2.4.5: 生成完成后自动持久化保存
    const { summaryContent, currentDocumentId } = get();
    if (currentDocumentId && summaryContent.trim()) {
      ipcClient
        .saveDocumentSummary(currentDocumentId, summaryContent, 'ai', 'default')
        .then((saved) => {
          set({ savedSummaryId: saved.summaryId });
          console.log('[Summary] 自动保存成功:', saved.summaryId);
          // Obsidian 自动同步
          const doc = useDocumentStore.getState().currentDocument;
          const docTitle = doc?.title || '未命名文献';
          useObsidianStore.getState().autoSyncSummary(currentDocumentId!, docTitle, summaryContent);
          // Zotero 自动同步：如果文献来自 Zotero，同时写入附件
          if (doc?.zoteroItemKey) {
            ipcClient
              .exportMdToZotero(doc.zoteroItemKey, '总结.md', summaryContent)
              .then(() => console.log('[Summary] Zotero 自动同步成功'))
              .catch((e: unknown) => console.warn('[Summary] Zotero 自动同步失败:', e));
          }
        })
        .catch((err: unknown) => {
          console.error('[Summary] 自动保存失败:', err);
        });
    }
  },

  failStream: (streamId, errorMessage) => set((state) => {
    if (streamId && state.activeStreamId !== streamId) {
      return state;
    }

    return {
      summaryContent: buildErrorContent(state.summaryContent, errorMessage),
      isGenerating: false,
      activeStreamId: null,
      hasGenerated: true,
    };
  }),

  resetSummary: () => set({
    summaryContent: '',
    isGenerating: false,
    activeStreamId: null,
    hasGenerated: false,
    savedSummaryId: null,
    currentDocumentId: null,
    isLoadingSaved: false,
  }),

  // T2.4.5: 加载已保存的总结
  loadSavedSummary: async (documentId: string) => {
    set({ isLoadingSaved: true, currentDocumentId: documentId });
    try {
      const saved = await ipcClient.getDocumentSummary(documentId);
      if (saved && saved.contentMd.trim()) {
        set({
          summaryContent: saved.contentMd,
          hasGenerated: true,
          savedSummaryId: saved.summaryId,
          isLoadingSaved: false,
        });
      } else {
        set({ isLoadingSaved: false });
      }
    } catch (err) {
      console.error('[Summary] 加载已保存总结失败:', err);
      set({ isLoadingSaved: false });
    }
  },

  // T2.4.5: 设置已保存的总结内容
  setSavedContent: (content: string, summaryId: string, documentId: string) => set({
    summaryContent: content,
    hasGenerated: true,
    savedSummaryId: summaryId,
    currentDocumentId: documentId,
    isLoadingSaved: false,
  }),
}));

// ---------------------------------------------------------------------------
// 模块级事件监听：处理 Summary 相关的 AI 流事件
// 应用启动时执行一次，无需清理（与应用同生命周期）
// ---------------------------------------------------------------------------

void ipcEvents.onAiStreamChunk((payload) => {
  const state = useSummaryStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.appendStreamChunk(payload.streamId, payload.delta, payload.kind);
  }
});

void ipcEvents.onAiStreamFinished((payload) => {
  const state = useSummaryStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.finishStream(payload.streamId);
  }
});

void ipcEvents.onAiStreamFailed((payload) => {
  const state = useSummaryStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.failStream(payload.streamId, payload.error.message);
  }
});
