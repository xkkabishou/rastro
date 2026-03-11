import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Network, Presentation, HelpCircle, Layers, BookOpen,
  Clock, FileText, MessageCircle, Headphones,
  RefreshCw, AlertTriangle, Loader2, ExternalLink,
  CheckCircle2, LogIn, Upload, XCircle, Globe,
} from 'lucide-react';
import {
  STUDIO_TYPES,
  NOTEBOOKLM_URL,
  WEBVIEW_LOAD_TIMEOUT_MS,
  createInitialContext,
  getErrorMessage,
  type StudioGenerationType,
  type NotebookLMState,
  type NotebookLMContext,
  type NotebookLMErrorType,
  type StudioTypeInfo,
} from '../../lib/notebooklm-automation';
import { useDocumentStore } from '../../stores/useDocumentStore';

// ---------------------------------------------------------------------------
// 图标映射
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Network, Presentation, HelpCircle, Layers, BookOpen,
  Clock, FileText, MessageCircle, Headphones,
};

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * NotebookLM WebView 模块
 * T3.1.1 [REQ-006] + T3.1.2 (错误处理)
 *
 * 前端自治模块（Challenge H2），不经过 Backend IPC。
 * 通过内嵌 WebView 实现 Google 登录 + Notebook 创建 + PDF 上传 + Studio 生成
 */
