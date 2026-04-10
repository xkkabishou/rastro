import React from 'react';

// ---------------------------------------------------------------------------
// 全局错误边界：防止未捕获的渲染错误导致整个界面白屏
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Rastro 渲染异常:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="text-4xl">🐕</div>
            <h2 className="text-lg font-semibold">哎呀，出了点问题</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
