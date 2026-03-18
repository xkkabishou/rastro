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

/**
 * 翻译设置 — 复用 ProviderCard UI，通过 ipcOverrides 注入翻译专用 IPC
 * API Key 使用 translation_ 前缀 Keychain，数据表为 translation_provider_settings
 */
export const TranslationSettings: React.FC = () => {
  const [configs, setConfigs] = useState<ProviderConfigDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);

  // 加载翻译 Provider 配置，映射为 ProviderConfigDto 格式
  const loadConfigs = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await ipcClient.listTranslationProviderConfigs();
      // TranslationProviderConfigDto 与 ProviderConfigDto 字段兼容，直接映射
      const mapped: ProviderConfigDto[] = data.map((c) => ({
        provider: c.provider,
        model: c.model,
        baseUrl: c.baseUrl,
        isActive: c.isActive,
        maskedKey: c.maskedKey,
      }));
      setConfigs(mapped);
    } catch (err) {
      console.error('加载翻译 Provider 配置失败:', err);
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
    if (selectedProvider && configs.some((c) => c.provider === selectedProvider)) return;
    const active = configs.find((c) => c.isActive) ?? configs[0];
    setSelectedProvider(active.provider);
  }, [configs, selectedProvider]);

  // 翻译 IPC 回调 — 映射到翻译专用 commands
  const handleSaveKey = useCallback(async (provider: ProviderId, apiKey: string) => {
    await ipcClient.saveTranslationProviderKey(provider, apiKey);
    await loadConfigs();
  }, [loadConfigs]);

  const handleRemoveKey = useCallback(async (_provider: ProviderId) => {
    // 翻译 Provider 暂不支持移除 Key，保存空 Key 即可清除
    await loadConfigs();
  }, [loadConfigs]);

  const handleSetActive = useCallback(async (provider: ProviderId, model: string) => {
    await ipcClient.setActiveTranslationProvider(provider, model);
    await loadConfigs();
  }, [loadConfigs]);

  const handleTestConnection = useCallback(async (provider: ProviderId): Promise<ProviderConnectivityDto> => {
    const result = await ipcClient.testTranslationConnection(provider);
    return {
      provider: result.provider,
      model: result.model,
      success: result.success,
      latencyMs: result.latencyMs,
      error: result.error,
    };
  }, []);

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
        无法加载翻译 Provider 配置
      </div>
    );
  }

  const currentConfig = configs.find((c) => c.provider === selectedProvider) ?? configs[0];

  return (
    <div className="space-y-4">
      <div className="apple-card p-4">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <p className="font-medium text-[var(--color-text)]">翻译 API 独立配置</p>
            <p className="mt-1">
              翻译功能使用独立的 API 配置，与 AI 问答/总结的配置互不影响。
            </p>
          </div>
        </div>
      </div>

      {/* Provider 选择 */}
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

      {/* 复用 ProviderCard，通过 ipcOverrides 注入翻译 IPC */}
      <ProviderCard
        key={currentConfig.provider}
        config={currentConfig}
        onSaveKey={handleSaveKey}
        onRemoveKey={handleRemoveKey}
        onSetActive={handleSetActive}
        onTestConnection={handleTestConnection}
        onConfigUpdate={loadConfigs}
        ipcOverrides={{
          updateConfig: async (provider, baseUrl, model) => {
            await ipcClient.updateTranslationProviderConfig(provider, baseUrl, model);
          },
        }}
      />
    </div>
  );
};
