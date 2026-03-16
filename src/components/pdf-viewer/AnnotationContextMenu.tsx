import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StickyNote, Copy, MessageSquare, Trash2 } from 'lucide-react';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import type { AnnotationColor, AnnotationDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const COLORS: AnnotationColor[] = [
  'yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray',
];

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface ContextMenuState {
  annotation: AnnotationDto;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Hook: 标注右键菜单状态管理
// ---------------------------------------------------------------------------

export function useAnnotationContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openMenu = useCallback((annotation: AnnotationDto, x: number, y: number) => {
    setMenu({ annotation, x, y });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  return { menu, openMenu, closeMenu };
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface AnnotationContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onQuoteToChat?: (text: string) => void;
}

export const AnnotationContextMenu: React.FC<AnnotationContextMenuProps> = ({
  menu,
  onClose,
  onQuoteToChat,
}) => {
  const updateAnnotation = useAnnotationStore((s) => s.updateAnnotation);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const startEditingNote = useAnnotationStore((s) => s.startEditingNote);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu, onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!menu) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [menu, onClose]);

  if (!menu) return null;

  const { annotation, x, y } = menu;
  const hasNote = !!annotation.noteContent;

  const handleColorChange = (color: AnnotationColor) => {
    updateAnnotation({ annotationId: annotation.annotationId, color });
    onClose();
  };

  const handleEditNote = () => {
    startEditingNote(annotation.annotationId);
    onClose();
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(annotation.text).catch(console.error);
    onClose();
  };

  const handleQuote = () => {
    onQuoteToChat?.(annotation.text);
    onClose();
  };

  const handleDelete = () => {
    deleteAnnotation(annotation.annotationId);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[300] min-w-[180px] rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] shadow-xl py-1.5"
      style={{
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - 280),
      }}
    >
      {/* 颜色选择 */}
      <div className="px-3 py-2 flex items-center gap-1">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => handleColorChange(color)}
            className={`w-5 h-5 rounded-full transition-all hover:scale-110 ${
              annotation.color === color ? 'ring-2 ring-offset-1 ring-[var(--color-border-focus)]' : ''
            }`}
            style={{ backgroundColor: `var(--annotation-${color}-dot)` }}
          />
        ))}
      </div>

      <div className="mx-2 h-px bg-[var(--color-separator)]" />

      {/* 操作项 */}
      <button
        onClick={handleEditNote}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <StickyNote size={14} />
        {hasNote ? '编辑笔记' : '添加笔记'}
      </button>

      <button
        onClick={handleCopyText}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <Copy size={14} />
        复制标注文本
      </button>

      {onQuoteToChat && (
        <button
          onClick={handleQuote}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors"
        >
          <MessageSquare size={14} />
          引用到对话
        </button>
      )}

      <div className="mx-2 h-px bg-[var(--color-separator)]" />

      <button
        onClick={handleDelete}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 transition-colors"
      >
        <Trash2 size={14} />
        删除标注
      </button>
    </div>
  );
};
