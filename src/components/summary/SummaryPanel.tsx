import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { ipcClient } from '../../lib/ipc-client';
import { BookOpen, Loader2, RefreshCw, FileText, Upload, Check } from 'lucide-react';
import { CalloutBlockquote } from '../ui/Callout';
import {
  DEFAULT_SUMMARY_SOURCE_CHARS,
  DEFAULT_SUMMARY_SOURCE_PAGES,
  extractPdfText,
} from '../../lib/pdf-text-extractor';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useSummaryStore } from '../../stores/useSummaryStore';
import { useObsidianStore } from '../../stores/useObsidianStore';

/** AI 文献总结面板 */
export const SummaryPanel: React.FC = () => {
  const currentDocument = useDocumentStore((state) => state.currentDocument);
  const {
    summaryContent,
    isGenerating,
    hasGenerated,
    isLoadingSaved,
    startGeneration,
    setActiveStreamId,
    failStream,
    loadSavedSummary,
    resetSummary,
  } = useSummaryStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const documentId = currentDocument?.documentId;

  // 统一"同步到笔记库"状态（同时覆盖 Obsidian + Zotero）
  const obsidianConfig = useObsidianStore((s) => s.config);
  const exportSummary = useObsidianStore((s) => s.exportSummary);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // T2.4.5: 文档切换时自动加载已保存的总结
  useEffect(() => {
    if (documentId) {
      loadSavedSummary(documentId);
    } else {
      resetSummary();
    }
  }, [documentId, loadSavedSummary, resetSummary]);

  // 生成总结
  const handleGenerate = useCallback(async () => {
    if (!currentDocument || isGenerating) return;

    // T2.4.5: 确保 currentDocumentId 已设置（用于 finishStream 自动保存）
    useSummaryStore.setState({ currentDocumentId: currentDocument.documentId });
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

  // 当前可用的同步目标（Obsidian / Zotero / 两者）
  const syncTargets = useMemo(() => {
    const targets: ('obsidian' | 'zotero')[] = [];
    if (obsidianConfig.vaultPath) targets.push('obsidian');
    if (currentDocument?.zoteroItemKey) targets.push('zotero');
    return targets;
  }, [obsidianConfig.vaultPath, currentDocument?.zoteroItemKey]);

  // 统一"同步到笔记库"按钮：并行写入所有已配置的目标
  const handleSyncToLibrary = useCallback(async () => {
    if (!currentDocument || !summaryContent || syncTargets.length === 0) return;
    setIsSyncing(true);
    setSyncError(null);

    const title = currentDocument.title || '未命名文献';
    const results = await Promise.allSettled(
      syncTargets.map((target) => {
        if (target === 'obsidian') {
          return exportSummary(currentDocument.documentId, title, summaryContent);
        }
        return ipcClient.exportMdToZotero(
          currentDocument.zoteroItemKey!,
          '总结.md',
          summaryContent,
        );
      }),
    );

    // 收集失败的目标名
    const failures: string[] = [];
    results.forEach((result, index) => {
      const targetLabel = syncTargets[index] === 'obsidian' ? 'Obsidian' : 'Zotero';
      if (result.status === 'rejected') {
        console.error(`[同步] ${targetLabel} 失败:`, result.reason);
        failures.push(targetLabel);
      } else if (result.status === 'fulfilled' && !result.value?.success) {
        console.error(`[同步] ${targetLabel} 返回失败:`, result.value);
        failures.push(targetLabel);
      }
    });

    setIsSyncing(false);

    if (failures.length === 0) {
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2000);
    } else if (failures.length < syncTargets.length) {
      // 部分成功：仍然短暂显示成功，但记录错误
      setSyncError(`${failures.join('、')} 同步失败，其他目标已成功`);
      setSyncSuccess(true);
      setTimeout(() => {
        setSyncSuccess(false);
        setSyncError(null);
      }, 3000);
    } else {
      setSyncError(`${failures.join('、')} 同步失败`);
      setTimeout(() => setSyncError(null), 3000);
    }
  }, [currentDocument, summaryContent, syncTargets, exportSummary]);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [summaryContent]);

  // 是否显示统一同步按钮：已生成总结 + 至少有一个可用目标
  const showSyncButton = hasGenerated && !isGenerating && summaryContent && syncTargets.length > 0;

  // 根据可用目标组合 tooltip 文案
  const syncTooltip = useMemo(() => {
    if (syncError) return syncError;
    if (syncTargets.length === 2) return '同步到笔记库（Obsidian + Zotero）';
    if (syncTargets[0] === 'obsidian') return '同步到 Obsidian';
    if (syncTargets[0] === 'zotero') return '同步到 Zotero 附件';
    return '同步';
  }, [syncTargets, syncError]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[var(--color-accent)]" />
          <span className="font-semibold text-sm text-[var(--color-text)]">文献总结</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 统一同步到笔记库按钮（Obsidian + Zotero 合并） */}
          {showSyncButton && (
            <button
              onClick={handleSyncToLibrary}
              disabled={isSyncing}
              className={`p-1.5 rounded-md hover:bg-[var(--color-hover)] disabled:opacity-50 transition-colors ${
                syncError && !syncSuccess
                  ? 'text-red-400'
                  : 'text-[var(--color-text-tertiary)]'
              }`}
              title={syncTooltip}
            >
              {syncSuccess ? (
                <Check size={14} className="text-emerald-500" />
              ) : isSyncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
            </button>
          )}
          {/* 重新生成按钮 */}
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
      </div>

      {/* 内容区域 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {isLoadingSaved ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
          </div>
        ) : !hasGenerated ? (
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
          <div className="p-4">
            <div className={`markdown-body text-sm ${isGenerating ? 'streaming-cursor' : ''}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{ blockquote: CalloutBlockquote }}
              >
                {summaryContent || ' '}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
