import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Highlighter } from 'lucide-react';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { AnnotationFilterBar, DEFAULT_FILTERS } from './AnnotationFilterBar';
import type { AnnotationFilters } from './AnnotationFilterBar';
import { AnnotationCard } from './AnnotationCard';
import type { AnnotationDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 按页码分组 */
function groupByPage(annotations: AnnotationDto[]): Map<number, AnnotationDto[]> {
  const map = new Map<number, AnnotationDto[]>();
  for (const ann of annotations) {
    const group = map.get(ann.pageNumber);
    if (group) group.push(ann);
    else map.set(ann.pageNumber, [ann]);
  }
  return map;
}

/** 应用筛选 */
function applyFilters(
  annotations: AnnotationDto[],
  filters: AnnotationFilters,
): AnnotationDto[] {
  let result = annotations;

  // 类型筛选
  if (filters.typeFilter) {
    result = result.filter((a) => a.type === filters.typeFilter);
  }

  // 颜色筛选
  if (filters.colorFilters.size > 0) {
    result = result.filter((a) => filters.colorFilters.has(a.color));
  }

  // 搜索
  if (filters.searchQuery.trim()) {
    const query = filters.searchQuery.trim().toLowerCase();
    result = result.filter(
      (a) =>
        a.text.toLowerCase().includes(query) ||
        (a.noteContent && a.noteContent.toLowerCase().includes(query)),
    );
  }

  // 排序
  if (filters.sortBy === 'time') {
    result = [...result].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  // 按页码排序已由后端保证

  return result;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const AnnotationPanel: React.FC = () => {
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedAnnotationId = useAnnotationStore((s) => s.selectedAnnotationId);
  const [filters, setFilters] = useState<AnnotationFilters>(DEFAULT_FILTERS);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredAnnotations = useMemo(
    () => applyFilters(annotations, filters),
    [annotations, filters],
  );

  const groupedByPage = useMemo(
    () => (filters.sortBy === 'page' ? groupByPage(filteredAnnotations) : null),
    [filteredAnnotations, filters.sortBy],
  );

  // 选中标注时自动滚动到对应卡片
  useEffect(() => {
    if (!selectedAnnotationId || !listRef.current) return;
    const card = listRef.current.querySelector(
      `[data-annotation-id="${selectedAnnotationId}"]`,
    );
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedAnnotationId]);

  // 通知 PdfViewer 滚动到对应页码
  const handleScrollToPage = useCallback((_pageNumber: number) => {
    // 通过 pdfjs viewer 的 scrollPageIntoView 实现
    // 暂时由 store 的 selectAnnotation 触发 PdfViewer 的响应
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--color-border-secondary)]">
        <span className="text-xs font-medium text-[var(--color-text)]">
          标注
          {annotations.length > 0 && (
            <span className="ml-1.5 text-[var(--color-text-tertiary)]">
              {filteredAnnotations.length}
              {filteredAnnotations.length !== annotations.length
                ? ` / ${annotations.length}`
                : ''}
            </span>
          )}
        </span>
      </div>

      {/* 筛选栏 */}
      {annotations.length > 0 && (
        <AnnotationFilterBar filters={filters} onFiltersChange={setFilters} />
      )}

      {/* 标注列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {filteredAnnotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-quaternary)]">
            <Highlighter size={32} className="opacity-40" />
            <p className="text-xs text-center px-4">
              {annotations.length === 0
                ? '选中文本后即可创建标注'
                : '没有匹配的标注'}
            </p>
          </div>
        ) : filters.sortBy === 'page' && groupedByPage ? (
          // 按页码分组显示
          Array.from(groupedByPage.entries())
            .sort(([a], [b]) => a - b)
            .map(([page, pageAnnotations]) => (
              <div key={page}>
                <div className="px-4 py-1 text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                  第 {page} 页
                </div>
                <AnimatePresence mode="popLayout">
                  {pageAnnotations.map((ann) => (
                    <div key={ann.annotationId} data-annotation-id={ann.annotationId}>
                      <AnnotationCard
                        annotation={ann}
                        isSelected={selectedAnnotationId === ann.annotationId}
                        onScrollToPage={handleScrollToPage}
                      />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            ))
        ) : (
          // 按时间排序（平铺）
          <AnimatePresence mode="popLayout">
            {filteredAnnotations.map((ann) => (
              <div key={ann.annotationId} data-annotation-id={ann.annotationId}>
                <AnnotationCard
                  annotation={ann}
                  isSelected={selectedAnnotationId === ann.annotationId}
                  onScrollToPage={handleScrollToPage}
                />
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
