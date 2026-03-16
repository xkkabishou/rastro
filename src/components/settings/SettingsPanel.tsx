import React, { useState, useCallback, useEffect } from 'react';
import { ModelSettings } from './ModelSettings';
import { Settings, Zap, BarChart3, RefreshCw, HardDrive, Trash2, AlertTriangle } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import type { UsageStatsDto, CacheStatsDto } from '../../shared/types';

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 格式化字节数为人类可读的字符串 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// SettingsPanel 主组件
// ---------------------------------------------------------------------------

/** 设置面板主组件 */
export const SettingsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'model' | 'usage' | 'storage'>('model');
  const [usageStats, setUsageStats] = useState<UsageStatsDto | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsDto | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  // 加载使用统计
  const loadUsageStats = useCallback(async () => {
    try {
      const stats = await ipcClient.getUsageStats();
      setUsageStats(stats);
    } catch (err) {
      console.error('加载使用统计失败:', err);
    }
  }, []);

  // 加载缓存统计
  const loadCacheStats = useCallback(async () => {
    setCacheError(null);
    try {
      const stats = await ipcClient.getCacheStats();
      setCacheStats(stats);
    } catch (err) {
      console.error('加载缓存统计失败:', err);
      setCacheError('缓存统计暂不可用（后端 IPC 未就绪）');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageStats();
    } else if (activeTab === 'storage') {
      loadCacheStats();
    }
  }, [activeTab, loadUsageStats, loadCacheStats]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <Settings size={16} className="text-[var(--color-text-secondary)]" />
        <span className="font-semibold text-sm text-[var(--color-text)]">设置</span>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <TabButton
          icon={<Zap size={14} />}
          label="模型配置"
          active={activeTab === 'model'}
          onClick={() => setActiveTab('model')}
        />
        <TabButton
          icon={<BarChart3 size={14} />}
          label="使用统计"
          active={activeTab === 'usage'}
          onClick={() => setActiveTab('usage')}
        />
        <TabButton
          icon={<HardDrive size={14} />}
          label="存储管理"
          active={activeTab === 'storage'}
          onClick={() => setActiveTab('storage')}
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'model' && <ModelSettings />}
        {activeTab === 'usage' && (
          <UsageView stats={usageStats} onRefresh={loadUsageStats} />
        )}
        {activeTab === 'storage' && (
          <StorageView
            stats={cacheStats}
            error={cacheError}
            onRefresh={loadCacheStats}
            onStatsChange={setCacheStats}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab 按钮
// ---------------------------------------------------------------------------

const TabButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
      active
        ? 'bg-[var(--color-selected)] text-[var(--color-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
    }`}
  >
    {icon}
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// 使用统计视图
// ---------------------------------------------------------------------------

const UsageView: React.FC<{
  stats: UsageStatsDto | null;
  onRefresh: () => void;
}> = ({ stats, onRefresh }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-medium text-[var(--color-text-secondary)]">API 用量概览</h3>
      <button
        onClick={onRefresh}
        className="p-1 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
      >
        <RefreshCw size={12} />
      </button>
    </div>

    {stats ? (
      <div className="apple-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <StatItem label="输入 Tokens" value={stats.total.inputTokens.toLocaleString()} />
          <StatItem label="输出 Tokens" value={stats.total.outputTokens.toLocaleString()} />
          <StatItem label="预估费用" value={`$${stats.total.estimatedCost.toFixed(4)}`} />
          <StatItem label="货币" value={stats.total.currency} />
        </div>
      </div>
    ) : (
      <div className="apple-card p-6 text-center text-xs text-[var(--color-text-quaternary)]">
        暂无使用数据
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// 存储管理视图（T2.5.4）
// ---------------------------------------------------------------------------

const StorageView: React.FC<{
  stats: CacheStatsDto | null;
  error: string | null;
  onRefresh: () => void;
  onStatsChange: (stats: CacheStatsDto | null) => void;
}> = ({ stats, error, onRefresh, onStatsChange }) => {
  const [isClearing, setIsClearing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  // 清理所有翻译缓存
  const handleClearCache = useCallback(async () => {
    setIsClearing(true);
    setClearResult(null);
    try {
      const result = await ipcClient.clearAllTranslationCache();
      setClearResult(`已释放 ${formatBytes(result.freedBytes)} 空间`);
      setShowConfirm(false);
      // 刷新统计
      onStatsChange(null);
      // 延迟刷新以让后端处理完成
      setTimeout(onRefresh, 500);
    } catch (err) {
      console.error('清理缓存失败:', err);
      setClearResult('清理失败，请稍后重试');
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh, onStatsChange]);

  return (
    <div className="space-y-4">
      {/* 标题 + 刷新 */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--color-text-secondary)]">存储管理</h3>
        <button
          onClick={onRefresh}
          className="p-1 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="apple-card p-3 flex items-start gap-2 border-l-2 border-[var(--color-warning)]">
          <AlertTriangle size={14} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--color-text-secondary)]">{error}</p>
        </div>
      )}

      {/* 统计卡片 */}
      {stats ? (
        <div className="apple-card p-4 space-y-4">
          {/* 总览 */}
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-text-secondary)]">总占用</span>
            <span className="text-lg font-bold text-[var(--color-text)]">
              {formatBytes(stats.totalBytes)}
            </span>
          </div>

          {/* 用量条 */}
          {stats.totalBytes > 0 && (
            <div className="h-2 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
                style={{
                  width: `${Math.max(
                    (stats.translationBytes / stats.totalBytes) * 100,
                    stats.translationBytes > 0 ? 5 : 0,
                  )}%`,
                }}
              />
            </div>
          )}

          {/* 分项 */}
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="翻译缓存" value={formatBytes(stats.translationBytes)} />
            <StatItem label="AI 总结" value={`${stats.summaryCount} 篇 (${formatBytes(stats.summaryBytes)})`} />
            <StatItem label="文档数量" value={`${stats.documentCount} 篇`} />
            <StatItem
              label="翻译占比"
              value={
                stats.totalBytes > 0
                  ? `${Math.round((stats.translationBytes / stats.totalBytes) * 100)}%`
                  : '—'
              }
            />
          </div>
        </div>
      ) : !error ? (
        <div className="apple-card p-6 text-center text-xs text-[var(--color-text-quaternary)]">
          加载中...
        </div>
      ) : null}

      {/* 清理操作 */}
      <div className="apple-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Trash2 size={14} className="text-[var(--color-text-secondary)]" />
          <span className="text-xs font-medium text-[var(--color-text)]">
            清理翻译缓存
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] leading-relaxed">
          删除所有已缓存的翻译 PDF 文件。原始文档和 AI 总结不受影响。
          需要时可重新翻译。
        </p>

        {/* 确认对话 */}
        {showConfirm ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-destructive)]/5 border border-[var(--color-destructive)]/20">
            <AlertTriangle size={14} className="text-[var(--color-destructive)] shrink-0" />
            <span className="text-xs text-[var(--color-text-secondary)] flex-1">
              确定清理所有翻译缓存？此操作不可撤销。
            </span>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={isClearing}
              className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--color-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleClearCache}
              disabled={isClearing}
              className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--color-destructive)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isClearing ? '清理中...' : '确认清理'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!stats || stats.translationBytes === 0}
            className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-destructive)]/30 text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            清理所有翻译缓存
            {stats && stats.translationBytes > 0 && (
              <span className="ml-1 opacity-70">
                ({formatBytes(stats.translationBytes)})
              </span>
            )}
          </button>
        )}

        {/* 清理结果反馈 */}
        {clearResult && (
          <p className="text-[11px] text-[var(--color-success)] text-center animate-pulse">
            ✓ {clearResult}
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 通用 — 统计项
// ---------------------------------------------------------------------------

const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] text-[var(--color-text-quaternary)] mb-0.5">{label}</p>
    <p className="text-sm font-semibold text-[var(--color-text)]">{value}</p>
  </div>
);
