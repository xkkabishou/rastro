import React from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface PdfToolbarProps {
  currentPage: number;
  totalPages: number;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export const PdfToolbar: React.FC<PdfToolbarProps> = ({
  currentPage,
  totalPages,
  scale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
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

      {/* 右侧留空，后续放总结按钮等 */}
      <div className="w-20" />
    </div>
  );
};
