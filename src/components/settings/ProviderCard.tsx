import React, { useState, useCallback } from 'react';
import { Eye, EyeOff, Check, X, Loader2, Trash2, Radio } from 'lucide-react';
import type { ProviderConfigDto, ProviderConnectivityDto, ProviderId } from '../../shared/types';

/** Provider 品牌配置 */
const PROVIDER_BRANDS: Record<ProviderId, { name: string; color: string; icon: string }> = {
  openai: { name: 'OpenAI', color: '#10A37F', icon: '🟢' },
  claude: { name: 'Claude', color: '#D97706', icon: '🟡' },
  gemini: { name: 'Gemini', color: '#4285F4', icon: '🔵' },
};

interface ProviderCardProps {
  config: ProviderConfigDto;
  onSaveKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  onRemoveKey: (provider: ProviderId) => Promise<void>;
  onSetActive: (provider: ProviderId, model: string) => Promise<void>;
  onTestConnection: (provider: ProviderId) => Promise<ProviderConnectivityDto>;
}

/** 单个 Provider 配置卡片 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  config,
  onSaveKey,
  onRemoveKey,
  onSetActive,
  onTestConnection,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderConnectivityDto | null>(null);

  const brand = PROVIDER_BRANDS[config.provider];

  // 保存 API Key
  const handleSave = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setIsSaving(true);
    try {
      await onSaveKey(config.provider, apiKeyInput.trim());
      setIsEditing(false);
      setApiKeyInput('');
    } catch {
      // 错误已在父组件处理
    } finally {
      setIsSaving(false);
    }
  }, [apiKeyInput, config.provider, onSaveKey]);

  // 测试连接
  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(config.provider);
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  }, [config.provider, onTestConnection]);

  return (
    <div className={`apple-card p-4 transition-all ${
      config.isActive ? 'ring-2 ring-[var(--color-primary)]/20' : ''
    }`}>
      {/* 头部：Provider 名称 + 激活状态 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{brand.icon}</span>
          <div>
            <h4 className="text-sm font-semibold text-[var(--color-text)]">{brand.name}</h4>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">{config.model}</p>
          </div>
        </div>

        {config.isActive ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] text-[10px] font-medium">
            <Radio size={10} />
            活跃
          </span>
        ) : (
          <button
            onClick={() => onSetActive(config.provider, config.model)}
            className="px-2 py-0.5 rounded-full text-[10px] font-medium text-[var(--color-text-tertiary)] border border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors"
          >
            设为活跃
          </button>
        )}
      </div>

      {/* API Key 区域 */}
      <div className="space-y-2">
        {config.maskedKey && !isEditing ? (
          // 已配置：脱敏显示
          <div className="flex items-center gap-2">
            <div className="flex-1 h-9 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center px-3">
              <span className="text-xs text-[var(--color-text-secondary)] font-mono">
                {showKey ? config.maskedKey : '••••••••••••'}
              </span>
            </div>
            <button
              onClick={() => setShowKey(!showKey)}
              className="p-2 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs text-[var(--color-primary)] hover:underline"
            >
              更换
            </button>
            <button
              onClick={() => onRemoveKey(config.provider)}
              className="p-2 rounded-lg hover:bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] transition-colors"
              title="移除 Key"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          // 未配置 or 编辑中：输入框
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`输入 ${brand.name} API Key`}
              className="input-base flex-1 h-9 text-xs font-mono"
            />
            <button
              onClick={handleSave}
              disabled={!apiKeyInput.trim() || isSaving}
              className="p-2 rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-30 transition-opacity"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            {isEditing && (
              <button
                onClick={() => { setIsEditing(false); setApiKeyInput(''); }}
                className="p-2 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* 测试连接按钮 */}
        {config.maskedKey && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={isTesting}
              className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isTesting && <Loader2 size={10} className="animate-spin" />}
              测试连接
            </button>

            {testResult && (
              <span className={`text-[10px] flex items-center gap-1 ${
                testResult.success ? 'text-[var(--color-success)]' : 'text-[var(--color-destructive)]'
              }`}>
                {testResult.success ? (
                  <><Check size={10} /> 连接成功 ({testResult.latencyMs}ms)</>
                ) : (
                  <><X size={10} /> {testResult.error || '连接失败'}</>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
