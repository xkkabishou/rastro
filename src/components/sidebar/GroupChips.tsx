/**
 * GroupChips — 侧栏分组筛选（T2.5.2）
 *
 * 水平滚动 Chip 行：全部 / 已翻译 / 有总结 / 收藏
 * 选中时高亮，更新 useDocumentStore.activeFilter
 */
import { useCallback, useMemo } from 'react';
import { useDocumentStore } from '../../stores/useDocumentStore';
import type { DocumentFilter } from '../../shared/types';

/** 筛选项定义 */
interface FilterChip {
  /** 显示标签 */
  label: string;
  /** 对应的 DocumentFilter（空对象 = "全部"） */
  filter: DocumentFilter;
}

const FILTER_CHIPS: FilterChip[] = [
  { label: '全部', filter: {} },
  { label: '已翻译', filter: { hasTranslation: true } },
  { label: '有总结', filter: { hasSummary: true } },
  { label: '收藏', filter: { isFavorite: true } },
];

/**
 * 判断两个 DocumentFilter 是否等价
 * 空对象 {} 视为"全部"
 */
function filtersEqual(a: DocumentFilter, b: DocumentFilter): boolean {
  const aKeys = Object.keys(a).filter(
    (k) => a[k as keyof DocumentFilter] !== undefined,
  );
  const bKeys = Object.keys(b).filter(
    (k) => b[k as keyof DocumentFilter] !== undefined,
  );
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (k) => a[k as keyof DocumentFilter] === b[k as keyof DocumentFilter],
  );
}

export function GroupChips() {
  const activeFilter = useDocumentStore((s) => s.activeFilter);
  const setActiveFilter = useDocumentStore((s) => s.setActiveFilter);

  // 当前选中的 chip index
  const activeIndex = useMemo(
    () => FILTER_CHIPS.findIndex((c) => filtersEqual(c.filter, activeFilter)),
    [activeFilter],
  );

  const handleClick = useCallback(
    (chip: FilterChip) => {
      setActiveFilter(chip.filter);
    },
    [setActiveFilter],
  );

  return (
    <div className="px-3 pb-2 shrink-0">
      <div className="flex gap-1.5">
        {FILTER_CHIPS.map((chip, index) => {
          const isActive = index === activeIndex || (activeIndex === -1 && index === 0);
          return (
            <button
              key={chip.label}
              onClick={() => handleClick(chip)}
              className={`
                flex-1 py-1 rounded-full text-[11px] font-medium text-center
                transition-all duration-150 cursor-pointer select-none
                ${
                  isActive
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                }
              `}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
