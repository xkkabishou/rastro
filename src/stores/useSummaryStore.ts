import { create } from 'zustand';
import type { AiStreamChunkPayload } from '../shared/types';
import { ipcEvents } from '../lib/ipc-client';

interface SummaryState {
  summaryContent: string;
  isGenerating: boolean;
  activeStreamId: string | null;
  hasGenerated: boolean;
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
}

const buildErrorContent = (existingContent: string, errorMessage: string) => (
  existingContent.trim()
    ? `${existingContent}\n\n⚠️ ${errorMessage}`
    : `⚠️ ${errorMessage}`
);

export const useSummaryStore = create<SummaryState>((set) => ({
  summaryContent: '',
  isGenerating: false,
  activeStreamId: null,
  hasGenerated: false,

  startGeneration: () => set({
    summaryContent: '',
    isGenerating: true,
    activeStreamId: null,
    hasGenerated: true,
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

  finishStream: (streamId) => set((state) => {
    if (state.activeStreamId !== streamId) {
      return state;
    }

    return {
      isGenerating: false,
      activeStreamId: null,
    };
  }),

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
