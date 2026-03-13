import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import { ProviderCard } from './ProviderCard';
import type {
  ProviderConfigDto,
  ProviderConnectivityDto,
  ProviderId,
} from '../../shared/types';

const PROVIDER_OPTIONS: Array<{ id: ProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
];

export const ModelSettings: React.FC = () => {
  const [configs, setConfigs] = useState<ProviderConfigDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setIsLoading(true);
      const nextConfigs = await ipcClient.listProviderConfigs();
      setConfigs(nextConfigs);
    } catch (err) {
      console.error('加载 Provider 配置失败:', err);
      setConfigs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (configs.length === 0) return;
    if (selectedProvider && configs.some((config) => config.provider === selectedProvider)) {
      return;
    }
    const activeConfig = configs.find((config) => config.isActive) ?? configs[0];
    setSelectedProvider(activeConfig.provider);
  }, [configs, selectedProvider]);

  const handleSaveKey = useCallback(async (provider: ProviderId, apiKey: string) => {
    await ipcClient.saveProviderKey({ provider, apiKey });
    await loadConfigs();
  }, [loadConfigs]);

  const handleRemoveKey = useCallback(async (provider: ProviderId) => {
    await ipcClient.removeProviderKey(provider);
    await loadConfigs();
  }, [loadConfigs]);

  const handleSetActive = useCallback(async (provider: ProviderId, model: string) => {
    await ipcClient.setActiveProvider({ provider, model });
    await loadConfigs();
  }, [loadConfigs]);

  const handleTestConnection = useCallback(async (provider: ProviderId): Promise<ProviderConnectivityDto> => (
    ipcClient.testProviderConnection({ provider })
  ), []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-[var(--color-text-quaternary)]" />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="apple-card p-6 text-center text-xs text-[var(--color-text-quaternary)]">
        无法加载 Provider 配置
      </div>
    );
  }

  const currentConfig = configs.find((config) => config.provider === selectedProvider) ?? configs[0];

  return (
    <div className="space-y-4">
      <div className="apple-card p-4">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <p className="font-medium text-[var(--color-text)]">自定义网关请按协议类型选择 Provider</p>
            <p className="mt-1">
              先选接口类型，再填写 Base URL、API Key 和模型。
              如果你的 URL 只兼容 Claude 格式，请选择 Claude，不要挂在 OpenAI 上。
            </p>
          </div>
        </div>
      </div>

      <div className="apple-card p-3">
        <p className="mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">接口类型</p>
        <div className="grid grid-cols-3 gap-2">
          {PROVIDER_OPTIONS.map((option) => {
            const isActive = option.id === selectedProvider;
            return (
              <button
                key={option.id}
                onClick={() => setSelectedProvider(option.id)}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-[var(--color-primary)] bg-[var(--color-selected)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <ProviderCard
        key={currentConfig.provider}
        config={currentConfig}
        onSaveKey={handleSaveKey}
        onRemoveKey={handleRemoveKey}
        onSetActive={handleSetActive}
        onTestConnection={handleTestConnection}
        onConfigUpdate={loadConfigs}
      />
    </div>
  );
};
