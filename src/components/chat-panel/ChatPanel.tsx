import React, { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ipcClient, ipcEvents } from '../../lib/ipc-client';
import { Sparkles, MessageSquare, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/** 聊天面板主组件 */
export const ChatPanel: React.FC = () => {
  const {
    messages,
    isStreaming,
    activeStreamId,
    isLoadingHistory,
    addUserMessage,
    startAssistantStream,
    appendStreamChunk,
    finishStream,
    failStream,
    cancelStream,
    clearChat,
    setLoadingHistory,
    setMessages,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unlistenRefs = useRef<Array<() => void>>([]);

  // 注册事件监听
  useEffect(() => {
    const setupListeners = async () => {
      const unlisten1 = await ipcEvents.onAiStreamChunk((payload) => {
        appendStreamChunk(payload.streamId, payload.delta);
      });
      const unlisten2 = await ipcEvents.onAiStreamFinished((payload) => {
        finishStream(payload.streamId, payload.messageId);
      });
      const unlisten3 = await ipcEvents.onAiStreamFailed((payload) => {
        failStream(payload.streamId, payload.error.message);
      });
      unlistenRefs.current = [unlisten1, unlisten2, unlisten3];
    };

    setupListeners().catch(console.error);

    return () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];
    };
  }, [appendStreamChunk, finishStream, failStream]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const handleSend = useCallback(async (content: string, contextQuote?: string) => {
    // 先添加用户消息到 UI
    addUserMessage(content, contextQuote);

    try {
      // 调用后端 ask_ai
      const handle = await ipcClient.askAi({
        documentId: 'current', // 由后续集成时动态替换
        userMessage: content,
        contextQuote,
      });
      // 开始流式消息
      startAssistantStream(handle.streamId);
    } catch (err) {
      console.error('AI 问答失败:', err);
      // 添加错误消息
      startAssistantStream('error');
      failStream('error', '发送失败，请检查网络或 API 配置');
    }
  }, [addUserMessage, startAssistantStream, failStream]);

  // 取消流
  const handleCancel = useCallback(async () => {
    if (activeStreamId) {
      try {
        await ipcClient.cancelAiStream(activeStreamId);
      } catch {
        // 即使取消命令失败，也更新 UI 状态
      }
      cancelStream();
    }
  }, [activeStreamId, cancelStream]);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--color-primary)]" />
          <span className="font-semibold text-sm text-[var(--color-text)]">AI 助手</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            title="清空对话"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div>
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChatMessage message={msg} />
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
      />
    </div>
  );
};

/** 空状态组件 */
const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full">
    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center mb-3">
      <MessageSquare size={24} className="text-[var(--color-primary)] opacity-60" />
    </div>
    <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
      AI 问答助手
    </h3>
    <p className="text-xs text-[var(--color-text-tertiary)] max-w-[200px] leading-relaxed">
      选中 PDF 段落拖拽到此处，基于上下文向 AI 提问
    </p>
  </div>
);
