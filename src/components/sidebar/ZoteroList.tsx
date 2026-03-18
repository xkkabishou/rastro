import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Search, FileText, BookOpen, Loader2, AlertCircle,
  RefreshCw, ChevronRight, ChevronDown, FolderOpen, Folder, FolderMinus,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';
import type { ZoteroItemDto, ZoteroStatusDto, ZoteroCollectionDto, PagedZoteroItemsDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 首次展开加载数量 */
const INITIAL_LOAD = 20;

/** 加载更多每批数量 */
const LOAD_MORE_SIZE = 30;

// ---------------------------------------------------------------------------
// 辅助类型
// ---------------------------------------------------------------------------

/** collection 树节点 */
interface CollectionTreeNode {
  collection: ZoteroCollectionDto;
  children: CollectionTreeNode[];
}

/** 展开的 collection 数据缓存 */
interface ExpandedCollectionData {
  items: ZoteroItemDto[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 将扁平 collections 列表构建为树形结构 */
function buildCollectionTree(collections: ZoteroCollectionDto[]): CollectionTreeNode[] {
  const nodeMap = new Map<number, CollectionTreeNode>();
  const roots: CollectionTreeNode[] = [];

  for (const c of collections) {
    nodeMap.set(c.collectionId, { collection: c, children: [] });
  }

  for (const c of collections) {
    const node = nodeMap.get(c.collectionId)!;
    if (c.parentCollectionId != null) {
      const parent = nodeMap.get(c.parentCollectionId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  return roots;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * Zotero 文献列表
 *
 * 树形内联展开：点击文件夹 → 在原地展开文献列表
 */
export const ZoteroList: React.FC = () => {
  const [status, setStatus] = useState<ZoteroStatusDto | null>(null);
  const [collections, setCollections] = useState<CollectionTreeNode[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 展开状态：key = collectionId（null 代表"未分类"）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 每个展开 collection 的文献数据缓存
  const [collectionData, setCollectionData] = useState<Map<string, ExpandedCollectionData>>(new Map());

  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore((s) => s.setPdfUrl);

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

  // 加载 collections 树
  const loadCollections = useCallback(async () => {
    try {
      const rawCollections = await ipcClient.fetchZoteroCollections();
      const tree = buildCollectionTree(rawCollections);
      setCollections(tree);

      // 获取未分类文献数
      const uncategorized = await ipcClient.fetchZoteroCollectionItems({
        collectionId: null, offset: 0, limit: 1,
      });
      setUncategorizedCount(uncategorized.total);
    } catch (err) {
      console.error('加载 Zotero collections 失败:', err);
      setError('加载文件夹结构失败');
    }
  }, []);

  // 初始化
  useEffect(() => {
    (async () => {
      const detected = await detectZotero();
      if (detected) {
        await loadCollections();
      }
    })();
  }, [detectZotero, loadCollections]);

  // collection key：数字 ID 或 "uncategorized"
  const getKey = (collectionId: number | null) =>
    collectionId === null ? 'uncategorized' : String(collectionId);

  // 加载某个 collection 的文献
  const loadCollectionItems = useCallback(async (collectionId: number | null, offset = 0) => {
    const key = collectionId === null ? 'uncategorized' : String(collectionId);

    setCollectionData((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      next.set(key, {
        items: existing?.items ?? [],
        total: existing?.total ?? 0,
        isLoading: offset === 0,
        isLoadingMore: offset > 0,
      });
      return next;
    });

    try {
      const result: PagedZoteroItemsDto = await ipcClient.fetchZoteroCollectionItems({
        collectionId,
        offset,
        limit: offset === 0 ? INITIAL_LOAD : LOAD_MORE_SIZE,
      });

      setCollectionData((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        const items = offset === 0
          ? result.items
          : [...(existing?.items ?? []), ...result.items];
        next.set(key, {
          items,
          total: result.total,
          isLoading: false,
          isLoadingMore: false,
        });
        return next;
      });
    } catch (err) {
      console.error('加载文献失败:', err);
      setCollectionData((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        next.set(key, {
          items: existing?.items ?? [],
          total: existing?.total ?? 0,
          isLoading: false,
          isLoadingMore: false,
        });
        return next;
      });
    }
  }, []);

  // 切换展开/折叠
  const toggleCollection = useCallback((collectionId: number | null) => {
    const key = collectionId === null ? 'uncategorized' : String(collectionId);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // 首次展开时加载文献
        if (!collectionData.has(key)) {
          loadCollectionItems(collectionId, 0);
        }
      }
      return next;
    });
  }, [collectionData, loadCollectionItems]);

  // 点击打开文献 PDF
  const handleOpenItem = useCallback(async (item: ZoteroItemDto) => {
    if (!item.pdfPath) return;
    try {
      const doc = await ipcClient.openZoteroAttachment(item.itemKey);
      setCurrentDocument(doc);
      const assetUrl = convertFileSrc(doc.filePath);
      setPdfUrl(assetUrl);
    } catch (err) {
      console.error('打开 Zotero 附件失败:', err);
    }
  }, [setCurrentDocument, setPdfUrl]);

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
  // 正常渲染
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 */}
      <div className="px-3 py-2 shrink-0 flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-quaternary)]">
          {status?.itemCount != null ? `共 ${status.itemCount} 篇文献` : ''}
        </span>
        <button
          onClick={async () => {
            setCollectionData(new Map());
            setExpandedIds(new Set());
            await detectZotero();
            await loadCollections();
          }}
          className="p-1 rounded-md hover:bg-[var(--color-hover)] transition-colors"
          title="刷新"
        >
          <RefreshCw size={12} className="text-[var(--color-text-quaternary)]" />
        </button>
      </div>

      {/* 树形列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6">
            <Loader2 size={16} className="text-[var(--color-text-quaternary)] animate-spin" />
            <span className="text-xs text-[var(--color-text-quaternary)]">加载中...</span>
          </div>
        ) : (
          <div className="pb-4">
            {/* Collection 树 */}
            {collections.map((node) => (
              <CollectionFolder
                key={node.collection.collectionId}
                node={node}
                depth={0}
                expandedIds={expandedIds}
                collectionData={collectionData}
                onToggle={toggleCollection}
                onLoadMore={loadCollectionItems}
                onOpenItem={handleOpenItem}
              />
            ))}

            {/* 未分类 */}
            {uncategorizedCount > 0 && (
              <CollectionFolder
                key="uncategorized"
                node={null}
                uncategorizedCount={uncategorizedCount}
                depth={0}
                expandedIds={expandedIds}
                collectionData={collectionData}
                onToggle={toggleCollection}
                onLoadMore={loadCollectionItems}
                onOpenItem={handleOpenItem}
              />
            )}
          </div>
        )}
      </div>

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
// 子组件：文件夹节点（可内联展开文献列表）
// ---------------------------------------------------------------------------

interface CollectionFolderProps {
  node: CollectionTreeNode | null; // null = 未分类
  uncategorizedCount?: number;
  depth: number;
  expandedIds: Set<string>;
  collectionData: Map<string, ExpandedCollectionData>;
  onToggle: (collectionId: number | null) => void;
  onLoadMore: (collectionId: number | null, offset: number) => void;
  onOpenItem: (item: ZoteroItemDto) => void;
}

const CollectionFolder: React.FC<CollectionFolderProps> = ({
  node, uncategorizedCount, depth,
  expandedIds, collectionData,
  onToggle, onLoadMore, onOpenItem,
}) => {
  const isUncategorized = node === null;
  const collectionId = isUncategorized ? null : node.collection.collectionId;
  const key = isUncategorized ? 'uncategorized' : String(collectionId);
  const name = isUncategorized ? '未分类' : node.collection.name;
  const itemCount = isUncategorized ? (uncategorizedCount ?? 0) : node.collection.itemCount;
  const hasChildren = !isUncategorized && node.children.length > 0;
  const isExpanded = expandedIds.has(key);
  const data = collectionData.get(key);
  const loadedCount = data?.items.length ?? 0;
  const totalCount = data?.total ?? itemCount;
  const hasMoreItems = loadedCount < totalCount;

  return (
    <div>
      {/* 文件夹行 */}
      <button
        onClick={() => onToggle(collectionId)}
        className="w-full flex items-center gap-1.5 py-1.5 pr-2 hover:bg-[var(--color-hover)] rounded-lg transition-colors group"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {/* 展开箭头 */}
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {isExpanded ? (
            <ChevronDown size={12} className="text-[var(--color-text-tertiary)]" />
          ) : (
            <ChevronRight size={12} className="text-[var(--color-text-tertiary)]" />
          )}
        </span>

        {/* 文件夹图标 */}
        {isUncategorized ? (
          <FolderMinus size={14} className="text-[var(--color-text-quaternary)] shrink-0" />
        ) : isExpanded ? (
          <FolderOpen size={14} className="text-[var(--color-primary)] shrink-0" />
        ) : (
          <Folder size={14} className="text-[var(--color-text-quaternary)] shrink-0 group-hover:text-[var(--color-primary)]" />
        )}

        {/* 名称 */}
        <span className="text-xs text-[var(--color-text-secondary)] truncate flex-1 text-left">
          {name}
        </span>

        {/* 数量 badge */}
        <span className="text-[10px] text-[var(--color-text-quaternary)] tabular-nums shrink-0 bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded-full">
          {itemCount}
        </span>
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div>
          {/* 子文件夹 */}
          {hasChildren && node.children.map((child) => (
            <CollectionFolder
              key={child.collection.collectionId}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              collectionData={collectionData}
              onToggle={onToggle}
              onLoadMore={onLoadMore}
              onOpenItem={onOpenItem}
            />
          ))}

          {/* 文献列表 */}
          {data?.isLoading ? (
            <div
              className="flex items-center gap-1.5 py-2 text-xs text-[var(--color-text-quaternary)]"
              style={{ paddingLeft: `${28 + depth * 14}px` }}
            >
              <Loader2 size={12} className="animate-spin" />
              加载中...
            </div>
          ) : (
            <>
              {data?.items.map((item) => (
                <InlineItemRow
                  key={item.itemKey}
                  item={item}
                  depth={depth}
                  onClick={() => onOpenItem(item)}
                />
              ))}

              {/* 加载更多 */}
              {hasMoreItems && loadedCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadMore(collectionId, loadedCount);
                  }}
                  disabled={data?.isLoadingMore}
                  className="flex items-center gap-1.5 py-1.5 text-[11px] text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
                  style={{ paddingLeft: `${28 + depth * 14}px` }}
                >
                  {data?.isLoadingMore ? (
                    <>
                      <Loader2 size={10} className="animate-spin" />
                      加载中...
                    </>
                  ) : (
                    `加载更多 (${loadedCount}/${totalCount})`
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 子组件：文献条目行（内联文件夹下方的紧凑版）
// ---------------------------------------------------------------------------

const InlineItemRow: React.FC<{
  item: ZoteroItemDto;
  depth: number;
  onClick: () => void;
}> = ({ item, depth, onClick }) => {
  // 格式化作者（第一作者 + 年份）
  const meta = useMemo(() => {
    const parts: string[] = [];
    if (item.authors?.length) {
      parts.push(item.authors[0].split(' ').pop() || item.authors[0]);
      if (item.authors.length > 1) parts[0] += ' 等';
    }
    if (item.year) parts.push(String(item.year));
    return parts.join(', ') || '';
  }, [item.authors, item.year]);

  return (
    <button
      onClick={onClick}
      disabled={!item.pdfPath}
      className={`w-full flex items-start gap-2 py-1.5 pr-2 rounded-lg transition-colors group text-left ${
        item.pdfPath
          ? 'hover:bg-[var(--color-hover)] cursor-pointer'
          : 'opacity-40 cursor-not-allowed'
      }`}
      style={{ paddingLeft: `${28 + depth * 14}px` }}
    >
      <FileText
        size={13}
        className="text-[var(--color-text-quaternary)] group-hover:text-[var(--color-primary)] shrink-0 mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-tight text-[var(--color-text)] line-clamp-2">
          {item.title}
        </p>
        {meta && (
          <p className="text-[10px] text-[var(--color-text-quaternary)] mt-0.5 truncate">
            {meta}
          </p>
        )}
      </div>
    </button>
  );
};
