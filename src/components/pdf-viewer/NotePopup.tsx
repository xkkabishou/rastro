import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnnotationStore } from '../../stores/useAnnotationStore';

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const NotePopup: React.FC = () => {
  const editingAnnotationId = useAnnotationStore((s) => s.editingAnnotationId);
  const notePopupAnchor = useAnnotationStore((s) => s.notePopupAnchor);
  const annotations = useAnnotationStore((s) => s.annotations);
  const updateAnnotation = useAnnotationStore((s) => s.updateAnnotation);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const stopEditingNote = useAnnotationStore((s) => s.stopEditingNote);

  const annotation = annotations.find((a) => a.annotationId === editingAnnotationId);
  const [noteText, setNoteText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (annotation) {
      setNoteText(annotation.noteContent || '');
      // 延迟聚焦，等动画完成
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [annotation?.annotationId]);

  const handleSave = useCallback(() => {
    if (!editingAnnotationId) return;
    updateAnnotation({
      annotationId: editingAnnotationId,
      noteContent: noteText,
    });
    stopEditingNote();
  }, [editingAnnotationId, noteText, updateAnnotation, stopEditingNote]);

  const handleDelete = useCallback(() => {
    if (!editingAnnotationId) return;
    deleteAnnotation(editingAnnotationId);
    stopEditingNote();
  }, [editingAnnotationId, deleteAnnotation, stopEditingNote]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        stopEditingNote();
      }
    },
    [handleSave, stopEditingNote],
  );

  // 点击外部关闭
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editingAnnotationId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        handleSave();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingAnnotationId, handleSave]);

  return (
    <AnimatePresence>
      {annotation && editingAnnotationId && (
        <motion.div
          ref={popupRef}
          initial={{ opacity: 0, scale: 0.9, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -4 }}
          transition={{ duration: 0.15 }}
          className="fixed z-[200] w-72 rounded-xl backdrop-blur-xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl"
          style={{
            backgroundColor: 'rgba(255, 240, 200, 0.35)',
            ...(notePopupAnchor
              ? (() => {
                  const popupH = 220;
                  const spaceBelow = window.innerHeight - notePopupAnchor.endY;
                  const below = spaceBelow >= popupH;
                  return below
                    ? {
                        // 下方：笔记框左上角 = 末尾矩形右下角
                        left: Math.min(notePopupAnchor.endX, window.innerWidth - 300),
                        top: notePopupAnchor.endY,
                      }
                    : {
                        // 上方：笔记框左下角 = 首处矩形右上角
                        left: Math.min(notePopupAnchor.startX, window.innerWidth - 300),
                        top: notePopupAnchor.startY,
                        transform: 'translateY(-100%)',
                      };
                })()
              : { top: '30%', right: '20%' }),
          }}
        >
          {/* 标题行 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-secondary)]">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: `var(--annotation-${annotation.color}-dot)` }}
              />
              <span className="text-xs text-[var(--color-text-secondary)] truncate">
                {annotation.text.slice(0, 50)}
                {annotation.text.length > 50 ? '...' : ''}
              </span>
            </div>
            <button
              onClick={stopEditingNote}
              className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)]"
            >
              <X size={14} />
            </button>
          </div>

          {/* 文本输入 */}
          <div className="p-3">
            <textarea
              ref={textareaRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入笔记内容..."
              className="w-full min-h-[80px] p-2 text-sm rounded-md bg-white/30 dark:bg-white/10 border border-white/40 dark:border-white/15 text-[var(--color-text)] placeholder:text-[var(--color-text-quaternary)] resize-none focus:outline-none focus:border-[var(--color-border-focus)]"
            />
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border-secondary)]">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 transition-colors"
            >
              <Trash2 size={12} />
              删除
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-colors"
            >
              保存 <span className="text-[10px] opacity-70">⌘↵</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
