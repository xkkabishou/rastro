import React, { useCallback } from 'react';
import { Highlighter, Underline, StickyNote, Search } from 'lucide-react';
import type { AnnotationType, AnnotationColor } from '../../shared/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AnnotationFilters {
  typeFilter: AnnotationType | null;
  colorFilters: Set<AnnotationColor>;
  sortBy: 'page' | 'time';
  searchQuery: string;
}

interface AnnotationFilterBarProps {
  filters: AnnotationFilters;
  onFiltersChange: (filters: AnnotationFilters) => void;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const COLORS: AnnotationColor[] = [
  'yellow', 'red', 'green', 'blue', 'purple', 'magenta', 'orange', 'gray',
];

const TYPE_OPTIONS: { type: AnnotationType | null; icon?: React.ElementType; label: string }[] = [
  { type: null, label: '全部' },
  { type: 'highlight', icon: Highlighter, label: '高亮' },
  { type: 'underline', icon: Underline, label: '下划线' },
  { type: 'note', icon: StickyNote, label: '笔记' },
];

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const AnnotationFilterBar: React.FC<AnnotationFilterBarProps> = ({
  filters,
  onFiltersChange,
}) => {
  const handleTypeClick = useCallback(
    (type: AnnotationType | null) => {
      onFiltersChange({ ...filters, typeFilter: type });
    },
    [filters, onFiltersChange],
  );

  const handleColorClick = useCallback(
    (color: AnnotationColor) => {
      const newColors = new Set(filters.colorFilters);
      if (newColors.has(color)) {
        newColors.delete(color);
      } else {
        newColors.add(color);
      }
      onFiltersChange({ ...filters, colorFilters: newColors });
    },
    [filters, onFiltersChange],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, searchQuery: e.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleSortChange = useCallback(() => {
    onFiltersChange({
      ...filters,
      sortBy: filters.sortBy === 'page' ? 'time' : 'page',
    });
  }, [filters, onFiltersChange]);

  return (
    <div className="px-3 py-2 space-y-2 border-b border-[var(--color-border-secondary)]">
      {/* 搜索框 */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-quaternary)]"
        />
        <input
          type="text"
          value={filters.searchQuery}
          onChange={handleSearchChange}
          placeholder="搜索标注内容..."
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-quaternary)] focus:outline-none focus:border-[var(--color-border-focus)]"
        />
      </div>

      {/* 类型筛选 + 排序 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          {TYPE_OPTIONS.map(({ type, icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => handleTypeClick(type)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                filters.typeFilter === type
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover)]'
              }`}
            >
              {Icon && <Icon size={11} />}
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={handleSortChange}
          className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          {filters.sortBy === 'page' ? '按页码' : '按时间'}
        </button>
      </div>

      {/* 颜色筛选 */}
      <div className="flex items-center gap-1">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => handleColorClick(color)}
            className={`w-3.5 h-3.5 rounded-full transition-all ${
              filters.colorFilters.size === 0 || filters.colorFilters.has(color)
                ? 'opacity-100'
                : 'opacity-30'
            } hover:scale-110`}
            style={{ backgroundColor: `var(--annotation-${color}-dot)` }}
          />
        ))}
      </div>
    </div>
  );
};

/** 默认筛选状态 */
export const DEFAULT_FILTERS: AnnotationFilters = {
  typeFilter: null,
  colorFilters: new Set(),
  sortBy: 'page',
  searchQuery: '',
};
