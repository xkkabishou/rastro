import React from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Languages, Loader2 } from 'lucide-react';

interface PdfToolbarProps {
  currentPage: number;
  totalPages: number;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** 翻译全文回调 */
  onTranslate?: () => void;
  /** 是否正在翻译 */
  isTranslating?: boolean;
  /** 翻译进度 (0-100) */
  translationProgress?: number;
  /** 是否已有翻译缓存 */
  hasTranslation?: boolean;
}

export const PdfToolbar: React.FC<PdfToolbarProps> = ({
  currentPage,
  totalPages,
  scale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onTranslate,
  isTranslating = false,
  translationProgress = 0,
  hasTranslation = false,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-overlay)] backdrop-blur-xl shrink-0">
      {/* 页码信息 */}
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text)]">{currentPage}</span>
        <span>/</span>
        <span>{totalPages} 页</span>
      </div>

      {/* 缩放控制 */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          disabled={scale <= 0.25}
          className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="缩小"
        >
          <ZoomOut size={16} />
        </button>

        <button
          onClick={onZoomReset}
          className="px-2 py-1 rounded-md hover:bg-[var(--color-hover)] text-xs font-medium text-[var(--color-text-secondary)] min-w-[48px] text-center transition-colors"
          title="重置缩放"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          onClick={onZoomIn}
          disabled={scale >= 4.0}
          className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="放大"
        >
          <ZoomIn size={16} />
        </button>

        <div className="w-px h-4 bg-[var(--color-separator)] mx-1" />

        <button
          onClick={onZoomReset}
          className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-secondary)] transition-colors"
          title="重置"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* 右侧：翻译全文按钮 */}
      <div className="w-auto flex items-center gap-2">
        {onTranslate && (
          <button
            onClick={onTranslate}
            disabled={isTranslating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              isTranslating
                ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] cursor-wait'
                : hasTranslation
                  ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] hover:bg-[var(--color-success)]/20'
                  : 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20'
            }`}
            title={isTranslating ? `翻译中 ${translationProgress}%` : hasTranslation ? '查看译文' : '翻译全文'}
          >
            {isTranslating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {translationProgress > 0 ? `${translationProgress}%` : '翻译中...'}
              </>
            ) : (
              <>
                <Languages size={14} />
                {hasTranslation ? '已翻译' : '翻译全文'}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
