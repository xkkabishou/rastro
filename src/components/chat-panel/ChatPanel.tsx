import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ipcClient } from '../../lib/ipc-client';
import { extractPdfText } from '../../lib/pdf-text-extractor';
import { Sparkles, MessageSquare, Trash2, BookOpen, Loader2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import shibaChatUrl from '../../assets/shiba/shiba-chat.png';

const CHAT_MESSAGE_ESTIMATED_HEIGHT = 132;
const CHAT_MESSAGE_OVERSCAN = 6;

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

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [deepReadEnabled, setDeepReadEnabled] = useState(false);
  const [deepReadLoading, setDeepReadLoading] = useState(false);

  const messageVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => CHAT_MESSAGE_ESTIMATED_HEIGHT,
    overscan: CHAT_MESSAGE_OVERSCAN,
  });

  // 自动滚动到底部
  useEffect(() => {
    if (messages.length === 0) return;
    messageVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages, messageVirtualizer]);

  // 组件卸载时清理拖拽 leave 计时器，避免在已卸载组件上触发 setIsDragOver
  useEffect(() => () => {
    if (dragLeaveTimer.current) {
      clearTimeout(dragLeaveTimer.current);
      dragLeaveTimer.current = undefined;
    }
  }, []);

  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const currentDocumentId = currentDocument?.documentId;

  // 切换文档时测试精读状态
  useEffect(() => {
    if (!currentDocumentId) {
      setDeepReadEnabled(false);
      return;
    }
    ipcClient.getDeepReadStatus(currentDocumentId).then((status) => {
      setDeepReadEnabled(status.enabled);
    }).catch(() => setDeepReadEnabled(false));
  }, [currentDocumentId]);

  // 精读开关
  const toggleDeepRead = useCallback(async () => {
    if (!currentDocument) return;
    if (deepReadLoading) return;

    if (deepReadEnabled) {
      // 关闭精读
      try {
        await ipcClient.clearDeepReadText(currentDocument.documentId);
        setDeepReadEnabled(false);
      } catch (err) {
        console.error('关闭精读失败:', err);
      }
      return;
    }

    // 开启精读：提取全文并存入后端
    setDeepReadLoading(true);
    try {
      const result = await extractPdfText(currentDocument.filePath, {
        maxPages: 9999,
        maxChars: 500_000,
      });
      if (!result.text.trim()) {
        console.warn('精读模式：PDF 可能是扫描件，无法提取文本');
        return;
      }
      await ipcClient.saveDeepReadText(currentDocument.documentId, result.text);
      setDeepReadEnabled(true);
    } catch (err) {
      console.error('开启精读失败:', err);
    } finally {
      setDeepReadLoading(false);
    }
  }, [currentDocument, deepReadEnabled, deepReadLoading]);

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
        <div className="flex items-center gap-1">
          {/* 精读模式开关 */}
          <button
            onClick={toggleDeepRead}
            disabled={!currentDocument || deepReadLoading}
            className={`p-1.5 rounded-md transition-colors ${
              deepReadEnabled
                ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/25'
                : 'hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)]'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={deepReadEnabled ? '关闭精读模式' : '开启精读模式（提取全文作为 AI 上下文）'}
          >
            {deepReadLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BookOpen size={14} />
            )}
          </button>
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
      </div>

      {/* 消息列表 */}
      <div ref={scrollParentRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              height: `${messageVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {messageVirtualizer.getVirtualItems().map((virtualRow) => {
              const message = messages[virtualRow.index];
              if (!message) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={messageVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ChatMessage message={message} />
                </div>
              );
            })}
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
    <img src={shibaChatUrl} alt="" className="w-40 h-auto mb-3 opacity-80" />
    <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
      AI 问答助手
    </h3>
    <p className="text-xs text-[var(--color-text-tertiary)] max-w-[200px] leading-relaxed">
      选中 PDF 段落拖拽到此处，基于上下文向 AI 提问
    </p>
  </div>
);
