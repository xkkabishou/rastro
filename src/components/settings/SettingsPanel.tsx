import React, { useState, useEffect, useCallback } from 'react';
import { ipcClient } from '../../lib/ipc-client';
import { ProviderCard } from './ProviderCard';
import { Settings, Zap, BarChart3, RefreshCw } from 'lucide-react';
import type { ProviderConfigDto, UsageStatsDto, ProviderId } from '../../shared/types';

/** 设置面板主组件 */
export const SettingsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'providers' | 'usage'>('providers');
  const [providers, setProviders] = useState<ProviderConfigDto[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStatsDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 加载 Provider 配置
  const loadProviders = useCallback(async () => {
    try {
      setIsLoading(true);
      const configs = await ipcClient.listProviderConfigs();
      setProviders(configs);
    } catch (err) {
      console.error('加载 Provider 配置失败:', err);
      // 使用默认空状态
      setProviders([
        { provider: 'openai', model: 'gpt-4o', isActive: true },
        { provider: 'claude', model: 'claude-sonnet-4-20250514', isActive: false },
        { provider: 'gemini', model: 'gemini-2.5-pro', isActive: false },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageStats();
    }
  }, [activeTab, loadUsageStats]);

  // 保存 API Key
  const handleSaveKey = useCallback(async (provider: ProviderId, apiKey: string) => {
    try {
      await ipcClient.saveProviderKey({ provider, apiKey });
      await loadProviders();
    } catch (err) {
      console.error('保存 API Key 失败:', err);
      throw err;
    }
  }, [loadProviders]);

  // 移除 API Key
  const handleRemoveKey = useCallback(async (provider: ProviderId) => {
    try {
      await ipcClient.removeProviderKey(provider);
      await loadProviders();
    } catch (err) {
      console.error('移除 API Key 失败:', err);
    }
  }, [loadProviders]);

  // 设置活跃 Provider
  const handleSetActive = useCallback(async (provider: ProviderId, model: string) => {
    try {
      await ipcClient.setActiveProvider({ provider, model });
      await loadProviders();
    } catch (err) {
      console.error('切换 Provider 失败:', err);
    }
  }, [loadProviders]);

  // 测试连接
  const handleTestConnection = useCallback(async (provider: ProviderId) => {
    try {
      const result = await ipcClient.testProviderConnection({ provider });
      return result;
    } catch (err) {
      console.error('测试连接失败:', err);
      return { provider, model: '', success: false, error: String(err) };
    }
  }, []);

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
          label="AI Provider"
          active={activeTab === 'providers'}
          onClick={() => setActiveTab('providers')}
        />
        <TabButton
          icon={<BarChart3 size={14} />}
          label="使用统计"
          active={activeTab === 'usage'}
          onClick={() => setActiveTab('usage')}
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'providers' && (
          <>
            {providers.map((config) => (
              <ProviderCard
                key={config.provider}
                config={config}
                onSaveKey={handleSaveKey}
                onRemoveKey={handleRemoveKey}
                onSetActive={handleSetActive}
                onTestConnection={handleTestConnection}
              />
            ))}
          </>
        )}

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
