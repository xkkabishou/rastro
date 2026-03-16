import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { StickyNote } from 'lucide-react';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import { annotationRectsToCSS } from '../../lib/annotation-coords';
import type { AnnotationDto, AnnotationColor } from '../../shared/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface AnnotationOverlayProps {
  pageNumber: number;
  onAnnotationContextMenu?: (annotation: AnnotationDto, event: React.MouseEvent) => void;
}

// ---------------------------------------------------------------------------
// 单个标注渲染
// ---------------------------------------------------------------------------

const AnnotationItem: React.FC<{
  annotation: AnnotationDto;
  containerWidth: number;
  containerHeight: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onStartEditNote: (id: string, anchor?: { endX: number; endY: number; startX: number; startY: number }) => void;
  onContextMenu?: (annotation: AnnotationDto, event: React.MouseEvent) => void;
}> = React.memo(({ annotation, containerWidth, containerHeight, isSelected, onSelect, onStartEditNote, onContextMenu }) => {
  const cssRects = useMemo(
    () => annotationRectsToCSS(annotation.rects, containerWidth, containerHeight),
    [annotation.rects, containerWidth, containerHeight],
  );

  const color = annotation.color as AnnotationColor;

  /** 从 DOM 实际渲染位置获取首尾锚点 */
  const calcAnchor = useCallback((e: React.MouseEvent) => {
    const pageEl = (e.currentTarget as HTMLElement).closest('.page');
    if (!pageEl) return undefined;
    // 查找该标注的所有渲染矩形 DOM 元素
    const allDivs = pageEl.querySelectorAll<HTMLElement>(
      `[data-ann-id="${annotation.annotationId}"]`,
    );
    if (allDivs.length === 0) return undefined;
    const firstBounds = allDivs[0].getBoundingClientRect();
    const lastBounds = allDivs[allDivs.length - 1].getBoundingClientRect();
    return {
      endX: lastBounds.right,
      endY: lastBounds.bottom,
      startX: firstBounds.right,
      startY: firstBounds.top,
    };
  }, [annotation.annotationId]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (annotation.noteContent || annotation.type === 'note') {
        onStartEditNote(annotation.annotationId, calcAnchor(e));
      } else {
        onSelect(annotation.annotationId);
      }
    },
    [annotation.annotationId, annotation.noteContent, annotation.type, onSelect, onStartEditNote, calcAnchor],
  );

  const handleNoteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEditNote(annotation.annotationId, calcAnchor(e));
    },
    [annotation.annotationId, onStartEditNote, calcAnchor],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu?.(annotation, e);
    },
    [annotation, onContextMenu],
  );

  return (
    <>
      {cssRects.map((rect, idx) => {
        const isHighlight = annotation.type === 'highlight';
        const isUnderline = annotation.type === 'underline';

        return (
          <div
            key={`${annotation.annotationId}-${idx}`}
            data-ann-id={annotation.annotationId}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className="absolute pointer-events-auto cursor-pointer"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              ...(isHighlight || annotation.type === 'note'
                ? {
                    backgroundColor: `var(--annotation-${color}-bg)`,
                    mixBlendMode: 'multiply' as const,
                  }
                : {}),
              ...(isUnderline
                ? {
                    borderBottom: `2px solid var(--annotation-${color}-border)`,
                  }
                : {}),
              ...(isSelected
                ? {
                    outline: `2px solid var(--annotation-${color}-dot)`,
                    outlineOffset: '1px',
                  }
                : {}),
            }}
          />
        );
      })}

      {/* 笔记图标 */}
      {annotation.type === 'note' && cssRects.length > 0 && (
        <div
          onClick={handleNoteClick}
          onContextMenu={handleContextMenu}
          className="absolute pointer-events-auto cursor-pointer z-10 hover:scale-110 transition-transform"
          style={{
            left: cssRects[0].left + cssRects[0].width - 4,
            top: cssRects[0].top - 8,
          }}
          title={annotation.noteContent || '添加笔记'}
        >
          <StickyNote
            size={14}
            style={{ color: `var(--annotation-${color}-dot)` }}
            fill={`var(--annotation-${color}-bg)`}
          />
        </div>
      )}
    </>
  );
});

AnnotationItem.displayName = 'AnnotationItem';

// ---------------------------------------------------------------------------
// 页面标注覆盖层
// ---------------------------------------------------------------------------

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = React.memo(
  ({ pageNumber, onAnnotationContextMenu }) => {
    const annotationsByPage = useAnnotationStore((s) => s.annotationsByPage);
    const selectedAnnotationId = useAnnotationStore((s) => s.selectedAnnotationId);
    const selectAnnotation = useAnnotationStore((s) => s.selectAnnotation);
    const startEditingNote = useAnnotationStore((s) => s.startEditingNote);

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // 监听容器尺寸变化（跟随缩放）
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const updateSize = () => {
        setContainerSize({ width: el.offsetWidth, height: el.offsetHeight });
      };
      updateSize();

      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    const pageAnnotations = useMemo(
      () => annotationsByPage.get(pageNumber) || [],
      [annotationsByPage, pageNumber],
    );

    return (
      <div
        ref={containerRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 3 }}
      >
        {containerSize.width > 0 && pageAnnotations.map((ann) => (
          <AnnotationItem
            key={ann.annotationId}
            annotation={ann}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            isSelected={selectedAnnotationId === ann.annotationId}
            onSelect={selectAnnotation}
            onStartEditNote={startEditingNote}
            onContextMenu={onAnnotationContextMenu}
          />
        ))}
      </div>
    );
  },
);

AnnotationOverlay.displayName = 'AnnotationOverlay';
