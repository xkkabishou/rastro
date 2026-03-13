import React, { useCallback } from 'react';
import { AlertTriangle, ExternalLink, FileText, Globe } from 'lucide-react';
import {
  NOTEBOOKLM_UNAVAILABLE_MESSAGE,
  NOTEBOOKLM_URL,
} from '../../lib/notebooklm-automation';
import { useDocumentStore } from '../../stores/useDocumentStore';

/** NotebookLM 面板当前仅提供诚实可解释的外链入口。 */
export const NotebookLMView: React.FC = () => {
  const currentPdf = useDocumentStore((state) => state.currentDocument);

  const handleOpenExternal = useCallback(() => {
    window.open(NOTEBOOKLM_URL, '_blank');
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--color-text-secondary)]" />
          <span className="font-semibold text-sm text-[var(--color-text)]">NotebookLM</span>
        </div>
        <button
          onClick={handleOpenExternal}
          className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
          title="在浏览器中打开"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="apple-card p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--color-warning)]/12 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-[var(--color-warning)]" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                内嵌自动化暂未实现
              </h3>
              <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {NOTEBOOKLM_UNAVAILABLE_MESSAGE}
              </p>
            </div>
          </div>
          <button
            onClick={handleOpenExternal}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-sm font-medium hover:opacity-90 transition-opacity shadow-[var(--shadow-button)]"
          >
            <ExternalLink size={14} />
            在外部浏览器打开 NotebookLM
          </button>
        </div>

        <div className="apple-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--color-primary)]" />
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              当前文档
            </span>
          </div>

          {currentPdf ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5">
              <p className="text-sm font-medium text-[var(--color-text)] truncate">
                {currentPdf.title}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)] break-all">
                {currentPdf.filePath}
              </p>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              当前还没有打开 PDF。打开外部 NotebookLM 后，可以手动上传你正在阅读的论文。
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
