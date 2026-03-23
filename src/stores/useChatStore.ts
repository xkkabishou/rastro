import { create } from 'zustand';
import type { ChatSessionDto, ChatMessageDto, ProviderId } from '../shared/types';
import { ipcEvents } from '../lib/ipc-client';

/** 前端聊天消息（包含流式状态） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingContent?: string;
  contextQuote?: string;
  timestamp: string;
  isStreaming?: boolean;
}

const buildAssistantStreamMessage = (
  streamId: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: `stream-${streamId}`,
  role: 'assistant',
  content: '',
  thinkingContent: '',
  timestamp: new Date().toISOString(),
  isStreaming: true,
  ...overrides,
});

const updateOrInsertStreamMessage = (
  messages: ChatMessage[],
  streamId: string,
  updater: (message: ChatMessage | null) => ChatMessage,
) => {
  const messageId = `stream-${streamId}`;
  const index = messages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    return [...messages, updater(null)];
  }

  return messages.map((message, messageIndex) => (
    messageIndex === index ? updater(message) : message
  ));
};

interface ChatState {
  activeSessionId: string | null;
  sessions: ChatSessionDto[];
  messages: ChatMessage[];
  inputText: string;
  contextQuote: string | null;
  /** 当前流式 stream ID（非 null 即表示正在流式响应中） */
  activeStreamId: string | null;
  isLoadingHistory: boolean;

  // Actions
  setActiveSession: (sessionId: string | null) => void;
  setSessions: (sessions: ChatSessionDto[]) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setInputText: (text: string) => void;
  setContextQuote: (quote: string | null) => void;
  addUserMessage: (content: string, contextQuote?: string) => void;
  startAssistantStream: (streamId: string) => void;
  appendStreamChunk: (
    streamId: string,
    delta: string,
    kind?: 'content' | 'thinking',
  ) => void;
  finishStream: (streamId: string, messageId: string) => void;
  failStream: (streamId: string, errorMessage: string) => void;
  cancelStream: () => void;
  setLoadingHistory: (loading: boolean) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  sessions: [],
  messages: [],
  inputText: '',
  contextQuote: null,
  activeStreamId: null,
  isLoadingHistory: false,

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (messages) => set({ messages }),
  setInputText: (text) => set({ inputText: text }),
  setContextQuote: (quote) => set({ contextQuote: quote }),

  addUserMessage: (content, contextQuote) => {
    const msg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      contextQuote,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  startAssistantStream: (streamId) => {
    set((state) => ({
      ...(state.messages.some((message) => message.id === `stream-${streamId}`)
        ? {}
        : {
            messages: [...state.messages, buildAssistantStreamMessage(streamId)],
          }),
      activeStreamId: state.messages.some((message) => (
        message.id === `stream-${streamId}` && message.isStreaming === false
      ))
        ? state.activeStreamId
        : streamId,
    }));
  },

  appendStreamChunk: (streamId, delta, kind = 'content') => {
    set((state) => ({
      messages: updateOrInsertStreamMessage(state.messages, streamId, (message) => ({
        ...(message ?? buildAssistantStreamMessage(streamId)),
        content: kind === 'thinking'
          ? (message?.content ?? '')
          : `${message?.content ?? ''}${delta}`,
        thinkingContent: kind === 'thinking'
          ? `${message?.thinkingContent ?? ''}${delta}`
          : (message?.thinkingContent ?? ''),
        isStreaming: true,
      })),
      activeStreamId: streamId,
    }));
  },

  finishStream: (streamId, _messageId) => {
    set((state) => ({
      messages: updateOrInsertStreamMessage(state.messages, streamId, (message) => ({
        ...(message ?? buildAssistantStreamMessage(streamId)),
        isStreaming: false,
      })),
      activeStreamId: state.activeStreamId === streamId ? null : state.activeStreamId,
    }));
  },

  failStream: (streamId, errorMessage) => {
    set((state) => ({
      messages: updateOrInsertStreamMessage(state.messages, streamId, (message) => ({
        ...(message ?? buildAssistantStreamMessage(streamId)),
        content: message?.content || `⚠️ ${errorMessage}`,
        isStreaming: false,
      })),
      activeStreamId: state.activeStreamId === streamId ? null : state.activeStreamId,
    }));
  },

  cancelStream: () => {
    const { activeStreamId } = get();
    if (activeStreamId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === `stream-${activeStreamId}`
            ? { ...msg, isStreaming: false }
            : msg
        ),
        activeStreamId: null,
      }));
    }
  },

  setLoadingHistory: (loading) => set({ isLoadingHistory: loading }),
  clearChat: () => set({
    messages: [],
    activeSessionId: null,
    contextQuote: null,
    activeStreamId: null,
  }),
}));

// ---------------------------------------------------------------------------
// 模块级事件监听：替代 AiStreamBridge 组件
// 应用启动时执行一次，无需清理（与应用同生命周期）
// ---------------------------------------------------------------------------

// RAF 批处理缓冲：将同一帧内收到的所有 token 合并为单次 set()，
// 避免 50 tokens/s 时每帧触发 50 次重渲染
let _rafStreamId: string | null = null;
let _rafContent = '';
let _rafThinking = '';
let _rafHandle: number | null = null;

const _flushStreamBuffer = () => {
  _rafHandle = null;
  if (!_rafStreamId) return;
  const streamId = _rafStreamId;
  const contentDelta = _rafContent;
  const thinkingDelta = _rafThinking;
  _rafStreamId = null;
  _rafContent = '';
  _rafThinking = '';

  const state = useChatStore.getState();
  if (state.activeStreamId !== streamId) return;

  // 单次 set()：将本帧所有 content + thinking 合并更新
  useChatStore.setState((prev) => ({
    messages: updateOrInsertStreamMessage(prev.messages, streamId, (msg) => {
      const base = msg ?? buildAssistantStreamMessage(streamId);
      return {
        ...base,
        content: contentDelta ? `${base.content}${contentDelta}` : base.content,
        thinkingContent: thinkingDelta
          ? `${base.thinkingContent ?? ''}${thinkingDelta}`
          : base.thinkingContent,
        isStreaming: true,
      };
    }),
    activeStreamId: streamId,
  }));
};

void ipcEvents.onAiStreamChunk((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId !== payload.streamId) return;

  // streamId 变了则立即 flush 上一个流的缓冲
  if (_rafStreamId && _rafStreamId !== payload.streamId) {
    if (_rafHandle !== null) {
      cancelAnimationFrame(_rafHandle);
      _rafHandle = null;
    }
    _flushStreamBuffer();
  }

  _rafStreamId = payload.streamId;
  if (payload.kind === 'thinking') {
    _rafThinking += payload.delta;
  } else {
    _rafContent += payload.delta;
  }

  if (_rafHandle === null) {
    _rafHandle = requestAnimationFrame(_flushStreamBuffer);
  }
});

void ipcEvents.onAiStreamFinished((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.finishStream(payload.streamId, payload.messageId);
  }
});

void ipcEvents.onAiStreamFailed((payload) => {
  const state = useChatStore.getState();
  if (state.activeStreamId === payload.streamId) {
    state.failStream(payload.streamId, payload.error.message);
  }
});
