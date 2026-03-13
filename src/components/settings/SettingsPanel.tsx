import React, { useState, useCallback, useEffect } from 'react';
import { ModelSettings } from './ModelSettings';
import { Settings, Zap, BarChart3, RefreshCw } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import type { UsageStatsDto } from '../../shared/types';

/** 设置面板主组件 */
export const SettingsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'model' | 'usage'>('model');
  const [usageStats, setUsageStats] = useState<UsageStatsDto | null>(null);

  // 加载使用统计
  const loadUsageStats = useCallback(async () => {
    try {
      const stats = await ipcClient.getUsageStats();
      setUsageStats(stats);
    } catch (err) {
      console.error('加载使用统计失败:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageStats();
    }
  }, [activeTab, loadUsageStats]);

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
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'model' && <ModelSettings />}
        {activeTab === 'usage' && (
          <UsageView stats={usageStats} onRefresh={loadUsageStats} />
        )}
      </div>
    </div>
  );
};

/** Tab 按钮 */
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

/** 使用统计视图 */
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

/** 统计项 */
const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] text-[var(--color-text-quaternary)] mb-0.5">{label}</p>
    <p className="text-sm font-semibold text-[var(--color-text)]">{value}</p>
  </div>
);
