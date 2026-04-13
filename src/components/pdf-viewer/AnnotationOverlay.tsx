import React, { useMemo, useCallback, useState, useLayoutEffect } from 'react';
import { StickyNote } from 'lucide-react';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import { annotationRectsToCSS } from '../../lib/annotation-coords';
import type { AnnotationDto, AnnotationColor } from '../../shared/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface AnnotationOverlayProps {
  /** PDF 页码（1-based） */
  pageNumber: number;
  /** 对应的 pdfjs `.page` 元素，用于读取真实 layout */
  pageEl: HTMLElement;
  /** 覆盖层挂载到的滚动容器（viewerContainerRef），用于坐标换算 */
  parentEl: HTMLElement | null;
  /** 外部触发布局同步的计数器（scalechanging / pagerendered 等事件递增） */
  layoutVersion: number;
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
    // 路线 X 改造：overlay 不再挂在 .page 内，改为查找最近的 overlay 根节点
    const overlayRoot = (e.currentTarget as HTMLElement).closest('[data-annotation-overlay]');
    if (!overlayRoot) return undefined;
    // 查找该标注的所有渲染矩形 DOM 元素
    const allDivs = overlayRoot.querySelectorAll<HTMLElement>(
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

  // 是否需要 multiply 混合（highlight / note 类型）
  const needsBlend = annotation.type === 'highlight' || annotation.type === 'note';
  const isUnderline = annotation.type === 'underline';

  // 渲染各 rect
  const rectElements = cssRects.map((rect, idx) => (
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
        // highlight/note：使用不透明的 dot 颜色作为背景色
        // 透明度由外层 wrapper 的 opacity 统一控制，避免重叠处 alpha 叠加变暗
        ...(needsBlend
          ? { backgroundColor: `var(--annotation-${color}-dot)` }
          : {}),
        ...(isUnderline
          ? { borderBottom: `2px solid var(--annotation-${color}-border)` }
          : {}),
      }}
    />
  ));

  // 选中态的 outline 在 wrapper 外部，不受 opacity 影响
  const selectionOutlines = isSelected
    ? cssRects.map((rect, idx) => (
        <div
          key={`sel-${annotation.annotationId}-${idx}`}
          className="absolute pointer-events-none"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            outline: `2px solid var(--annotation-${color}-dot)`,
            outlineOffset: '1px',
          }}
        />
      ))
    : null;

  return (
    <>
      {/* highlight/note 类型：wrapper 统一控制 opacity + multiply 混合
          rects 用不透明纯色背景，内部重叠不会颜色加深 */}
      {needsBlend ? (
        <div style={{ mixBlendMode: 'multiply' as const, opacity: 0.35 }}>
          {rectElements}
        </div>
      ) : (
        rectElements
      )}

      {/* 选中态 outline（在 wrapper 外有，不受 opacity 影响） */}
      {selectionOutlines}

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
  ({ pageNumber, pageEl, parentEl, layoutVersion, onAnnotationContextMenu }) => {
    const annotationsByPage = useAnnotationStore((s) => s.annotationsByPage);
    const selectedAnnotationId = useAnnotationStore((s) => s.selectedAnnotationId);
    const selectAnnotation = useAnnotationStore((s) => s.selectAnnotation);
    const startEditingNote = useAnnotationStore((s) => s.startEditingNote);

    // 覆盖层相对 parentEl 的坐标与大小（路线 X：绝对定位跟随 .page）
    const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number }>(
      { top: 0, left: 0, width: 0, height: 0 },
    );

    // 同步覆盖层位置：用 getBoundingClientRect 相对 parentEl（viewerContainerRef）计算
    // 自动处理 .pdfViewer 的 margin-auto 居中、容器内边距、滚动偏移等
    useLayoutEffect(() => {
      if (!pageEl || !parentEl) return;

      const syncRect = () => {
        const parentBox = parentEl.getBoundingClientRect();
        const pageBox = pageEl.getBoundingClientRect();
        setRect({
          top: pageBox.top - parentBox.top + parentEl.scrollTop,
          left: pageBox.left - parentBox.left + parentEl.scrollLeft,
          width: pageBox.width,
          height: pageBox.height,
        });
      };
      syncRect();

      // ResizeObserver 兜底：.page 本页自身尺寸变化（例如字体异步加载后的微调）
      const observer = new ResizeObserver(syncRect);
      observer.observe(pageEl);
      return () => observer.disconnect();
      // layoutVersion 变化时重新订阅 + 重新同步（scale 变化/pagerendered/viewer resize）
    }, [pageEl, parentEl, layoutVersion]);

    const pageAnnotations = useMemo(
      () => annotationsByPage.get(pageNumber) || [],
      [annotationsByPage, pageNumber],
    );

    return (
      <div
        data-annotation-overlay={pageNumber}
        className="pointer-events-none"
        style={{
          position: 'absolute',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          zIndex: 3,
        }}
      >
        {rect.width > 0 && pageAnnotations.map((ann) => (
          <AnnotationItem
            key={ann.annotationId}
            annotation={ann}
            containerWidth={rect.width}
            containerHeight={rect.height}
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
