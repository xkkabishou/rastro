import React, { useCallback } from 'react';
import { Highlighter, Underline, StickyNote, MousePointer2 } from 'lucide-react';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import type { AnnotationType, AnnotationColor } from '../../shared/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ANNOTATION_COLORS: AnnotationColor[] = [
  'yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray',
];

const TOOL_CONFIG: { type: AnnotationType; icon: React.ElementType; label: string }[] = [
  { type: 'highlight', icon: Highlighter, label: '高亮' },
  { type: 'underline', icon: Underline, label: '下划线' },
  { type: 'note', icon: StickyNote, label: '笔记' },
];

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const AnnotationToolbar: React.FC = () => {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const activeColor = useAnnotationStore((s) => s.activeColor);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);

  const handleToolClick = useCallback(
    (type: AnnotationType) => {
      // 再次点击同一工具 → 取消选择
      setActiveTool(activeTool === type ? null : type);
    },
    [activeTool, setActiveTool],
  );

  return (
    <div className="flex items-center gap-1">
      {/* 选择模式按钮（取消工具） */}
      <button
        onClick={() => setActiveTool(null)}
        className={`p-1.5 rounded-md transition-colors ${
          activeTool === null
            ? 'bg-[var(--color-selected)] text-[var(--color-primary)]'
            : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover)]'
        }`}
        title="选择模式"
      >
        <MousePointer2 size={16} />
      </button>

      <div className="w-px h-4 bg-[var(--color-separator)] mx-0.5" />

      {/* 工具按钮 — 选中后持久激活，再次点击取消 */}
      {TOOL_CONFIG.map(({ type, icon: Icon, label }) => {
        const isActive = activeTool === type;
        return (
          <button
            key={type}
            onClick={() => handleToolClick(type)}
            className={`p-1.5 rounded-md transition-colors ${
              isActive
                ? `bg-[var(--annotation-${activeColor}-bg)] text-[var(--annotation-${activeColor}-dot)]`
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
            }`}
            title={label}
          >
            <Icon size={16} />
          </button>
        );
      })}

      {/* 颜色选择 — 工具激活时显示 */}
      {activeTool && (
        <>
          <div className="w-px h-4 bg-[var(--color-separator)] mx-0.5" />
          <div className="flex items-center gap-0.5">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setActiveColor(color)}
                className={`w-4 h-4 rounded-full transition-all ${
                  activeColor === color
                    ? 'ring-2 ring-offset-1 ring-[var(--color-border-focus)] scale-110'
                    : 'hover:scale-110'
                }`}
                style={{ backgroundColor: `var(--annotation-${color}-dot)` }}
                title={color}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
