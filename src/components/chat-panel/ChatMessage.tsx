import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '../../stores/useChatStore';
import { User, Sparkles, Quote } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** 单条聊天消息组件 */
export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 py-3 px-4 ${isUser ? '' : 'bg-[var(--color-bg-secondary)]/50'}`}>
      {/* 角色头像 */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
        isUser
          ? 'bg-[var(--color-primary)] text-white'
          : 'bg-gradient-to-br from-purple-500 to-blue-500 text-white'
      }`}>
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>

      {/* 消息内容 */}
      <div className="flex-1 min-w-0">
        {/* 引用上下文 */}
        {message.contextQuote && (
          <div className="flex items-start gap-2 mb-2 p-2.5 rounded-lg bg-[var(--color-primary)]/5 border-l-2 border-[var(--color-primary)]">
            <Quote size={14} className="shrink-0 mt-0.5 text-[var(--color-primary)]" />
            <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3 italic leading-relaxed">
              {message.contextQuote}
            </p>
          </div>
        )}

        {/* 消息文本 */}
        {isUser ? (
          <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        ) : (
          <div className={`markdown-body text-sm ${message.isStreaming ? 'streaming-cursor' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content || ' '}
            </ReactMarkdown>
          </div>
        )}

        {/* 时间戳 */}
        <p className="text-[10px] text-[var(--color-text-quaternary)] mt-1.5">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
};
