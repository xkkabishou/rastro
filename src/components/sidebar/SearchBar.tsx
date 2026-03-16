/**
 * SearchBar — 侧栏搜索框（T2.5.1）
 *
 * 功能：300ms 防抖、🔍 前缀 icon、清空按钮、同步 useDocumentStore.searchQuery
 */
import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useDocumentStore } from '../../stores/useDocumentStore';

const SEARCH_DEBOUNCE_MS = 300;

export function SearchBar() {
  const setSearchQuery = useDocumentStore((s) => s.setSearchQuery);
  const [localQuery, setLocalQuery] = useState('');

  // 300ms 防抖：本地输入 → store
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQuery, setSearchQuery]);

  // 清空搜索
  const handleClear = useCallback(() => {
    setLocalQuery('');
    setSearchQuery('');
  }, [setSearchQuery]);

  return (
    <div className="px-3 pb-2 shrink-0">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-quaternary)]"
        />
        <input
          type="text"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="搜索文献..."
          className="input-base w-full pl-8 pr-7 py-1.5 text-xs rounded-lg"
        />
        {/* 清空按钮 */}
        {localQuery && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--color-text-quaternary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
