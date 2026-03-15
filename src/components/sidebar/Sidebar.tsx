import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, FileText, Library, Menu, FolderOpen } from 'lucide-react';
import shibaLogoUrl from '../../assets/shiba/shiba-logo.png';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ZoteroList } from './ZoteroList';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { ipcClient } from '../../lib/ipc-client';
import type { DocumentSnapshot } from '../../shared/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type SidebarSection = 'recent' | 'zotero';

const formatLastOpenedAt = (timestamp: string) => (
  new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
);

const getFileName = (filePath: string) => filePath.split(/[/\\]/).at(-1) ?? filePath;

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
  const [activeSection, setActiveSection] = useState<SidebarSection>('recent');
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore((s) => s.setPdfUrl);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const recentDocuments = useDocumentStore((s) => s.recentDocuments);
  const setRecentDocuments = useDocumentStore((s) => s.setRecentDocuments);

  const openDocumentInViewer = useCallback((doc: DocumentSnapshot) => {
    setCurrentDocument(doc);
    setPdfUrl(convertFileSrc(doc.filePath));
    if (isMobile) {
      onToggle();
    }
  }, [isMobile, onToggle, setCurrentDocument, setPdfUrl]);

  const loadRecentDocuments = useCallback(async () => {
    try {
      setIsLoadingRecent(true);
      const docs = await ipcClient.listRecentDocuments(20);
      setRecentDocuments(docs);
    } catch (err) {
      console.error('加载近期文档失败:', err);
    } finally {
      setIsLoadingRecent(false);
    }
  }, [setRecentDocuments]);

  useEffect(() => {
    void loadRecentDocuments();
  }, [loadRecentDocuments]);

  useEffect(() => {
    if (!currentDocument) return;
    void loadRecentDocuments();
  }, [currentDocument?.documentId, currentDocument?.lastOpenedAt, loadRecentDocuments]);

  const handleOpenRecentDocument = useCallback(async (doc: DocumentSnapshot) => {
    try {
      const openedDocument = doc.sourceType === 'zotero' && doc.zoteroItemKey
        ? await ipcClient.openZoteroAttachment(doc.zoteroItemKey)
        : await ipcClient.openDocument({
            filePath: doc.filePath,
            sourceType: doc.sourceType,
            zoteroItemKey: doc.zoteroItemKey,
          });
      openDocumentInViewer(openedDocument);
      await loadRecentDocuments();
    } catch (err) {
      console.error('重新打开近期文档失败:', err);
    }
  }, [loadRecentDocuments, openDocumentInViewer]);

  // 处理本地文件选择（使用 Tauri 原生对话框获取绝对路径）
  const handleOpenLocalPdf = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!selected) return; // 用户取消

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
          initial={{ width: 0, opacity: 0, x: isMobile ? -260 : 0 }}
          animate={{ width: 260, opacity: 1, x: 0 }}
          exit={{ width: 0, opacity: 0, x: isMobile ? -260 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className={`h-full border-r border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-xl overflow-hidden flex flex-col pt-8 ${isMobile ? 'absolute left-0 top-0 bottom-0 z-30' : 'relative'}`}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 pb-4 border-b border-[var(--color-separator)] shrink-0">
            <span className="font-semibold px-2 text-[var(--color-text)] flex items-center gap-2">
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

          {/* 导航列表 */}
          <div className="py-2 px-3 space-y-1 shrink-0">
            <NavItem
              icon={<FileText size={18} />}
              label="近期文档"
              active={activeSection === 'recent'}
              onClick={() => setActiveSection('recent')}
            />
            <NavItem
              icon={<Library size={18} />}
              label="Zotero"
              active={activeSection === 'zotero'}
              onClick={() => setActiveSection('zotero')}
            />
          </div>

          {/* 内容区域 — 根据 activeSection 切换 */}
          <div className="flex-1 overflow-hidden border-t border-[var(--color-separator)]">
            {activeSection === 'recent' && (
              <div className="flex flex-col h-full p-3 gap-3">
                <div className="shrink-0">
                  <button
                    onClick={handleOpenLocalPdf}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium shadow-sm hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    <FolderOpen size={16} />
                    打开本地 PDF
                  </button>
                  <span className="block mt-2 text-xs text-[var(--color-text-quaternary)] text-center">
                    或拖拽 PDF 文件到窗口打开
                  </span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {isLoadingRecent ? (
                    <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-quaternary)]">
                      正在加载近期文档...
                    </div>
                  ) : recentDocuments.length === 0 ? (
                    <div className="flex items-center justify-center h-full px-4 text-center text-xs text-[var(--color-text-quaternary)] leading-relaxed">
                      还没有最近打开的文档
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {recentDocuments.map((doc) => {
                        const isActive = currentDocument?.documentId === doc.documentId;
                        return (
                          <button
                            key={doc.documentId}
                            onClick={() => void handleOpenRecentDocument(doc)}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? 'border-[var(--color-primary)] bg-[var(--color-selected)]'
                                : 'border-[var(--color-border)] hover:bg-[var(--color-hover)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="truncate text-sm font-medium text-[var(--color-text)]">
                                {doc.title}
                              </span>
                              <span className="shrink-0 rounded-full bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-quaternary)]">
                                {doc.sourceType === 'zotero' ? 'Zotero' : '本地'}
                              </span>
                            </div>
                            <p className="truncate text-[11px] text-[var(--color-text-tertiary)]">
                              {getFileName(doc.filePath)}
                            </p>
                            <p className="mt-1 text-[10px] text-[var(--color-text-quaternary)]">
                              最近打开 {formatLastOpenedAt(doc.lastOpenedAt)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeSection === 'zotero' && (
              <ZoteroList />
            )}
          </div>

          {/* 底部设置 */}
          <div className="p-4 border-t border-[var(--color-separator)] shrink-0">
            <NavItem
              icon={<Settings size={18} />}
              label="设置"
              onClick={onOpenSettings}
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

const NavItem = ({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex flex-shrink-0 whitespace-nowrap items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
      active
        ? 'bg-[var(--color-selected)] text-[var(--color-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
