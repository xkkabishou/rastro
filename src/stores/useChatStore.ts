import { create } from 'zustand';
import type { ChatSessionDto, ChatMessageDto, ProviderId } from '../shared/types';

/** 前端聊天消息（包含流式状态） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contextQuote?: string;
  timestamp: string;
  isStreaming?: boolean;
}

interface ChatState {
  /** 当前活跃的会话 ID */
  activeSessionId: string | null;
  /** 当前文档的会话列表 */
  sessions: ChatSessionDto[];
  /** 当前会话的消息 */
  messages: ChatMessage[];
  /** 输入框内容 */
  inputText: string;
  /** 当前拖拽的引用文本 */
  contextQuote: string | null;
  /** 是否正在发送中（流式响应未结束） */
  isStreaming: boolean;
  /** 当前流式 stream ID */
  activeStreamId: string | null;
  /** 是否正在加载历史 */
  isLoadingHistory: boolean;

  // Actions
  setActiveSession: (sessionId: string | null) => void;
  setSessions: (sessions: ChatSessionDto[]) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setInputText: (text: string) => void;
  setContextQuote: (quote: string | null) => void;

  /** 添加用户消息 */
  addUserMessage: (content: string, contextQuote?: string) => void;
  /** 开始流式助手消息 */
  startAssistantStream: (streamId: string) => void;
  /** 追加流式 chunk */
  appendStreamChunk: (streamId: string, delta: string) => void;
  /** 结束流式助手消息 */
  finishStream: (streamId: string, messageId: string) => void;
  /** 流式失败 */
  failStream: (streamId: string, errorMessage: string) => void;
  /** 取消流 */
  cancelStream: () => void;
  /** 设置加载状态 */
  setLoadingHistory: (loading: boolean) => void;
  /** 清空当前会话 */
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  sessions: [],
  messages: [],
  inputText: '',
  contextQuote: null,
  isStreaming: false,
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
    const msg: ChatMessage = {
      id: `stream-${streamId}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    set((state) => ({
      messages: [...state.messages, msg],
      isStreaming: true,
      activeStreamId: streamId,
    }));
  },

  appendStreamChunk: (streamId, delta) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === `stream-${streamId}`
          ? { ...msg, content: msg.content + delta }
          : msg
      ),
    }));
  },

  finishStream: (streamId, messageId) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === `stream-${streamId}`
          ? { ...msg, id: messageId, isStreaming: false }
          : msg
      ),
      isStreaming: false,
      activeStreamId: null,
    }));
  },

  failStream: (streamId, errorMessage) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === `stream-${streamId}`
          ? { ...msg, content: msg.content || `⚠️ ${errorMessage}`, isStreaming: false }
          : msg
      ),
      isStreaming: false,
      activeStreamId: null,
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
        isStreaming: false,
        activeStreamId: null,
      }));
    }
  },

  setLoadingHistory: (loading) => set({ isLoadingHistory: loading }),
  clearChat: () => set({ messages: [], activeSessionId: null, contextQuote: null }),
}));
