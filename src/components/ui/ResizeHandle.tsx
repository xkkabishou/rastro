import React, { useState, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface ResizeHandleProps {
  /** 分隔线位置标识 */
  side: 'left' | 'right';
  /** 对应面板是否展开（收起时不渲染） */
  isVisible: boolean;
  /** 拖拽中回调，delta 为鼠标水平位移（px） */
  onResize: (delta: number) => void;
  /** 拖拽开始回调 */
  onResizeStart?: () => void;
  /** 拖拽结束回调 */
  onResizeEnd?: () => void;
  /** 双击回调（重置宽度） */
  onDoubleClick?: () => void;
  /** 当前面板宽度（用于 aria-valuenow） */
  currentWidth?: number;
  /** 最小宽度（用于 aria-valuemin） */
  minWidth?: number;
  /** 最大宽度（用于 aria-valuemax） */
  maxWidth?: number;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const ResizeHandle = ({
  side,
  isVisible,
  onResize,
  onResizeStart,
  onResizeEnd,
  onDoubleClick,
  currentWidth,
  minWidth,
  maxWidth,
}: ResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startXRef = useRef(0);

  // 拖拽启动
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    setIsDragging(true);
    onResizeStart?.();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      startXRef.current = moveEvent.clientX;
      onResize(delta);
    };

    const cleanup = () => {
      setIsDragging(false);
      setIsHovered(false);
      onResizeEnd?.();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', cleanup);
      window.removeEventListener('blur', cleanup);
      document.body.classList.remove('is-resizing');
    };

    document.body.classList.add('is-resizing');
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
  }, [onResize, onResizeStart, onResizeEnd]);

  // 键盘交互（无障碍）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onResize(-step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onResize(step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onDoubleClick?.();
    }
  }, [onResize, onDoubleClick]);

  if (!isVisible) return null;

  // 颜色逻辑：拖拽 > hover > 透明
  const lineOpacity = isDragging ? 1 : isHovered ? 0.6 : 0;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧面板宽度'}
      aria-valuenow={currentWidth}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      className="relative shrink-0 cursor-col-resize select-none z-20 focus-visible:outline-none group"
      style={{ width: 6, marginLeft: -3, marginRight: -3 }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!isDragging) setIsHovered(false); }}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* 扩展点击区域（不可见） */}
      <div className="absolute inset-y-0 -left-[3px] -right-[3px]" />

      {/* 可见分隔线 */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full"
        style={{
          width: 2,
          backgroundColor: 'var(--color-primary)',
          opacity: lineOpacity,
          transition: isDragging ? 'none' : 'opacity 120ms ease-out',
        }}
      />

      {/* 焦点指示器 */}
      <div
        className="absolute inset-y-2 left-0 right-0 rounded-sm opacity-0 group-focus-visible:opacity-100"
        style={{
          boxShadow: '0 0 0 2px var(--color-primary)',
        }}
      />
    </div>
  );
};