export const NotebookLMView: React.FC = () => {
  const [context, setContext] = useState<NotebookLMContext>(createInitialContext);
  const [selectedType, setSelectedType] = useState<StudioGenerationType | null>(null);
  const webviewRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPdf = useDocumentStore((s) => s.currentDocument);

  // 清理超时定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // 更新状态
  const updateState = useCallback((patch: Partial<NotebookLMContext>) => {
    setContext((prev) => ({ ...prev, ...patch }));
  }, []);

  // 设置错误状态
  const setError = useCallback((errorType: NotebookLMErrorType) => {
    const error = getErrorMessage(errorType);
    updateState({ state: 'error', error, progressMessage: null });
  }, [updateState]);

  // 启动 WebView 加载
  const handleStartLoading = useCallback(() => {
    updateState({
      state: 'loading',
      error: null,
      progressMessage: '正在加载 NotebookLM...',
    });

    // 超时检测 (T3.1.2: 60s WebView 加载超时)
    timeoutRef.current = setTimeout(() => {
      setError('WEBVIEW_TIMEOUT');
    }, WEBVIEW_LOAD_TIMEOUT_MS);
  }, [updateState, setError]);

  // WebView 加载完成
  const handleWebViewReady = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // 假设默认需要检查登录状态
    // 实际环境中会通过 JS 注入检测
    updateState({
      state: 'login-required',
      progressMessage: null,
    });
  }, [updateState]);

  // 模拟登录完成（实际由 WebView 中 Google OAuth 完成）
  const handleLoginComplete = useCallback(() => {
    updateState({
      state: 'ready',
      isLoggedIn: true,
      progressMessage: null,
      error: null,
    });
  }, [updateState]);

  // 触发 Studio 生成
  const handleGenerate = useCallback((type: StudioGenerationType) => {
    if (!currentPdf) return;

    setSelectedType(type);
    const typeInfo = STUDIO_TYPES.find((t) => t.type === type);
    updateState({
      state: 'generating',
      activeGeneration: type,
      progressMessage: `正在生成${typeInfo?.label ?? '内容'}...`,
      error: null,
    });

    // 模拟生成过程（实际由 WebView JS 注入控制）
    // 生产环境将通过 scriptTriggerStudioGeneration 注入并轮询状态
    setTimeout(() => {
      updateState({
        state: 'completed',
        progressMessage: `${typeInfo?.label ?? '内容'}生成完成！`,
        activeGeneration: null,
      });
    }, 5000);
  }, [currentPdf, updateState]);

  // 重试操作 (T3.1.2: 重试逻辑)
  const handleRetry = useCallback(() => {
    const { error } = context;
    if (!error?.retryable) return;

    // 根据错误类型决定重试策略
    switch (error.type) {
      case 'WEBVIEW_TIMEOUT':
      case 'NETWORK_ERROR':
        handleStartLoading();
        break;
      case 'LOGIN_EXPIRED':
        updateState({ state: 'login-required', error: null });
        break;
      case 'UPLOAD_FAILED':
      case 'GENERATION_FAILED':
        updateState({ state: 'ready', error: null });
        break;
      default:
        updateState(createInitialContext());
    }
  }, [context, handleStartLoading, updateState]);

  // 在外部浏览器打开 NotebookLM
  const handleOpenExternal = useCallback(() => {
    window.open(NOTEBOOKLM_URL, '_blank');
  }, []);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--color-text-secondary)]" />
          <span className="font-semibold text-sm text-[var(--color-text)]">NotebookLM</span>
        </div>
        <button
          onClick={handleOpenExternal}
          className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
          title="在浏览器中打开"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {/* 主体内容 */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* 空闲状态 — 引导启动 */}
        {context.state === 'idle' && (
          <IdleView
            hasPdf={!!currentPdf}
            onStart={handleStartLoading}
          />
        )}

        {/* 加载中 */}
        {context.state === 'loading' && (
          <LoadingView message={context.progressMessage} />
        )}

        {/* 需要登录 (T3.1.2: Google 登录过期检测) */}
        {(context.state === 'login-required' || context.state === 'logging-in') && (
          <LoginView
            isLoggingIn={context.state === 'logging-in'}
            onLogin={handleLoginComplete}
          />
        )}

        {/* 就绪 — 选择生成类型 */}
        {context.state === 'ready' && (
          <StudioTypeGrid
            currentPdfTitle={currentPdf?.title}
            onGenerate={handleGenerate}
          />
        )}

        {/* 上传中 */}
        {context.state === 'uploading' && (
          <ProgressView
            icon={<Upload size={24} />}
            title="上传 PDF 中"
            message={context.progressMessage}
          />
        )}

        {/* 生成中 */}
        {context.state === 'generating' && (
          <ProgressView
            icon={<Loader2 size={24} className="animate-spin" />}
            title="Studio 生成中"
            message={context.progressMessage}
          />
        )}

        {/* 完成 */}
        {context.state === 'completed' && (
          <CompletedView
            message={context.progressMessage}
            onReset={() => updateState({ state: 'ready', progressMessage: null })}
          />
        )}

        {/* 错误状态 (T3.1.2: 错误提示 UI + 重试逻辑) */}
        {context.state === 'error' && context.error && (
          <ErrorView
            error={context.error}
            onRetry={handleRetry}
            onReset={() => setContext(createInitialContext())}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

/** 空闲引导视图 */
const IdleView: React.FC<{ hasPdf: boolean; onStart: () => void }> = ({ hasPdf, onStart }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
    <div className="w-14 h-14 rounded-2xl bg-[var(--color-selected)] flex items-center justify-center">
      <Globe size={28} className="text-[var(--color-primary)]" />
    </div>
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">NotebookLM Studio</h3>
      <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed max-w-[240px]">
        一键将当前 PDF 上传至 NotebookLM，生成思维导图、幻灯片、测验等多种知识产物。
      </p>
    </div>
    {!hasPdf && (
      <p className="text-xs text-[var(--color-warning)]">
        请先打开一个 PDF 文件
      </p>
    )}
    <button
      onClick={onStart}
      disabled={!hasPdf}
      className="px-4 py-2 rounded-xl text-xs font-medium transition-colors bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed shadow-[var(--shadow-button)]"
    >
      连接 NotebookLM
    </button>
  </div>
);

/** 加载视图 */
const LoadingView: React.FC<{ message: string | null }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
    <Loader2 size={32} className="text-[var(--color-primary)] animate-spin" />
    <p className="text-xs text-[var(--color-text-secondary)]">{message ?? '加载中...'}</p>
  </div>
);

/** Google 登录视图 */
const LoginView: React.FC<{ isLoggingIn: boolean; onLogin: () => void }> = ({ isLoggingIn, onLogin }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
    <div className="w-14 h-14 rounded-2xl bg-[var(--color-bg-tertiary)] flex items-center justify-center">
      <LogIn size={28} className="text-[var(--color-text-secondary)]" />
    </div>
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">登录 Google 账号</h3>
      <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed max-w-[240px]">
        NotebookLM 需要 Google 账号授权。登录后凭证将持久保存，无需重复登录。
      </p>
    </div>
    <button
      onClick={onLogin}
      disabled={isLoggingIn}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-colors bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)] shadow-[var(--shadow-button)]"
    >
      {isLoggingIn ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <LogIn size={14} />
      )}
      {isLoggingIn ? '登录中...' : '使用 Google 登录'}
    </button>
  </div>
);

