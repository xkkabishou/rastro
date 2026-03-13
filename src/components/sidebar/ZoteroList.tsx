import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, FileText, BookOpen, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';
import type { ZoteroItemDto, ZoteroStatusDto, PagedZoteroItemsDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 每页加载数 */
const PAGE_SIZE = 50;

/** 搜索防抖延迟 (ms) */
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * Zotero 文献列表
 * T4.1.4 [REQ-007]
 *
 * 虚拟化列表展示 Zotero 文献条目，支持搜索过滤和点击打开 PDF
 */
export const ZoteroList: React.FC = () => {
  // 状态
  const [status, setStatus] = useState<ZoteroStatusDto | null>(null);
  const [items, setItems] = useState<ZoteroItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore((s) => s.setPdfUrl);
  const parentRef = useRef<HTMLDivElement>(null);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // 探测 Zotero 状态
  const detectZotero = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const zoteroStatus = await ipcClient.detectZoteroLibrary();
      setStatus(zoteroStatus);
      return zoteroStatus.detected;
    } catch (err) {
      console.error('探测 Zotero 失败:', err);
      setStatus({ detected: false, statusMessage: '无法连接 Zotero' });
      setError('Zotero 探测失败，请确认 Zotero 已安装');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 加载文献列表
  const fetchItems = useCallback(async (searchQuery: string, offset = 0, append = false) => {
    try {
      if (offset === 0) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      const result: PagedZoteroItemsDto = await ipcClient.fetchZoteroItems({
        query: searchQuery || undefined,
        offset,
        limit: PAGE_SIZE,
      });

      if (append) {
        setItems((prev) => [...prev, ...result.items]);
      } else {
        setItems(result.items);
      }
      setTotal(result.total);
      setHasMore(offset + result.items.length < result.total);
    } catch (err) {
      console.error('加载 Zotero 文献失败:', err);
      // 如果是首次加载失败，用空数据展示
      if (!append) {
        setItems([]);
        setTotal(0);
      }
      setError('加载文献列表失败');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // 初始化：探测 + 首次加载
  useEffect(() => {
    (async () => {
      const detected = await detectZotero();
      if (detected) {
        await fetchItems('');
      }
    })();
  }, [detectZotero, fetchItems]);

  // 搜索变化时重新加载
  useEffect(() => {
    if (status?.detected) {
      fetchItems(debouncedQuery, 0, false);
    }
  }, [debouncedQuery, status?.detected, fetchItems]);

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchItems(debouncedQuery, items.length, true);
    }
  }, [isLoadingMore, hasMore, debouncedQuery, items.length, fetchItems]);

  // 点击打开文献 PDF
  const handleOpenItem = useCallback(async (item: ZoteroItemDto) => {
    if (!item.pdfPath) return;
    try {
      const doc = await ipcClient.openZoteroAttachment(item.itemKey);
      setCurrentDocument(doc);
      // 使用 convertFileSrc 将本地路径转为 asset:// 协议 URL
      // Tauri WebView 安全策略不允许直接通过 file:// 加载本地文件
      const assetUrl = convertFileSrc(doc.filePath);
      setPdfUrl(assetUrl);
    } catch (err) {
      console.error('打开 Zotero 附件失败:', err);
    }
  }, [setCurrentDocument, setPdfUrl]);

  // 虚拟化
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  // -------------------------------------------------------------------------
  // Zotero 未检测到
  // -------------------------------------------------------------------------

  if (!isLoading && status && !status.detected) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-tertiary)] flex items-center justify-center">
          <BookOpen size={24} className="text-[var(--color-text-quaternary)]" />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            未检测到 Zotero
          </p>
          <p className="text-[10px] text-[var(--color-text-quaternary)] leading-relaxed">
            {status.statusMessage || '请确认 Zotero 已安装并至少运行过一次'}
          </p>
        </div>
        <button
          onClick={detectZotero}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-selected)] transition-colors"
        >
          <RefreshCw size={12} />
          重新检测
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 正常列表渲染
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* 搜索栏 */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-quaternary)]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文献..."
            className="input-base w-full pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
        {/* 统计 */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-[var(--color-text-quaternary)]">
            {total > 0 ? `${total} 篇文献` : ''}
          </span>
          {status?.databasePath && (
            <span className="text-[10px] text-[var(--color-text-quaternary)] truncate max-w-[120px]" title={status.databasePath}>
              Zotero ✓
            </span>
          )}
        </div>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 gap-2">
          <Loader2 size={16} className="text-[var(--color-text-quaternary)] animate-spin" />
          <span className="text-xs text-[var(--color-text-quaternary)]">加载中...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 p-4 text-center">
          <FileText size={20} className="text-[var(--color-text-quaternary)]" />
          <p className="text-xs text-[var(--color-text-quaternary)]">
            {debouncedQuery ? '未找到匹配的文献' : '暂无文献'}
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto px-2">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ZoteroItemCard
                    item={item}
                    onClick={() => handleOpenItem(item)}
                  />
                </div>
              );
            })}
          </div>

          {/* 加载更多 */}
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="w-full py-2 text-xs text-[var(--color-primary)] hover:bg-[var(--color-hover)] rounded-lg transition-colors"
            >
              {isLoadingMore ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  加载中...
                </span>
              ) : (
                '加载更多'
              )}
            </button>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 shrink-0 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
            <AlertCircle size={12} />
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

/** 文献条目卡片 */
const ZoteroItemCard: React.FC<{
  item: ZoteroItemDto;
  onClick: () => void;
}> = ({ item, onClick }) => {
  // 格式化作者（最多显示 2 个 + et al.）
  const formattedAuthors = useMemo(() => {
    if (!item.authors || item.authors.length === 0) return '未知作者';
    if (item.authors.length <= 2) return item.authors.join(', ');
    return `${item.authors[0]}, ${item.authors[1]} et al.`;
  }, [item.authors]);

  return (
    <button
      onClick={onClick}
      disabled={!item.pdfPath}
      className={`w-full text-left p-2.5 rounded-xl transition-colors group ${
        item.pdfPath
          ? 'hover:bg-[var(--color-hover)] cursor-pointer'
          : 'opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex gap-2.5">
        {/* 图标 */}
        <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0 group-hover:bg-[var(--color-selected)]">
          <FileText size={14} className="text-[var(--color-text-quaternary)] group-hover:text-[var(--color-primary)]" />
        </div>
        {/* 信息 */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-tight mb-0.5">
            {item.title}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-quaternary)]">
            <span className="truncate max-w-[140px]">{formattedAuthors}</span>
            {item.year && (
              <>
                <span>·</span>
                <span>{item.year}</span>
              </>
            )}
          </div>
          {item.publicationTitle && (
            <p className="text-[10px] text-[var(--color-text-quaternary)] truncate mt-0.5 italic">
              {item.publicationTitle}
            </p>
          )}
        </div>
      </div>
    </button>
  );
};
