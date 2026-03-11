import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ipcClient, ipcEvents } from '../../lib/ipc-client';
import { BookOpen, Loader2, RefreshCw, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AiStreamChunkPayload } from '../../shared/types';

/** AI 文献总结面板 */
export const SummaryPanel: React.FC<{ documentId?: string; filePath?: string }> = ({
  documentId,
  filePath,
}) => {
  const [summaryContent, setSummaryContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 生成总结
  const handleGenerate = useCallback(async () => {
    if (!documentId || !filePath || isGenerating) return;

    setSummaryContent('');
    setIsGenerating(true);
    setHasGenerated(true);

    try {
      const handle = await ipcClient.generateSummary({
        documentId,
        filePath,
        promptProfile: 'default',
      });
      setActiveStreamId(handle.streamId);
    } catch (err) {
      console.error('生成总结失败:', err);
      setSummaryContent('⚠️ 生成总结失败，请检查 API 配置后重试。');
      setIsGenerating(false);
    }
  }, [documentId, filePath, isGenerating]);

  // 监听流式事件
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      const u1 = await ipcEvents.onAiStreamChunk((payload: AiStreamChunkPayload) => {
        if (payload.streamId === activeStreamId) {
          setSummaryContent((prev) => prev + payload.delta);
        }
      });
      const u2 = await ipcEvents.onAiStreamFinished((payload) => {
        if (payload.streamId === activeStreamId) {
          setIsGenerating(false);
          setActiveStreamId(null);
        }
      });
      const u3 = await ipcEvents.onAiStreamFailed((payload) => {
        if (payload.streamId === activeStreamId) {
          setSummaryContent((prev) => prev + `\n\n⚠️ ${payload.error.message}`);
          setIsGenerating(false);
          setActiveStreamId(null);
        }
      });
      unlisteners.push(u1, u2, u3);
    };

    if (activeStreamId) {
      setup().catch(console.error);
    }

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [activeStreamId]);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [summaryContent]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[var(--color-accent)]" />
          <span className="font-semibold text-sm text-[var(--color-text)]">文献总结</span>
        </div>
        {hasGenerated && (
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] disabled:opacity-50 transition-colors"
            title="重新生成"
          >
            <RefreshCw size={14} className={isGenerating ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* 内容区域 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {!hasGenerated ? (
          // 未生成 — 引导状态
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500/10 to-amber-500/10 flex items-center justify-center mb-3">
              <FileText size={24} className="text-[var(--color-accent)] opacity-60" />
            </div>
            <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
              一键生成文献总结
            </h3>
            <p className="text-xs text-[var(--color-text-tertiary)] max-w-[200px] leading-relaxed mb-4">
              AI 将分析论文结构，生成包含研究背景、方法、结论和创新点的结构化总结
            </p>
            <button
              onClick={handleGenerate}
              disabled={!documentId || isGenerating}
              className="px-4 py-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2"
            >
              {isGenerating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <BookOpen size={14} />
              )}
              生成总结
            </button>
          </div>
        ) : (
          // 已生成/生成中 — Markdown 渲染
          <div className="p-4">
            <div className={`markdown-body text-sm ${isGenerating ? 'streaming-cursor' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {summaryContent || ' '}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
