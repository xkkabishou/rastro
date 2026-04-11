import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage as ChatMessageType } from '../../stores/useChatStore';
import { Quote, Brain } from 'lucide-react';
import shibaUserUrl from '../../assets/shiba/shiba-user.png';
import shibaAiUrl from '../../assets/shiba/shiba-ai.png';
import { CalloutBlockquote } from '../ui/Callout';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** 单条聊天消息组件（memo 避免流式输出时兄弟消息无关重渲染） */
export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === 'user';
  const thinkingContent = message.thinkingContent?.trim();

  return (
    <div className={`flex gap-3 py-3 px-4 ${isUser ? '' : 'bg-[var(--color-bg-secondary)]/50'}`}>
      {/* 角色头像 */}
      <img
        src={isUser ? shibaUserUrl : shibaAiUrl}
        alt={isUser ? '用户' : 'AI'}
        className="shrink-0 w-7 h-7 rounded-full object-cover"
      />

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
          <>
            {thinkingContent && (
              <details
                className="mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/60"
                open={Boolean(message.isStreaming)}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]">
                  <Brain size={14} />
                  思考内容
                </summary>
                <div className="border-t border-[var(--color-border)] px-3 py-2">
                  <div className="markdown-body text-xs text-[var(--color-text-secondary)]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{ blockquote: CalloutBlockquote }}
                    >
                      {thinkingContent}
                    </ReactMarkdown>
                  </div>
                </div>
              </details>
            )}

            <div className={`markdown-body text-sm ${message.isStreaming ? 'streaming-cursor' : ''}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{ blockquote: CalloutBlockquote }}
              >
                {message.content || ' '}
              </ReactMarkdown>
            </div>
          </>
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
});

ChatMessage.displayName = 'ChatMessage';
