import React, { useRef, useCallback, KeyboardEvent } from 'react';
import { Send, Square, Quote, X } from 'lucide-react';
import { useChatStore } from '../../stores/useChatStore';

interface ChatInputProps {
  onSend: (message: string, contextQuote?: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** 聊天输入区域组件 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onCancel, disabled }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { inputText, setInputText, contextQuote, setContextQuote, isStreaming } = useChatStore();

  // 自动调整文本框高度
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  // 发送消息
  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed, contextQuote || undefined);
    setInputText('');
    setContextQuote(null);
    // 重置文本框高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputText, contextQuote, isStreaming, onSend, setInputText, setContextQuote]);

  // 键盘快捷键：Enter 发送，Shift+Enter 换行
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 拖拽接收（接收从 PDF 拖拽来的文本）
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      setContextQuote(text);
    }
  }, [setContextQuote]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div
      className="border-t border-[var(--color-border)] p-3 bg-[var(--color-bg)]"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* 引用上下文预览 */}
      {contextQuote && (
        <div className="flex items-start gap-2 mb-2 p-2 rounded-lg bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10">
          <Quote size={12} className="shrink-0 mt-0.5 text-[var(--color-primary)]" />
          <p className="flex-1 text-xs text-[var(--color-text-secondary)] line-clamp-2 italic">
            {contextQuote}
          </p>
          <button
            onClick={() => setContextQuote(null)}
            className="shrink-0 p-0.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 输入区域 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={contextQuote ? "基于引用内容提问..." : "输入您的问题..."}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-[var(--color-bg-secondary)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-quaternary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 border border-[var(--color-border)] transition-all disabled:opacity-50"
        />

        {/* 发送/停止按钮 */}
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="shrink-0 w-9 h-9 rounded-xl bg-[var(--color-destructive)] text-white flex items-center justify-center hover:opacity-90 transition-opacity"
            title="停止生成"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || disabled}
            className="shrink-0 w-9 h-9 rounded-xl bg-[var(--color-primary)] text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            title="发送"
          >
            <Send size={14} />
          </button>
        )}
      </div>

      <p className="text-[10px] text-[var(--color-text-quaternary)] mt-1.5 text-center">
        拖拽 PDF 段落到此处引用 · Enter 发送 · Shift+Enter 换行
      </p>
    </div>
  );
};
