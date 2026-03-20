import type { AnnotationRectDto } from '../shared/types';

// ---------------------------------------------------------------------------
// PDF 坐标转换工具
// 坐标系统：使用页面尺寸百分比（0~1 归一化），缩放无关
// ---------------------------------------------------------------------------

/** CSS 绝对定位矩形（像素） */
export interface CSSRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 合并同行相邻/重叠矩形，并裁剪行间高度防止垂直重叠
 *
 * 第一遍：合并同行相邻/重叠矩形（减少 DOM 元素数）
 * 第二遍：裁剪行间高度，确保上一行的底部不超过下一行的顶部
 *         避免半透明 mixBlendMode: multiply 导致重叠区域颜色加深
 */
export function mergeOverlappingRects(rects: AnnotationRectDto[]): AnnotationRectDto[] {
  if (rects.length <= 1) return rects;

  const sorted = [...rects].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    if (Math.abs(a.y - b.y) > 0.005) return a.y - b.y;
    return a.x - b.x;
  });

  // 第一遍：合并同行矩形
  const merged: AnnotationRectDto[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    const sameRow =
      current.pageNumber === last.pageNumber &&
      Math.abs(current.y - last.y) < last.height * 0.5;
    const overlaps = sameRow && current.x <= last.x + last.width + 0.005;

    if (overlaps) {
      const newRight = Math.max(last.x + last.width, current.x + current.width);
      last.width = newRight - last.x;
      last.height = Math.max(last.height, current.height);
    } else {
      merged.push({ ...current });
    }
  }

  // 第二遍：裁剪行间高度，防止相邻行的矩形在 Y 方向重叠
  for (let i = 0; i < merged.length - 1; i++) {
    const current = merged[i];
    const next = merged[i + 1];

    // 只裁剪同页的矩形
    if (current.pageNumber !== next.pageNumber) continue;

    const currentBottom = current.y + current.height;
    // 如果当前行的底部超过了下一行的顶部，裁剪高度
    if (currentBottom > next.y) {
      current.height = next.y - current.y;
      // 保证高度不为负
      if (current.height < 0.001) current.height = 0.001;
    }
  }

  return merged;
}

/**
 * 将浏览器 Selection 转换为页面百分比归一化坐标矩形
 * x, y, width, height 均为 0~1 之间的比例值
 */
export function selectionToAnnotationRects(
  selection: Selection,
  viewerContainer: HTMLElement,
): AnnotationRectDto[] {
  if (!selection.rangeCount) return [];

  const range = selection.getRangeAt(0);
  const clientRects = range.getClientRects();
  if (!clientRects.length) return [];

  const results: AnnotationRectDto[] = [];

  for (let i = 0; i < clientRects.length; i++) {
    const rect = clientRects[i];
    if (rect.width < 1 || rect.height < 1) continue;

    const pageEl = findPageForRect(viewerContainer, rect);
    if (!pageEl) continue;

    const pageNumber = parseInt(pageEl.dataset.pageNumber || '1', 10);
    const pageBounds = pageEl.getBoundingClientRect();

    // 跳过零尺寸页面
    if (pageBounds.width < 1 || pageBounds.height < 1) continue;

    // 归一化为页面尺寸百分比（0~1）
    const x = (rect.left - pageBounds.left) / pageBounds.width;
    const y = (rect.top - pageBounds.top) / pageBounds.height;
    const width = rect.width / pageBounds.width;
    const height = rect.height / pageBounds.height;

    results.push({ x, y, width, height, pageNumber });
  }

  return mergeOverlappingRects(results);
}

/**
 * 将百分比归一化坐标转换为容器内 CSS 绝对定位（像素）
 * containerWidth/Height 应为渲染容器（.page 元素）的实际像素尺寸
 *
 * 同时裁剪行间高度：上一行的底部不超过下一行的顶部，
 * 防止半透明 mixBlendMode: multiply 在重叠区域颜色加深
 */
export function annotationRectsToCSS(
  rects: AnnotationRectDto[],
  containerWidth: number,
  containerHeight: number,
): CSSRect[] {
  if (rects.length === 0) return [];

  // 转换为像素坐标
  const cssRects = rects.map((r) => ({
    left: r.x * containerWidth,
    top: r.y * containerHeight,
    width: r.width * containerWidth,
    height: r.height * containerHeight,
  }));

  // 按 top 排序后裁剪行间高度
  const sorted = [...cssRects].sort((a, b) => a.top - b.top || a.left - b.left);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const currentBottom = current.top + current.height;
    // 如果当前行的底部超过下一行的顶部，裁剪到下一行顶部
    if (currentBottom > next.top + 0.5) {
      current.height = Math.max(next.top - current.top, 1);
    }
  }

  return sorted;
}

/**
 * 找到 client rect 所属的 page 元素
 */
function findPageForRect(
  viewerContainer: HTMLElement,
  rect: DOMRect,
): HTMLElement | null {
  const pages = viewerContainer.querySelectorAll<HTMLElement>('.page');
  const rectCenterY = rect.top + rect.height / 2;
  const rectCenterX = rect.left + rect.width / 2;

  for (const page of pages) {
    const pageBounds = page.getBoundingClientRect();
    if (
      rectCenterX >= pageBounds.left &&
      rectCenterX <= pageBounds.right &&
      rectCenterY >= pageBounds.top &&
      rectCenterY <= pageBounds.bottom
    ) {
      return page;
    }
  }
  return null;
}
