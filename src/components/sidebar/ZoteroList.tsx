import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, BookOpen, Loader2, AlertCircle,
  RefreshCw, ChevronRight, FolderOpen, Folder, FolderMinus,
  Library, Hash,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';
import type { ZoteroItemDto, ZoteroStatusDto, ZoteroCollectionDto, PagedZoteroItemsDto } from '../../shared/types';

/* ======================================================================== */
/* 常量                                                                     */
/* ======================================================================== */

const INITIAL_LOAD = 20;
const LOAD_MORE_SIZE = 30;

/* ======================================================================== */
/* 辅助类型                                                                 */
/* ======================================================================== */

interface CollectionTreeNode {
  collection: ZoteroCollectionDto;
  children: CollectionTreeNode[];
}

interface ExpandedData {
  items: ZoteroItemDto[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
}

/* ======================================================================== */
/* 辅助函数                                                                 */
/* ======================================================================== */

function buildTree(list: ZoteroCollectionDto[]): CollectionTreeNode[] {
  const map = new Map<number, CollectionTreeNode>();
  const roots: CollectionTreeNode[] = [];
  for (const c of list) map.set(c.collectionId, { collection: c, children: [] });
  for (const c of list) {
    const n = map.get(c.collectionId)!;
    if (c.parentCollectionId != null) {
      const p = map.get(c.parentCollectionId);
      if (p) { p.children.push(n); continue; }
    }
    roots.push(n);
  }
  return roots;
}

/* 柔和的文件夹色板 */
const FOLDER_COLORS = [
  { bg: '#FFF3E0', icon: '#F57C00', bar: '#FFB74D' },
  { bg: '#E8F5E9', icon: '#388E3C', bar: '#81C784' },
  { bg: '#E3F2FD', icon: '#1976D2', bar: '#64B5F6' },
  { bg: '#F3E5F5', icon: '#7B1FA2', bar: '#BA68C8' },
  { bg: '#FFF8E1', icon: '#F9A825', bar: '#FFD54F' },
  { bg: '#E0F7FA', icon: '#00838F', bar: '#4DD0E1' },
  { bg: '#FCE4EC', icon: '#C62828', bar: '#EF9A9A' },
  { bg: '#EFEBE9', icon: '#4E342E', bar: '#A1887F' },
];

/* ======================================================================== */
/* ZoteroList                                                                */
/* ======================================================================== */

export const ZoteroList: React.FC = () => {
  const [status, setStatus] = useState<ZoteroStatusDto | null>(null);
  const [collections, setCollections] = useState<CollectionTreeNode[]>([]);
  const [uncatCount, setUncatCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Map<string, ExpandedData>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const setCurrentDocument = useDocumentStore(s => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore(s => s.setPdfUrl);

  const detect = useCallback(async () => {
    try { setLoading(true); setError(null); const s = await ipcClient.detectZoteroLibrary(); setStatus(s); return s.detected; }
    catch { setStatus({ detected: false, statusMessage: '无法连接' }); setError('探测失败'); return false; }
    finally { setLoading(false); }
  }, []);

  const loadCols = useCallback(async () => {
    try {
      const raw = await ipcClient.fetchZoteroCollections();
      setCollections(buildTree(raw));
      const uc = await ipcClient.fetchZoteroCollectionItems({ collectionId: null, offset: 0, limit: 1 });
      setUncatCount(uc.total);
    } catch { setError('加载文件夹失败'); }
  }, []);

  useEffect(() => { (async () => { if (await detect()) await loadCols(); })(); }, [detect, loadCols]);

  const loadItems = useCallback(async (cid: number | null, offset = 0) => {
    const k = cid === null ? '_uc' : String(cid);
    setCache(p => { const m = new Map(p); const e = m.get(k); m.set(k, { items: e?.items ?? [], total: e?.total ?? 0, isLoading: offset === 0, isLoadingMore: offset > 0 }); return m; });
    try {
      const r: PagedZoteroItemsDto = await ipcClient.fetchZoteroCollectionItems({ collectionId: cid, offset, limit: offset === 0 ? INITIAL_LOAD : LOAD_MORE_SIZE });
      setCache(p => { const m = new Map(p); const e = m.get(k); m.set(k, { items: offset === 0 ? r.items : [...(e?.items ?? []), ...r.items], total: r.total, isLoading: false, isLoadingMore: false }); return m; });
    } catch {
      setCache(p => { const m = new Map(p); const e = m.get(k); m.set(k, { items: e?.items ?? [], total: e?.total ?? 0, isLoading: false, isLoadingMore: false }); return m; });
    }
  }, []);

  const toggle = useCallback((cid: number | null) => {
    const k = cid === null ? '_uc' : String(cid);
    setExpandedIds(p => { const s = new Set(p); if (s.has(k)) s.delete(k); else { s.add(k); if (!cache.has(k)) loadItems(cid, 0); } return s; });
  }, [cache, loadItems]);

  const openItem = useCallback(async (item: ZoteroItemDto) => {
    if (!item.pdfPath) return;
    try { const doc = await ipcClient.openZoteroAttachment(item.itemKey); setCurrentDocument(doc); setPdfUrl(convertFileSrc(doc.filePath)); }
    catch (e) { console.error('打开附件失败:', e); }
  }, [setCurrentDocument, setPdfUrl]);

  const refresh = useCallback(async () => {
    setRefreshing(true); setCache(new Map()); setExpandedIds(new Set());
    await detect(); await loadCols(); setRefreshing(false);
  }, [detect, loadCols]);

  const totalItems = status?.itemCount ?? 0;
  const colCount = collections.length + (uncatCount > 0 ? 1 : 0);

  /* --- 未检测到 --- */
  if (!loading && status && !status.detected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={22} color="var(--color-text-quaternary)" />
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>未检测到 Zotero</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-quaternary)', margin: 0 }}>{status.statusMessage || '请确认已安装并运行过一次'}</p>
        </div>
        <button
          onClick={detect}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--color-primary)', background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)', border: 'none', cursor: 'pointer' }}
        >
          <RefreshCw size={13} /> 重新检测
        </button>
      </div>
    );
  }

  /* --- 正常 --- */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ====== 统计头部卡片 ====== */}
      <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 6%, transparent), color-mix(in srgb, var(--color-primary) 12%, transparent))',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Library size={18} color="var(--color-primary)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
              {totalItems}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              篇文献 · {colCount} 个文件夹
            </div>
          </div>
          <button
            onClick={refresh} disabled={refreshing}
            style={{
              width: 28, height: 28, borderRadius: 8, border: 'none',
              background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <RefreshCw size={13} color="var(--color-primary)" className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ====== 分隔标签 ====== */}
      <div style={{ padding: '4px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Hash size={11} color="var(--color-text-quaternary)" />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-quaternary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          文件夹
        </span>
      </div>

      {/* ====== 树形列表 ====== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {loading ? (
          /* 骨架屏 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderRadius: 8, background: 'var(--color-bg-tertiary)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8 }} className="animate-pulse" />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 12, width: 60 + i * 15, borderRadius: 4, background: 'var(--color-border)' }} className="animate-pulse" />
                  <div style={{ height: 8, width: 30, borderRadius: 4, background: 'var(--color-border)', marginTop: 6 }} className="animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {collections.map((n, i) => (
              <FolderNode key={n.collection.collectionId} node={n} depth={0} colorIdx={i}
                expandedIds={expandedIds} cache={cache}
                onToggle={toggle} onLoadMore={loadItems} onOpen={openItem} />
            ))}
            {uncatCount > 0 && (
              <FolderNode node={null} uncatCount={uncatCount} depth={0} colorIdx={collections.length}
                expandedIds={expandedIds} cache={cache}
                onToggle={toggle} onLoadMore={loadItems} onOpen={openItem} />
            )}
          </div>
        )}
      </div>

      {/* 错误 */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ padding: '6px 14px', flexShrink: 0, borderTop: '1px solid var(--color-border)', overflow: 'hidden' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-destructive)' }}>
              <AlertCircle size={13} />{error}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ======================================================================== */
/* FolderNode                                                                */
/* ======================================================================== */

interface FolderNodeProps {
  node: CollectionTreeNode | null;
  uncatCount?: number;
  depth: number;
  colorIdx: number;
  expandedIds: Set<string>;
  cache: Map<string, ExpandedData>;
  onToggle: (id: number | null) => void;
  onLoadMore: (id: number | null, offset: number) => void;
  onOpen: (item: ZoteroItemDto) => void;
}

const FolderNode: React.FC<FolderNodeProps> = ({
  node, uncatCount, depth, colorIdx, expandedIds, cache, onToggle, onLoadMore, onOpen,
}) => {
  const isUncat = node === null;
  const cid = isUncat ? null : node.collection.collectionId;
  const key = isUncat ? '_uc' : String(cid);
  const name = isUncat ? '未分类' : node.collection.name;
  const count = isUncat ? (uncatCount ?? 0) : node.collection.itemCount;
  const hasKids = !isUncat && node.children.length > 0;
  const open = expandedIds.has(key);
  const d = cache.get(key);
  const loaded = d?.items.length ?? 0;
  const total = d?.total ?? count;
  const hasMore = loaded < total;

  const color = FOLDER_COLORS[colorIdx % FOLDER_COLORS.length];
  const pl = depth * 16;
  const isRoot = depth === 0;

  return (
    <div style={{ marginLeft: pl }}>
      {/* 文件夹行 */}
      <button
        onClick={() => onToggle(cid)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%',
          padding: isRoot ? '8px 10px' : '6px 10px',
          borderRadius: 10,
          border: 'none',
          background: open ? color.bg : 'transparent',
          cursor: 'pointer',
          transition: 'background 150ms, transform 100ms',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? color.bg : 'transparent'; }}
      >
        {/* 彩色图标容器 */}
        <div style={{
          width: isRoot ? 32 : 26,
          height: isRoot ? 32 : 26,
          borderRadius: isRoot ? 8 : 6,
          background: open ? color.icon : 'var(--color-bg-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 200ms, transform 150ms',
          flexShrink: 0,
          transform: open ? 'scale(1.02)' : 'scale(1)',
        }}>
          {isUncat
            ? <FolderMinus size={isRoot ? 16 : 13} color={open ? '#fff' : 'var(--color-text-quaternary)'} />
            : open
              ? <FolderOpen size={isRoot ? 16 : 13} color="#fff" />
              : <Folder size={isRoot ? 16 : 13} color="var(--color-text-quaternary)" />
          }
        </div>

        {/* 名称 + 计数 */}
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div style={{
            fontSize: isRoot ? 13 : 12,
            fontWeight: open ? 600 : 500,
            color: open ? color.icon : 'var(--color-text)',
            lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            transition: 'color 150ms',
          }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-quaternary)', lineHeight: 1.2, marginTop: 1 }}>
            {count} 篇
          </div>
        </div>

        {/* 箭头 */}
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, flexShrink: 0,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          <ChevronRight size={14} color={open ? color.icon : 'var(--color-text-quaternary)'} />
        </span>
      </button>

      {/* 展开区域 */}
      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 250ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ paddingLeft: isRoot ? 12 : 8, paddingTop: 2, paddingBottom: open ? 4 : 0 }}>
            {/* 子文件夹 */}
            {hasKids && node.children.map((c, i) => (
              <FolderNode key={c.collection.collectionId} node={c} depth={depth + 1} colorIdx={colorIdx}
                expandedIds={expandedIds} cache={cache}
                onToggle={onToggle} onLoadMore={onLoadMore} onOpen={onOpen} />
            ))}

            {/* 骨架 */}
            {d?.isLoading && [...Array(Math.min(count, 4))].map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--color-bg-tertiary)' }} className="animate-pulse" />
                <div style={{ height: 10, borderRadius: 3, background: 'var(--color-bg-tertiary)', flex: 1, maxWidth: 140 + i * 20 }} className="animate-pulse" />
              </div>
            ))}

            {/* 文献列表 */}
            {!d?.isLoading && d?.items.map(item => (
              <ItemRow key={item.itemKey} item={item} accentColor={color.icon} onClick={() => onOpen(item)} />
            ))}

            {/* 加载更多 */}
            {hasMore && loaded > 0 && !d?.isLoading && (
              <button
                onClick={e => { e.stopPropagation(); onLoadMore(cid, loaded); }}
                disabled={d?.isLoadingMore}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  width: '100%', padding: '6px 8px',
                  fontSize: 12, fontWeight: 500, color: color.icon,
                  background: 'transparent', border: `1px dashed ${color.bar}`,
                  borderRadius: 6, cursor: 'pointer',
                  marginTop: 4,
                }}
              >
                {d?.isLoadingMore
                  ? <><Loader2 size={12} className="animate-spin" />加载中...</>
                  : `加载更多 (${loaded}/${total})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ======================================================================== */
/* ItemRow                                                                   */
/* ======================================================================== */

const ItemRow: React.FC<{ item: ZoteroItemDto; accentColor: string; onClick: () => void }> = ({ item, accentColor, onClick }) => {
  const sub = useMemo(() => {
    const p: string[] = [];
    if (item.authors?.length) {
      const a = item.authors[0].split(' ').pop() || item.authors[0];
      p.push(item.authors.length > 1 ? `${a} 等` : a);
    }
    if (item.year) p.push(String(item.year));
    return p.join(' · ');
  }, [item.authors, item.year]);

  return (
    <button
      onClick={onClick}
      disabled={!item.pdfPath}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        width: '100%', padding: '6px 8px',
        borderRadius: 6, border: 'none',
        background: 'transparent', cursor: item.pdfPath ? 'pointer' : 'not-allowed',
        opacity: item.pdfPath ? 1 : 0.35,
        textAlign: 'left',
        transition: 'background 100ms',
      }}
      onMouseEnter={e => { if (item.pdfPath) e.currentTarget.style.background = 'var(--color-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <FileText size={14} color={accentColor} style={{ flexShrink: 0, marginTop: 1, opacity: 0.7 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 12, lineHeight: 1.35,
          color: 'var(--color-text)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {item.title}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: 'var(--color-text-quaternary)', marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
    </button>
  );
};
