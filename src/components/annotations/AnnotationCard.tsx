import React, { useCallback } from 'react';
import { Highlighter, Underline, StickyNote, Pencil, Palette, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import type { AnnotationDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  highlight: Highlighter,
  underline: Underline,
  note: StickyNote,
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface AnnotationCardProps {
  annotation: AnnotationDto;
  isSelected: boolean;
  onScrollToPage: (pageNumber: number) => void;
}

export const AnnotationCard: React.FC<AnnotationCardProps> = React.memo(
  ({ annotation, isSelected, onScrollToPage }) => {
    const selectAnnotation = useAnnotationStore((s) => s.selectAnnotation);
    const startEditingNote = useAnnotationStore((s) => s.startEditingNote);
    const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);

    const Icon = TYPE_ICONS[annotation.type] || Highlighter;

    const handleClick = useCallback(() => {
      selectAnnotation(annotation.annotationId);
      onScrollToPage(annotation.pageNumber);
    }, [annotation.annotationId, annotation.pageNumber, selectAnnotation, onScrollToPage]);

    const handleEditNote = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        startEditingNote(annotation.annotationId);
      },
      [annotation.annotationId, startEditingNote],
    );

    const handleDelete = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteAnnotation(annotation.annotationId);
      },
      [annotation.annotationId, deleteAnnotation],
    );

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.15 }}
        onClick={handleClick}
        className={`group relative flex gap-2 p-2.5 mx-2 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-[var(--color-selected)] ring-1 ring-[var(--color-border-focus)]'
            : 'hover:bg-[var(--color-hover)]'
        }`}
      >
        {/* 左侧颜色条 */}
        <div
          className="w-1 shrink-0 rounded-full"
          style={{ backgroundColor: `var(--annotation-${annotation.color}-dot)` }}
        />

        {/* 内容 */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* 类型图标 + 页码 */}
          <div className="flex items-center gap-1.5">
            <Icon
              size={12}
              style={{ color: `var(--annotation-${annotation.color}-dot)` }}
            />
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              第 {annotation.pageNumber} 页
            </span>
            <span className="text-[10px] text-[var(--color-text-quaternary)] ml-auto">
              {relativeTime(annotation.createdAt)}
            </span>
          </div>

          {/* 标注文本 */}
          <p className="text-xs text-[var(--color-text)] line-clamp-3 leading-relaxed">
            {annotation.text}
          </p>

          {/* 笔记内容 */}
          {annotation.noteContent && (
            <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-2 leading-relaxed italic">
              {annotation.noteContent}
            </p>
          )}
        </div>

        {/* 悬浮操作按钮 */}
        <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleEditNote}
            className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)]"
            title="编辑笔记"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-[var(--color-destructive)]/10 text-[var(--color-text-tertiary)] hover:text-[var(--color-destructive)]"
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </motion.div>
    );
  },
);

AnnotationCard.displayName = 'AnnotationCard';
