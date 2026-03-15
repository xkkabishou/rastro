import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ipcClient } from '../../lib/ipc-client';
import { Sparkles, MessageSquare, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import shibaChatUrl from '../../assets/shiba/shiba-chat.png';

/** 聊天面板主组件 */
export const ChatPanel: React.FC = () => {
  const {
    activeSessionId,
    messages,
    activeStreamId,
    setActiveSession,
    addUserMessage,
    startAssistantStream,
    failStream,
    cancelStream,
    clearChat,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const currentDocument = useDocumentStore((s) => s.currentDocument);

  // 发送消息
  const handleSend = useCallback(async (content: string, contextQuote?: string) => {
    if (!currentDocument) {
      const syntheticStreamId = `error-${Date.now()}`;
      startAssistantStream(syntheticStreamId);
      failStream(syntheticStreamId, '请先打开一篇文档后再提问');
      return;
    }

    // 先添加用户消息到 UI
    addUserMessage(content, contextQuote);

    try {
      // 调用后端 ask_ai
      const handle = await ipcClient.askAi({
        documentId: currentDocument.documentId,
        sessionId: activeSessionId ?? undefined,
        userMessage: content,
        contextQuote,
      });
      setActiveSession(handle.sessionId);
      // 开始流式消息
      startAssistantStream(handle.streamId);
    } catch (err: unknown) {
      console.error('AI 问答失败:', err);
      // 从后端 AppError 中提取具体错误信息
      const errorMsg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '发送失败，请检查网络或 API 配置';
      const syntheticStreamId = `error-${Date.now()}`;
      startAssistantStream(syntheticStreamId);
      failStream(syntheticStreamId, errorMsg);
    }
  }, [currentDocument, activeSessionId, addUserMessage, setActiveSession, startAssistantStream, failStream]);

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

  // 整个面板的 drop 处理
  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const text = e.dataTransfer.getData('text/plain');
    if (text?.trim()) {
      useChatStore.getState().setContextQuote(text.trim());
    }
  }, []);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    // 清除之前的 leave 计时器
    if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
    setIsDragOver(true);
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 延迟隐藏以避免子元素切换时闪烁
    dragLeaveTimer.current = setTimeout(() => setIsDragOver(false), 100);
  }, []);

  return (
    <div
      className="flex flex-col h-full relative"
      onDrop={handlePanelDrop}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
    >
      {/* 拖拽悬停反馈覆盖层 */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-primary)]/5 border-2 border-dashed border-[var(--color-primary)]/40 rounded-lg backdrop-blur-sm pointer-events-none">
          <div className="text-center">
            <MessageSquare size={32} className="text-[var(--color-primary)] mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium text-[var(--color-primary)]">释放以引用 PDF 段落</p>
          </div>
        </div>
      )}

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
    <img src={shibaChatUrl} alt="" className="w-16 h-auto mb-3 opacity-80" />
    <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
      AI 问答助手
    </h3>
    <p className="text-xs text-[var(--color-text-tertiary)] max-w-[200px] leading-relaxed">
      选中 PDF 段落拖拽到此处，基于上下文向 AI 提问
    </p>
  </div>
);
