import React, { useCallback, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ipcClient } from '../../lib/ipc-client';
import { BookOpen, Loader2, RefreshCw, FileText } from 'lucide-react';
import {
  DEFAULT_SUMMARY_SOURCE_CHARS,
  DEFAULT_SUMMARY_SOURCE_PAGES,
  extractPdfText,
} from '../../lib/pdf-text-extractor';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useSummaryStore } from '../../stores/useSummaryStore';

/** AI 文献总结面板 */
export const SummaryPanel: React.FC = () => {
  const currentDocument = useDocumentStore((state) => state.currentDocument);
  const {
    summaryContent,
    isGenerating,
    hasGenerated,
    startGeneration,
    setActiveStreamId,
    failStream,
  } = useSummaryStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const documentId = currentDocument?.documentId;

  // 生成总结
  const handleGenerate = useCallback(async () => {
    if (!currentDocument || isGenerating) return;

    startGeneration();

    try {
      const { text: sourceText } = await extractPdfText(currentDocument.filePath, {
        maxPages: DEFAULT_SUMMARY_SOURCE_PAGES,
        maxChars: DEFAULT_SUMMARY_SOURCE_CHARS,
      });

      if (!sourceText.trim()) {
        failStream(
          null,
          `未能从当前 PDF 前 ${DEFAULT_SUMMARY_SOURCE_PAGES} 页提取到可用于总结的正文，请确认文档是可复制文本后再试。`,
        );
        return;
      }

      if (useDocumentStore.getState().currentDocument?.documentId !== currentDocument.documentId) {
        failStream(null, '当前文档已切换，请在新文档上重新生成总结。');
        return;
      }

      const handle = await ipcClient.generateSummary({
        documentId: currentDocument.documentId,
        filePath: currentDocument.filePath,
        sourceText,
        promptProfile: 'default',
      });

      if (useDocumentStore.getState().currentDocument?.documentId !== currentDocument.documentId) {
        try {
          await ipcClient.cancelAiStream(handle.streamId);
        } catch (error) {
          console.error('切文档后取消总结流失败:', error);
        }
        failStream(null, '当前文档已切换，请在新文档上重新生成总结。');
        return;
      }

      setActiveStreamId(handle.streamId);
    } catch (err) {
      console.error('生成总结失败:', err);
      const errorMsg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '生成总结失败，请检查网络或 API 配置后重试。';
      failStream(null, errorMsg);
    }
  }, [currentDocument, failStream, isGenerating, setActiveStreamId, startGeneration]);

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
