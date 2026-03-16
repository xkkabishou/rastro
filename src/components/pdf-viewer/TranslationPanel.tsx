import React, { useCallback, useState } from 'react';
import { Languages, RefreshCw, Trash2, Clock, Server, FileText, AlertTriangle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TranslationPanelProps {
  /** 文档 ID */
  documentId: string;
  /** 缓存的翻译信息 */
  translationInfo?: {
    available: boolean;
    provider?: string;
    model?: string;
    translatedPdfPath?: string;
    bilingualPdfPath?: string;
    updatedAt?: string;
  };
  /** 关闭面板回调 */
  onClose: () => void;
  /** 重新翻译回调（触发翻译流程） */
  onRetranslate?: () => void;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 格式化时间 */
function formatDate(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

// ---------------------------------------------------------------------------
// TranslationPanel 主组件
// ---------------------------------------------------------------------------

/**
 * 翻译管理面板
 * T2.4.3 [REQ-012]
 *
 * 显示翻译详情信息，并提供重新翻译和删除翻译操作。
 */
export const TranslationPanel: React.FC<TranslationPanelProps> = ({
  documentId,
  translationInfo,
  onClose,
  onRetranslate,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const invalidateArtifacts = useDocumentStore((s) => s.invalidateArtifacts);
  const loadArtifacts = useDocumentStore((s) => s.loadArtifacts);

  // 删除翻译
  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await ipcClient.deleteTranslationCache(documentId);
      // 清除产物缓存并重新加载
      invalidateArtifacts(documentId);
      await loadArtifacts(documentId, true);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error('删除翻译失败:', err);
      setDeleteError(
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '删除翻译缓存失败，请重试。',
      );
    } finally {
      setIsDeleting(false);
    }
  }, [documentId, invalidateArtifacts, loadArtifacts, onClose]);

  // 重新翻译
  const handleRetranslate = useCallback(() => {
    onRetranslate?.();
    onClose();
  }, [onRetranslate, onClose]);

  const available = translationInfo?.available ?? false;

  return (
    <>
      {/* 主面板 */}
      <div className="flex flex-col gap-4">
        {/* 信息卡片 */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Languages size={16} className="text-[var(--color-accent)]" />
            <span className="text-sm font-semibold text-[var(--color-text)]">翻译详情</span>
          </div>

          {available ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              {/* Provider */}
              {translationInfo?.provider && (
                <>
                  <span className="text-[var(--color-text-tertiary)] flex items-center gap-1">
                    <Server size={12} /> 服务商
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {translationInfo.provider}
                  </span>
                </>
              )}

              {/* Model */}
              {translationInfo?.model && (
                <>
                  <span className="text-[var(--color-text-tertiary)] flex items-center gap-1">
                    <FileText size={12} /> 模型
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {translationInfo.model}
                  </span>
                </>
              )}

              {/* 翻译时间 */}
              {translationInfo?.updatedAt && (
                <>
                  <span className="text-[var(--color-text-tertiary)] flex items-center gap-1">
                    <Clock size={12} /> 翻译时间
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {formatDate(translationInfo.updatedAt)}
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-quaternary)]">
              当前文档尚未进行翻译。
            </p>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <button
            onClick={handleRetranslate}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
          >
            <RefreshCw size={12} />
            {available ? '重新翻译' : '开始翻译'}
          </button>

          {available && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} />
              删除
            </button>
          )}
        </div>
      </div>

      {/* 删除确认对话框 */}
      <Dialog
        isOpen={showDeleteConfirm}
        onClose={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
        title="确认删除翻译"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <div>
              <p className="text-sm text-[var(--color-text)]">
                确定要删除此文档的翻译缓存吗？
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                翻译后的 PDF 文件将被删除，需要时可以重新翻译。
              </p>
            </div>
          </div>

          {deleteError && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {deleteError}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
              disabled={isDeleting}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isDeleting ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              {isDeleting ? '删除中...' : '确认删除'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
