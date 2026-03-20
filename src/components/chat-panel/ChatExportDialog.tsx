import React, { useState, useEffect, useCallback } from 'react';
import { X, Check, Loader2, MessageSquare } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import { useObsidianStore } from '../../stores/useObsidianStore';

interface ChatExportDialogProps {
  documentId: string;
  documentTitle: string;
  onClose: () => void;
}

interface SessionItem {
  sessionId: string;
  title: string | null;
  createdAt: string;
  selected: boolean;
}

/**
 * 聊天记录导出对话框 — 支持多选会话导出到 Obsidian
 */
export const ChatExportDialog: React.FC<ChatExportDialogProps> = ({
  documentId,
  documentTitle,
  onClose,
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const exportChats = useObsidianStore((s) => s.exportChats);

  // 加载聊天会话列表
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoading(true);
      try {
        const response = await ipcClient.listChatSessions(documentId);
        if (Array.isArray(response)) {
          setSessions(
            response.map((s) => ({
              sessionId: s.sessionId,
              title: s.title ?? null,
              createdAt: s.createdAt,
              selected: false,
            }))
          );
        }
      } catch (err) {
        console.error('加载聊天会话失败:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSessions();
  }, [documentId]);

  // 切换选择
  const toggleSession = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId ? { ...s, selected: !s.selected } : s
      )
    );
  }, []);

  // 全选/反选
  const toggleAll = useCallback(() => {
    const allSelected = sessions.every((s) => s.selected);
    setSessions((prev) => prev.map((s) => ({ ...s, selected: !allSelected })));
  }, [sessions]);

  // 导出
  const handleExport = useCallback(async () => {
    const selectedIds = sessions.filter((s) => s.selected).map((s) => s.sessionId);
    if (selectedIds.length === 0) return;

    setIsExporting(true);
    try {
      const exportResult = await exportChats(documentId, documentTitle, selectedIds);
      if (exportResult) {
        setResult({
          success: true,
          message: `已导出 ${exportResult.exportedCount} 个对话到 Obsidian`,
        });
        // 2 秒后自动关闭
        setTimeout(onClose, 2000);
      } else {
        setResult({ success: false, message: '导出失败，请检查 Obsidian 配置' });
      }
    } finally {
      setIsExporting(false);
    }
  }, [sessions, documentId, documentTitle, exportChats, onClose]);

  const selectedCount = sessions.filter((s) => s.selected).length;

  // 格式化日期
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr.slice(0, 16);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* 对话框 */}
      <div className="relative w-[360px] max-h-[480px] rounded-2xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-[var(--color-accent)]" />
            <span className="text-sm font-medium text-[var(--color-text)]">导出聊天记录</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-text-quaternary)]">
              暂无聊天记录
            </div>
          ) : (
            <>
              {/* 全选按钮 */}
              <button
                onClick={toggleAll}
                className="w-full px-3 py-1.5 rounded-lg text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors text-left"
              >
                {sessions.every((s) => s.selected) ? '取消全选' : '全选'}
              </button>
              {/* 会话列表 */}
              {sessions.map((session) => (
                <button
                  key={session.sessionId}
                  onClick={() => toggleSession(session.sessionId)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${
                    session.selected
                      ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20'
                      : 'hover:bg-[var(--color-hover)] border border-transparent'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`shrink-0 w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                      session.selected
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    {session.selected && <Check size={10} className="text-white" />}
                  </div>
                  {/* 会话信息 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--color-text)] truncate">
                      {session.title || '对话'}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-quaternary)]">
                      {formatDate(session.createdAt)}
                    </p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          {result ? (
            <div className={`flex items-center gap-1.5 text-xs ${result.success ? 'text-emerald-500' : 'text-red-400'}`}>
              {result.success ? <Check size={14} /> : <X size={14} />}
              {result.message}
            </div>
          ) : (
            <>
              <span className="text-[11px] text-[var(--color-text-quaternary)]">
                已选 {selectedCount} / {sessions.length} 个对话
              </span>
              <button
                onClick={handleExport}
                disabled={selectedCount === 0 || isExporting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5"
              >
                {isExporting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    导出中...
                  </>
                ) : (
                  '导出到 Obsidian'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
