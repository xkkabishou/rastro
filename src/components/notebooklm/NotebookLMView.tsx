import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  FolderDown,
  Globe,
  Loader2,
  LogOut,
  Network,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  NOTEBOOKLM_MVP_ARTIFACT,
  NOTEBOOKLM_UNAVAILABLE_MESSAGE,
} from '../../lib/notebooklm-automation';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useNotebookLMStore } from '../../stores/useNotebookLMStore';

const POLL_INTERVAL_MS = 2_000;

function statusBadge(authenticated: boolean, authExpired?: boolean) {
  if (authenticated) {
    return 'bg-emerald-500/12 text-emerald-600 border-emerald-500/20';
  }
  if (authExpired) {
    return 'bg-amber-500/12 text-amber-700 border-amber-500/20';
  }
  return 'bg-slate-500/12 text-slate-600 border-slate-500/20';
}

export const NotebookLMView: React.FC = () => {
  const currentPdf = useDocumentStore((state) => state.currentDocument);
  const {
    status,
    notebooks,
    selectedNotebookId,
    artifacts,
    activeTask,
    recentTasks,
    loading,
    busy,
    error,
    refreshStatus,
    selectNotebook,
    beginLogin,
    openExternal,
    logout,
    createNotebook,
    attachCurrentPdf,
    generateMindMap,
    refreshTask,
    downloadArtifact,
    clearError,
  } = useNotebookLMStore();
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!activeTask || ['completed', 'failed', 'cancelled'].includes(activeTask.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshTask();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTask, refreshTask]);

  useEffect(() => {
    if (!draftTitle && currentPdf?.title) {
      setDraftTitle(currentPdf.title);
    }
  }, [currentPdf, draftTitle]);

  const auth = status?.auth;
  const canOperate = Boolean(auth?.authenticated && selectedNotebookId && !busy);
  const currentNotebook = useMemo(
    () => notebooks.find((item) => item.id === selectedNotebookId) ?? null,
    [notebooks, selectedNotebookId]
  );

  const handleOpenExternal = () => {
    void openExternal();
  };

  const handleCreateNotebook = async () => {
    const title = draftTitle.trim() || currentPdf?.title || 'Untitled Notebook';
    await createNotebook(title, currentPdf?.title ? `Source: ${currentPdf.title}` : undefined);
  };

  const handleAttachPdf = async () => {
    if (!currentPdf?.filePath) {
      return;
    }
    await attachCurrentPdf(currentPdf.filePath);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--color-text-secondary)]" />
          <span className="text-sm font-semibold text-[var(--color-text)]">NotebookLM</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge(
              Boolean(auth?.authenticated),
              auth?.authExpired
            )}`}
          >
            {auth?.authenticated ? '已连接' : auth?.authExpired ? '登录过期' : '未登录'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void refreshStatus()}
            className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-hover)]"
            title="刷新状态"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleOpenExternal}
            className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-hover)]"
            title="在浏览器中打开"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <div className="apple-card flex items-start gap-3 border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/6 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold text-[var(--color-text)]">{error.message}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{error.code}</p>
            </div>
            <button
              onClick={clearError}
              className="rounded-md px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]"
            >
              关闭
            </button>
          </div>
        )}

        <div className="apple-card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[var(--color-text)]">认证与兜底</p>
              <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {NOTEBOOKLM_UNAVAILABLE_MESSAGE}
              </p>
            </div>
            {loading && <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void beginLogin()}
              disabled={busy}
              className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-on-primary)] shadow-[var(--shadow-button)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auth?.authenticated ? '重新登录' : '连接 NotebookLM'}
            </button>
            <button
              onClick={handleOpenExternal}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)]"
            >
              <ExternalLink size={14} />
              外部打开
            </button>
            <button
              onClick={() => void logout()}
              disabled={busy || !auth?.authenticated}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogOut size={14} />
              退出登录
            </button>
          </div>
          {auth?.lastError && (
            <p className="text-xs text-[var(--color-text-tertiary)]">最近错误：{auth.lastError}</p>
          )}
        </div>

        <div className="apple-card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--color-primary)]" />
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">当前文档</span>
          </div>

          {currentPdf ? (
            <>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">
                  {currentPdf.title}
                </p>
                <p className="mt-1 break-all text-[11px] text-[var(--color-text-tertiary)]">
                  {currentPdf.filePath}
                </p>
              </div>
              <button
                onClick={() => void handleAttachPdf()}
                disabled={!canOperate || !currentPdf.filePath}
                className="w-full rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                上传当前 PDF
              </button>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              当前还没有打开 PDF，NotebookLM 上传动作会在打开文档后启用。
            </p>
          )}
        </div>

        <div className="apple-card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Notebook</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {currentNotebook ? `当前：${currentNotebook.title}` : '请选择或创建 notebook'}
              </p>
            </div>
          </div>
          <select
            value={selectedNotebookId ?? ''}
            onChange={(event) => void selectNotebook(event.target.value || null)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
          >
            <option value="">选择已有 notebook</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.title} ({notebook.sourceCount})
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="新 notebook 标题"
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
            />
            <button
              onClick={() => void handleCreateNotebook()}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={14} />
              新建
            </button>
          </div>
        </div>

        <div className="apple-card space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">生成器</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              当前优先打通的产物：Mind Map
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void generateMindMap()}
              disabled={!canOperate}
              className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-[var(--color-text-on-primary)] shadow-[var(--shadow-button)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Network size={14} />
              Mind Map
            </button>
            {['Slide Deck', 'Quiz', 'Flashcards', 'Audio Overview', 'Report'].map((label) => (
              <button
                key={label}
                disabled
                className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-tertiary)] opacity-60"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            已启用产物类型：{NOTEBOOKLM_MVP_ARTIFACT}
          </p>
        </div>

        <div className="apple-card space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">任务状态</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              所有状态均来自真实 IPC / engine 轮询
            </p>
          </div>

          {activeTask ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5">
              <p className="text-sm font-medium text-[var(--color-text)]">
                当前任务: {activeTask.kind}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                状态：{activeTask.status}
              </p>
              {activeTask.progressMessage && (
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  {activeTask.progressMessage}
                </p>
              )}
              {activeTask.errorMessage && (
                <p className="mt-1 text-xs text-[var(--color-warning)]">
                  {activeTask.errorMessage}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)]">当前没有运行中的任务。</p>
          )}

          {recentTasks.length > 0 && (
            <div className="space-y-2">
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{task.kind}</span>
                    <span>{task.status}</span>
                  </div>
                  {task.progressMessage && <p className="mt-1">{task.progressMessage}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="apple-card space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">产物</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              当前 notebook 的已生成产物与下载状态
            </p>
          </div>

          {artifacts.length === 0 ? (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              还没有可下载的产物。先上传 PDF，再生成 Mind Map。
            </p>
          ) : (
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">
                        {artifact.title}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                        {artifact.type} · {artifact.downloadStatus}
                      </p>
                    </div>
                    <button
                      onClick={() => void downloadArtifact(artifact)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FolderDown size={14} />
                      下载
                    </button>
                  </div>
                  {artifact.localPath && (
                    <p className="mt-2 break-all text-[11px] text-[var(--color-text-tertiary)]">
                      {artifact.localPath}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
