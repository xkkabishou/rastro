import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Menu, FolderOpen, Search } from 'lucide-react';
import shibaLogoUrl from '../../assets/shiba/shiba-logo.png';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DocumentTree } from './DocumentTree';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { ipcClient } from '../../lib/ipc-client';
import type { DocumentSnapshot, DocumentArtifactDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 搜索防抖延迟 (ms) */
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarProps {
  isOpen: boolean;
  isMobile?: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export const Sidebar = ({ isOpen, isMobile = false, onToggle, onOpenSettings }: SidebarProps) => {
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore((s) => s.setPdfUrl);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const recentDocuments = useDocumentStore((s) => s.recentDocuments);
  const setRecentDocuments = useDocumentStore((s) => s.setRecentDocuments);
  const searchQuery = useDocumentStore((s) => s.searchQuery);
  const setSearchQuery = useDocumentStore((s) => s.setSearchQuery);
  const activeFilter = useDocumentStore((s) => s.activeFilter);

  // 搜索防抖
  const [localQuery, setLocalQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQuery, setSearchQuery]);

  // 打开文档到阅读器
  const openDocumentInViewer = useCallback((doc: DocumentSnapshot) => {
    setCurrentDocument(doc);
    setPdfUrl(convertFileSrc(doc.filePath));
    if (isMobile) {
      onToggle();
    }
  }, [isMobile, onToggle, setCurrentDocument, setPdfUrl]);

  // 加载文档列表（v2: 支持搜索和筛选）
  const loadRecentDocuments = useCallback(async () => {
    try {
      setIsLoadingRecent(true);
      const docs = await ipcClient.listRecentDocuments(
        50,
        searchQuery || undefined,
        Object.keys(activeFilter).length > 0 ? activeFilter : undefined,
      );
      setRecentDocuments(docs);
    } catch (err) {
      console.error('加载文档列表失败:', err);
    } finally {
      setIsLoadingRecent(false);
    }
  }, [setRecentDocuments, searchQuery, activeFilter]);

  // 初始加载 + 搜索/筛选变化时重新加载
  useEffect(() => {
    void loadRecentDocuments();
  }, [loadRecentDocuments]);

  // 文档切换时刷新列表
  useEffect(() => {
    if (!currentDocument) return;
    void loadRecentDocuments();
  }, [currentDocument?.documentId, currentDocument?.lastOpenedAt, loadRecentDocuments]);

  // 点击文档节点
  const handleDocumentClick = useCallback(async (doc: DocumentSnapshot) => {
    try {
      const openedDocument = doc.sourceType === 'zotero' && doc.zoteroItemKey
        ? await ipcClient.openZoteroAttachment(doc.zoteroItemKey)
        : await ipcClient.openDocument({
            filePath: doc.filePath,
            sourceType: doc.sourceType,
            zoteroItemKey: doc.zoteroItemKey,
          });
      openDocumentInViewer(openedDocument);
    } catch (err) {
      console.error('打开文档失败:', err);
    }
  }, [openDocumentInViewer]);

  // 点击产物节点
  const handleArtifactClick = useCallback((artifact: DocumentArtifactDto, doc: DocumentSnapshot) => {
    switch (artifact.kind) {
      case 'original_pdf':
        openDocumentInViewer(doc);
        break;
      case 'translated_pdf':
      case 'bilingual_pdf':
        if (artifact.filePath) {
          setCurrentDocument(doc);
          setPdfUrl(convertFileSrc(artifact.filePath));
          if (isMobile) onToggle();
        }
        break;
      case 'ai_summary':
        // TODO: Wave 4+ — 打开 AI 总结面板
        openDocumentInViewer(doc);
        break;
      default:
        // NotebookLM 产物或其他产物 — 在 Finder 中打开
        if (artifact.filePath) {
          ipcClient.revealInFinder(artifact.filePath).catch((err) => {
            console.error('打开产物失败:', err);
          });
        }
        break;
    }
  }, [openDocumentInViewer, setCurrentDocument, setPdfUrl, isMobile, onToggle]);

  // 处理本地文件选择
  const handleOpenLocalPdf = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!selected) return;

    try {
      const doc = await ipcClient.openDocument({ filePath: selected });
      openDocumentInViewer(doc);
      await loadRecentDocuments();
    } catch (err) {
      console.error('打开本地文档失败:', err);
    }
  };

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0, x: isMobile ? -280 : 0 }}
          animate={{ width: 280, opacity: 1, x: 0 }}
          exit={{ width: 0, opacity: 0, x: isMobile ? -280 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className={`h-full border-r border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-xl overflow-hidden flex flex-col pt-8 ${isMobile ? 'absolute left-0 top-0 bottom-0 z-30' : 'relative'}`}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 pb-3 shrink-0">
            <span className="font-semibold px-1 text-[var(--color-text)] flex items-center gap-2">
              <img src={shibaLogoUrl} alt="Rastro" className="w-6 h-6 rounded-md" />
              Rastro
            </span>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            >
              <Menu size={18} />
            </button>
          </div>

          {/* 搜索栏 */}
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
                className="input-base w-full pl-8 pr-3 py-1.5 text-xs rounded-lg"
              />
            </div>
          </div>

          {/* 打开文件按钮 */}
          <div className="px-3 pb-2 shrink-0">
            <button
              onClick={handleOpenLocalPdf}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-primary)] text-white text-xs font-medium shadow-sm hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <FolderOpen size={14} />
              打开本地 PDF
            </button>
          </div>

          {/* 文档树 */}
          <div className="flex-1 overflow-hidden border-t border-[var(--color-separator)] px-2 pt-1">
            {isLoadingRecent ? (
              <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-quaternary)]">
                加载中...
              </div>
            ) : (
              <DocumentTree
                documents={recentDocuments}
                activeDocumentId={currentDocument?.documentId}
                onDocumentClick={handleDocumentClick}
                onArtifactClick={handleArtifactClick}
                emptyMessage={searchQuery ? '未找到匹配的文献' : '还没有最近打开的文档'}
              />
            )}
          </div>

          {/* 底部设置 */}
          <div className="p-3 border-t border-[var(--color-separator)] shrink-0">
            <button
              onClick={onOpenSettings}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] transition-colors"
            >
              <Settings size={18} />
              <span>设置</span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