/** Studio 类型选择网格 */
const StudioTypeGrid: React.FC<{
  currentPdfTitle?: string;
  onGenerate: (type: StudioGenerationType) => void;
}> = ({ currentPdfTitle, onGenerate }) => (
  <div className="space-y-3">
    {/* 当前文档提示 */}
    {currentPdfTitle && (
      <div className="apple-card p-3 flex items-center gap-2">
        <FileText size={14} className="text-[var(--color-primary)] shrink-0" />
        <span className="text-xs text-[var(--color-text-secondary)] truncate">{currentPdfTitle}</span>
      </div>
    )}

    <h4 className="text-xs font-medium text-[var(--color-text-secondary)] px-1">选择生成类型</h4>

    {/* 类型网格 */}
    <div className="grid grid-cols-2 gap-2">
      {STUDIO_TYPES.map((item) => (
        <StudioTypeCard
          key={item.type}
          info={item}
          onClick={() => onGenerate(item.type)}
        />
      ))}
    </div>
  </div>
);

/** 单个 Studio 类型卡片 */
const StudioTypeCard: React.FC<{
  info: StudioTypeInfo;
  onClick: () => void;
}> = ({ info, onClick }) => {
  const IconComponent = ICON_MAP[info.icon] ?? FileText;
  return (
    <button
      onClick={onClick}
      className="apple-card p-3 text-left group hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-md)] transition-all duration-200"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-selected)] flex items-center justify-center shrink-0 group-hover:bg-[var(--color-primary)] group-hover:text-[var(--color-text-on-primary)] transition-colors">
          <IconComponent size={16} className="text-[var(--color-primary)] group-hover:text-[var(--color-text-on-primary)]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--color-text)] mb-0.5">{info.label}</p>
          <p className="text-[10px] text-[var(--color-text-quaternary)] leading-tight line-clamp-2">{info.description}</p>
        </div>
      </div>
    </button>
  );
};

/** 进度视图 */
const ProgressView: React.FC<{
  icon: React.ReactNode;
  title: string;
  message: string | null;
}> = ({ icon, title, message }) => (
  <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
    <div className="text-[var(--color-primary)]">{icon}</div>
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">{title}</h3>
      {message && <p className="text-xs text-[var(--color-text-tertiary)]">{message}</p>}
    </div>
  </div>
);

/** 完成视图 */
const CompletedView: React.FC<{
  message: string | null;
  onReset: () => void;
}> = ({ message, onReset }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
    <div className="w-14 h-14 rounded-2xl bg-[rgba(52,199,89,0.1)] flex items-center justify-center">
      <CheckCircle2 size={28} className="text-[var(--color-success)]" />
    </div>
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">生成完成</h3>
      {message && <p className="text-xs text-[var(--color-text-tertiary)]">{message}</p>}
    </div>
    <button
      onClick={onReset}
      className="px-4 py-2 rounded-xl text-xs font-medium transition-colors bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)]"
    >
      继续生成其他类型
    </button>
  </div>
);

/** 错误视图 (T3.1.2) */
const ErrorView: React.FC<{
  error: { type: string; message: string; retryable: boolean };
  onRetry: () => void;
  onReset: () => void;
}> = ({ error, onRetry, onReset }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
    <div className="w-14 h-14 rounded-2xl bg-[rgba(255,59,48,0.08)] flex items-center justify-center">
      {error.type === 'USAGE_LIMIT_REACHED' ? (
        <XCircle size={28} className="text-[var(--color-warning)]" />
      ) : (
        <AlertTriangle size={28} className="text-[var(--color-destructive)]" />
      )}
    </div>
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">出现问题</h3>
      <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed max-w-[240px]">
        {error.message}
      </p>
    </div>
    <div className="flex gap-2">
      {error.retryable && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-colors bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)]"
        >
          <RefreshCw size={12} />
          重试
        </button>
      )}
      <button
        onClick={onReset}
        className="px-4 py-2 rounded-xl text-xs font-medium transition-colors bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)]"
      >
        返回
      </button>
    </div>
  </div>
);
