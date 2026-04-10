import React, { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Menu, FolderOpen, AlertTriangle, BookOpen, FileText } from 'lucide-react';
import shibaLogoUrl from '../../assets/shiba/shiba-logo.png';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { DocumentTree } from './DocumentTree';
import type { FlatNode } from './DocumentTree';
import type { ContextMenuAction } from './DocumentContextMenu';
import { SearchBar } from './SearchBar';
import { GroupChips } from './GroupChips';
import { Dialog } from '../ui/Dialog';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useSummaryStore } from '../../stores/useSummaryStore';
import { ipcClient } from '../../lib/ipc-client';
import { extractPdfText, DEFAULT_SUMMARY_SOURCE_PAGES, DEFAULT_SUMMARY_SOURCE_CHARS } from '../../lib/pdf-text-extractor';
import type { DocumentSnapshot, DocumentArtifactDto } from '../../shared/types';
import { ZoteroList } from './ZoteroList';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarProps {
  isOpen: boolean;
  isMobile?: boolean;
  onToggle: () => void;
  /** 外部控制宽度（桌面端拖拽调整） */
  width?: number;
  /** 拖拽中禁用 spring 动画 */
  isResizing?: boolean;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export const Sidebar = ({ isOpen, isMobile = false, onToggle, width, isResizing }: SidebarProps) => {
  // 桌面端使用外部传入宽度，移动端固定 280px
  const effectiveWidth = isMobile ? 280 : (width ?? 280);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [activeTab, setActiveTab] = useState<'documents' | 'zotero'>('zotero');

  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setPdfUrl = useDocumentStore((s) => s.setPdfUrl);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const recentDocuments = useDocumentStore((s) => s.recentDocuments);
  const setRecentDocuments = useDocumentStore((s) => s.setRecentDocuments);
  const searchQuery = useDocumentStore((s) => s.searchQuery);
  // useShallow 做浅比较，避免 activeFilter 对象每次重置为 {} 时因引用变化触发不必要的 callback 重建
  const activeFilter = useDocumentStore(useShallow((s) => s.activeFilter));

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
          // 先设置翻译 URL 和模式，再切换文档视图
          // 避免 openDocumentInViewer → setCurrentDocument 在中间状态触发
          // activePdfUrl 重新计算导致白屏
          const translatedUrl = convertFileSrc(artifact.filePath);
          const store = useDocumentStore.getState();
          const isSameDoc = store.currentDocument?.documentId === doc.documentId;
          if (isSameDoc) {
            // 同文档：直接设置翻译 URL，无需重新加载文档
            store.setTranslatedPdfUrl(translatedUrl);
            store.setBilingualMode(false);
          } else {
            // 不同文档：先打开文档（会重置 translatedPdfUrl），再设置
            openDocumentInViewer(doc);
            // setCurrentDocument 对不同文档会重置 translatedPdfUrl=null，
            // 需要在同一微任务中重新设置
            useDocumentStore.getState().setTranslatedPdfUrl(translatedUrl);
            useDocumentStore.getState().setBilingualMode(false);
          }
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
  }, [openDocumentInViewer]);

  // -------------------------------------------------------------------------
  // T2.4.2: 确认弹窗状态
  // -------------------------------------------------------------------------
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    isLoading?: boolean;
  } | null>(null);

  const closeConfirmDialog = useCallback(() => setConfirmDialog(null), []);

  // -------------------------------------------------------------------------
  // T2.4.2 + T2.4.4 + T2.4.6: 右键菜单操作处理
  // -------------------------------------------------------------------------
  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction, node: FlatNode, doc: DocumentSnapshot) => {
      const docId = doc.documentId;

      switch (action) {
        // ===== 一级节点 — 文献操作 =====

        case 'translate': {
          // T2.4.2: 触发翻译（复用 PdfViewer.handleTranslate 模式）
          // 已有翻译时菜单显示"重新翻译全文"，需要 forceRefresh
          const hasExistingTranslation = doc.cachedTranslation?.available ?? false;
          void (async () => {
            try {
              openDocumentInViewer(doc);
              // 显式重置翻译状态，准备开始新翻译
              useDocumentStore.getState().setTranslatedPdfUrl(null);
              useDocumentStore.getState().setTranslationProgress(0);
              const job = await ipcClient.requestTranslation({
                documentId: docId,
                filePath: doc.filePath,
                forceRefresh: hasExistingTranslation,
              });
              useDocumentStore.getState().setTranslationJob(job);
            } catch (err) {
              console.error('右键触发翻译失败:', err);
            }
          })();
          break;
        }

        case 'generate_summary': {
          // T2.4.2: 触发生成总结（复用 SummaryPanel.handleGenerate 模式）
          void (async () => {
            try {
              openDocumentInViewer(doc);
              const store = useSummaryStore.getState();
              store.resetSummary();
              useSummaryStore.setState({ currentDocumentId: docId });
              store.startGeneration();

              const { text: sourceText } = await extractPdfText(doc.filePath, {
                maxPages: DEFAULT_SUMMARY_SOURCE_PAGES,
                maxChars: DEFAULT_SUMMARY_SOURCE_CHARS,
              });

              if (!sourceText.trim()) {
                useSummaryStore.getState().failStream(
                  null,
                  `未能从 PDF 前 ${DEFAULT_SUMMARY_SOURCE_PAGES} 页提取到可用文本。`,
                );
                return;
              }

              const handle = await ipcClient.generateSummary({
                documentId: docId,
                filePath: doc.filePath,
                sourceText,
                promptProfile: 'default',
              });
              useSummaryStore.getState().setActiveStreamId(handle.streamId);
            } catch (err) {
              console.error('右键触发生成总结失败:', err);
              useSummaryStore.getState().failStream(
                null,
                err && typeof err === 'object' && 'message' in err
                  ? String((err as { message: string }).message)
                  : '生成总结失败，请检查 API 配置。',
              );
            }
          })();
          break;
        }

        case 'reveal_in_finder': {
          // T2.4.2: 在 Finder 中显示
          const filePath = node.type === 'artifact' && node.artifact?.filePath
            ? node.artifact.filePath
            : doc.filePath;
          ipcClient.revealInFinder(filePath).catch((err) => {
            console.error('在 Finder 中显示失败:', err);
          });
          break;
        }

        case 'remove_from_history': {
          // T2.4.2: 从历史移除（二次确认）
          setConfirmDialog({
            title: '从历史中移除',
            message: `确定要将「${doc.title || '未命名文档'}」从历史记录中移除吗？文件不会被删除。`,
            onConfirm: async () => {
              try {
                await ipcClient.removeRecentDocument(docId);
                await loadRecentDocuments();
              } catch (err) {
                console.error('移除文档失败:', err);
              } finally {
                setConfirmDialog(null);
              }
            },
          });
          break;
        }

        case 'toggle_favorite': {
          // T2.4.2: 切换收藏
          void (async () => {
            try {
              await ipcClient.toggleDocumentFavorite(docId, !doc.isFavorite);
              await useDocumentStore.getState().refreshDocumentSnapshot(docId);
            } catch (err) {
              console.error('切换收藏失败:', err);
            }
          })();
          break;
        }

        // ===== 二级节点 — 翻译产物操作 (T2.4.4) =====

        case 'view_translation_detail': {
          // T2.4.4: 查看翻译详情 — 打开文档
          openDocumentInViewer(doc);
          break;
        }

        case 'retranslate': {
          // T2.4.4: 重新翻译（forceRefresh）
          void (async () => {
            try {
              openDocumentInViewer(doc);
              // 显式重置翻译状态，准备开始重新翻译
              useDocumentStore.getState().setTranslatedPdfUrl(null);
              useDocumentStore.getState().setTranslationProgress(0);
              const job = await ipcClient.requestTranslation({
                documentId: docId,
                filePath: doc.filePath,
                forceRefresh: true,
              });
              useDocumentStore.getState().setTranslationJob(job);
            } catch (err) {
              console.error('重新翻译失败:', err);
            }
          })();
          break;
        }

        case 'delete_translation': {
          // T2.4.4: 删除翻译（二次确认）
          setConfirmDialog({
            title: '确认删除翻译',
            message: '确定要删除此文档的翻译缓存吗？翻译后的 PDF 文件将被删除，需要时可以重新翻译。',
            onConfirm: async () => {
              try {
                console.log('[删除翻译] docId =', docId, 'doc.title =', doc.title);
                const result = await ipcClient.deleteTranslationCache(docId);
                console.log('[删除翻译] result =', result);
                // 清除产物缓存并刷新
                useDocumentStore.getState().invalidateArtifacts(docId);
                await useDocumentStore.getState().loadArtifacts(docId, true);
                await useDocumentStore.getState().refreshDocumentSnapshot(docId);
                // 刷新文档列表
                await loadRecentDocuments();
                // 如果当前显示的是该文档的翻译 PDF，回退到原文
                const current = useDocumentStore.getState().currentDocument;
                if (current?.documentId === docId) {
                  useDocumentStore.getState().setTranslatedPdfUrl(null);
                  useDocumentStore.getState().setTranslationJob(null);
                }
                if (!result.deleted) {
                  console.warn('[删除翻译] 未找到可删除的翻译缓存');
                }
              } catch (err) {
                console.error('删除翻译缓存失败:', err);
                const msg = err && typeof err === 'object' && 'message' in err
                  ? String((err as { message: string }).message)
                  : '删除翻译缓存时发生错误';
                alert(msg);
              } finally {
                setConfirmDialog(null);
              }
            },
          });
          break;
        }

        // ===== 二级节点 — AI 总结操作 (T2.4.6) =====

        case 'view_summary': {
          // T2.4.6: 查看总结 — 打开文档并加载已保存的总结
          openDocumentInViewer(doc);
          void useSummaryStore.getState().loadSavedSummary(docId);
          break;
        }

        case 'regenerate_summary': {
          // T2.4.6: 重新生成总结（确认框提示消耗 API 额度）
          setConfirmDialog({
            title: '重新生成总结',
            message: '重新生成将消耗 API 额度，旧的总结将被替换。确定要继续吗？',
            onConfirm: async () => {
              try {
                // 删除旧总结
                await ipcClient.deleteDocumentSummary(docId);
                setConfirmDialog(null);

                // 打开文档并触发生成
                openDocumentInViewer(doc);
                const store = useSummaryStore.getState();
                store.resetSummary();
                useSummaryStore.setState({ currentDocumentId: docId });
                store.startGeneration();

                const { text: sourceText } = await extractPdfText(doc.filePath, {
                  maxPages: DEFAULT_SUMMARY_SOURCE_PAGES,
                  maxChars: DEFAULT_SUMMARY_SOURCE_CHARS,
                });

                if (!sourceText.trim()) {
                  useSummaryStore.getState().failStream(
                    null,
                    `未能从 PDF 提取到可用文本。`,
                  );
                  return;
                }

                const handle = await ipcClient.generateSummary({
                  documentId: docId,
                  filePath: doc.filePath,
                  sourceText,
                  promptProfile: 'default',
                });
                useSummaryStore.getState().setActiveStreamId(handle.streamId);

                // 刷新文档快照更新 hasSummary 状态
                await useDocumentStore.getState().refreshDocumentSnapshot(docId);
              } catch (err) {
                console.error('重新生成总结失败:', err);
                useSummaryStore.getState().failStream(
                  null,
                  err && typeof err === 'object' && 'message' in err
                    ? String((err as { message: string }).message)
                    : '重新生成总结失败。',
                );
                setConfirmDialog(null);
              }
            },
          });
          break;
        }

        case 'export_summary_md': {
          // T2.4.6: 导出总结为 Markdown 文件
          void (async () => {
            try {
              // 先获取总结内容
              const summary = await ipcClient.getDocumentSummary(docId);
              if (!summary?.contentMd?.trim()) {
                console.warn('没有可导出的总结内容');
                return;
              }

              // 弹出保存对话框
              const fileName = `${(doc.title || 'summary').replace(/[/\\:*?"<>|]/g, '_')}_summary.md`;
              const filePath = await save({
                defaultPath: fileName,
                filters: [{ name: 'Markdown', extensions: ['md'] }],
              });
              if (!filePath) return;

              // 使用 Tauri writeFile 写入
              await invoke('plugin:fs|write_text_file', {
                path: filePath,
                contents: summary.contentMd,
              });
              console.log('[Summary] 导出成功:', filePath);
            } catch (err) {
              console.error('导出总结失败:', err);
            }
          })();
          break;
        }

        default: {
          // 其他操作暂未实现（NotebookLM 相关）
          console.log('[ContextMenu] 未实现的操作:', action, node.type, docId);
          break;
        }
      }
    },
    [openDocumentInViewer, loadRecentDocuments],
  );

  const handleZoteroDocumentRegistered = useCallback(async (_doc: DocumentSnapshot) => {
    await loadRecentDocuments();
  }, [loadRecentDocuments]);

  const handleZoteroContextMenuAction = useCallback(
    (action: ContextMenuAction, doc: DocumentSnapshot) => {
      void loadRecentDocuments();
      const node: FlatNode = {
        type: 'document',
        doc,
        expanded: false,
        artifactCount: doc.artifactCount,
      };
      handleContextMenuAction(action, node, doc);
    },
    [handleContextMenuAction, loadRecentDocuments],
  );

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

  // 动画期间禁用 backdrop-blur（直接操作 DOM 避免 setState 触发重渲染）
  const sidebarRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const onStart = () => { el.style.backdropFilter = 'none'; (el.style as unknown as Record<string, string>).webkitBackdropFilter = 'none'; };
    const onEnd = () => { el.style.backdropFilter = ''; (el.style as unknown as Record<string, string>).webkitBackdropFilter = ''; };
    el.addEventListener('transitionstart', onStart);
    el.addEventListener('transitionend', onEnd);
    el.addEventListener('transitioncancel', onEnd);
    return () => {
      el.removeEventListener('transitionstart', onStart);
      el.removeEventListener('transitionend', onEnd);
      el.removeEventListener('transitioncancel', onEnd);
    };
  }, []);

  return (
    <>
      <aside
        ref={sidebarRef}
        style={{
          width: isOpen ? effectiveWidth : 0,
          transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'width',
        }}
        className={`h-full border-r border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-xl overflow-hidden flex flex-col pt-8 ${isMobile ? 'absolute left-0 top-0 bottom-0 z-30' : 'relative'}`}
      >
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 pb-3 shrink-0">
              <span className="font-semibold px-1 text-[var(--color-text)] flex items-center gap-2">
                <img src={shibaLogoUrl} alt="Rastro" className="w-10 h-10 rounded-md" />
                Rastro
              </span>
              <button
                onClick={onToggle}
                className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
              >
                <Menu size={18} />
              </button>
            </div>

            {/* Tab 切换：Zotero / 文档 */}
            <div className="px-3 pb-2 shrink-0">
              <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--color-bg-tertiary)]">
                <button
                  onClick={() => setActiveTab('zotero')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                    activeTab === 'zotero'
                      ? 'bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm'
                      : 'text-[var(--color-text-quaternary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <BookOpen size={12} />
                  Zotero
                </button>
                <button
                  onClick={() => setActiveTab('documents')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                    activeTab === 'documents'
                      ? 'bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm'
                      : 'text-[var(--color-text-quaternary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <FileText size={12} />
                  文档
                </button>
              </div>
            </div>

            {/* 文档 Tab 内容 */}
            {activeTab === 'documents' && (
              <>
                {/* 搜索栏 + 分组筛选 */}
                <SearchBar />
                <GroupChips />

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
                      onContextMenuAction={handleContextMenuAction}
                      emptyMessage={searchQuery ? '未找到匹配的文献' : '还没有最近打开的文档'}
                    />
                  )}
                </div>
              </>
            )}

            {/* Zotero Tab 内容 */}
            {activeTab === 'zotero' && (
              <div className="flex-1 overflow-hidden border-t border-[var(--color-separator)]">
                <ZoteroList
                  onDocumentRegistered={handleZoteroDocumentRegistered}
                  onDocumentContextMenuAction={handleZoteroContextMenuAction}
                />
              </div>
            )}

      </aside>

      {/* T2.4.2: 通用确认弹窗（必须在 AnimatePresence 外部，否则干扰侧栏动画） */}
      <Dialog
        isOpen={!!confirmDialog}
        onClose={closeConfirmDialog}
        title={confirmDialog?.title ?? ''}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <p className="text-sm text-[var(--color-text)] leading-relaxed">
              {confirmDialog?.message}
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={closeConfirmDialog}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => { void confirmDialog?.onConfirm(); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5"
            >
              确认
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
