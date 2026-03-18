import React, { useState, useCallback, useEffect } from 'react';
import { Eye, EyeOff, Check, X, Loader2, Trash2, Radio, ChevronDown, RefreshCw } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';
import type { ProviderConfigDto, ProviderConnectivityDto, ProviderId, ModelInfo } from '../../shared/types';

/** Provider 品牌配置 */
const PROVIDER_BRANDS: Record<ProviderId, { name: string; color: string; icon: string; defaultBaseUrl: string }> = {
  openai: { name: 'OpenAI', color: '#10A37F', icon: '🟢', defaultBaseUrl: 'https://api.openai.com/v1' },
  claude: { name: 'Claude', color: '#D97706', icon: '🟡', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  gemini: { name: 'Gemini', color: '#4285F4', icon: '🔵', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
};

/**
 * IPC 方法覆盖 — 让 ProviderCard 可被翻译配置等不同场景复用
 * 不传则使用默认的主 AI IPC
 */
export interface ProviderCardIpcOverrides {
  /** 更新 Provider 配置（base_url、model） */
  updateConfig?: (provider: ProviderId, baseUrl?: string, model?: string) => Promise<unknown>;
  /** 拉取可用模型列表（不传则使用默认 IPC） */
  fetchModels?: (provider: ProviderId) => Promise<{ models: ModelInfo[] }>;
}

interface ProviderCardProps {
  config: ProviderConfigDto;
  onSaveKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  onRemoveKey: (provider: ProviderId) => Promise<void>;
  onSetActive: (provider: ProviderId, model: string) => Promise<void>;
  onTestConnection: (provider: ProviderId) => Promise<ProviderConnectivityDto>;
  onConfigUpdate?: () => Promise<void>;
  /** 可选：覆盖内部 IPC 调用以支持翻译配置等不同场景 */
  ipcOverrides?: ProviderCardIpcOverrides;
}

/** 单个 Provider 配置卡片 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  config,
  onSaveKey,
  onRemoveKey,
  onSetActive,
  onTestConnection,
  onConfigUpdate,
  ipcOverrides,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderConnectivityDto | null>(null);

  // Base URL 相关
  const [baseUrlInput, setBaseUrlInput] = useState(config.baseUrl || '');
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);

  // 模型选择相关
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [modelInput, setModelInput] = useState(config.model);
  const [isSavingModel, setIsSavingModel] = useState(false);

  const brand = PROVIDER_BRANDS[config.provider];

  // 统一的 updateConfig 入口：优先使用 override，否则用默认 IPC
  const doUpdateConfig = useCallback(async (provider: ProviderId, baseUrl?: string, model?: string) => {
    if (ipcOverrides?.updateConfig) {
      await ipcOverrides.updateConfig(provider, baseUrl, model);
    } else {
      await ipcClient.updateProviderConfig({ provider, baseUrl, model });
    }
  }, [ipcOverrides]);

  // 统一的 fetchModels 入口
  const doFetchModels = useCallback(async (provider: ProviderId) => {
    if (ipcOverrides?.fetchModels) {
      return ipcOverrides.fetchModels(provider);
    }
    return ipcClient.fetchAvailableModels(provider);
  }, [ipcOverrides]);

  useEffect(() => {
    setBaseUrlInput(config.baseUrl || '');
    setModelInput(config.model);
    setShowModelDropdown(false);
  }, [config.baseUrl, config.model, config.provider]);

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

  // 保存 Base URL
  const handleSaveBaseUrl = useCallback(async () => {
    setIsSavingBaseUrl(true);
    try {
      await doUpdateConfig(config.provider, baseUrlInput.trim() || undefined);
      setIsEditingBaseUrl(false);
      onConfigUpdate?.();
    } catch (err) {
      console.error('保存 Base URL 失败:', err);
    } finally {
      setIsSavingBaseUrl(false);
    }
  }, [baseUrlInput, config.provider, doUpdateConfig, onConfigUpdate]);

  // 拉取模型列表
  const handleFetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    try {
      const result = await doFetchModels(config.provider);
      setAvailableModels(result.models);
      setShowModelDropdown(true);
    } catch (err) {
      console.error('拉取模型列表失败:', err);
    } finally {
      setIsFetchingModels(false);
    }
  }, [config.provider, doFetchModels]);

  // 选择模型
  const handleSelectModel = useCallback(async (modelId: string) => {
    setModelInput(modelId);
    setShowModelDropdown(false);
    try {
      setIsSavingModel(true);
      await doUpdateConfig(config.provider, undefined, modelId);
      onConfigUpdate?.();
    } catch (err) {
      console.error('更新模型失败:', err);
    } finally {
      setIsSavingModel(false);
    }
  }, [config.provider, doUpdateConfig, onConfigUpdate]);

  const handleSaveModel = useCallback(async () => {
    if (!modelInput.trim()) return;
    try {
      setIsSavingModel(true);
      await doUpdateConfig(config.provider, undefined, modelInput.trim());
      setShowModelDropdown(false);
      onConfigUpdate?.();
    } catch (err) {
      console.error('保存模型失败:', err);
    } finally {
      setIsSavingModel(false);
    }
  }, [config.provider, modelInput, doUpdateConfig, onConfigUpdate]);

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
            <p className="text-[10px] text-[var(--color-text-tertiary)]">{modelInput || config.model}</p>
          </div>
        </div>

        {config.isActive ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] text-[10px] font-medium">
            <Radio size={10} />
            活跃
          </span>
        ) : (
          <button
            onClick={() => onSetActive(config.provider, modelInput || config.model)}
            className="px-2 py-0.5 rounded-full text-[10px] font-medium text-[var(--color-text-tertiary)] border border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors"
          >
            设为活跃
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {/* Base URL 输入 */}
        <div>
          <label className="text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1 block">
            Base URL
          </label>
          {isEditingBaseUrl ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder={brand.defaultBaseUrl}
                className="input-base flex-1 h-8 text-xs font-mono"
              />
              <button
                onClick={handleSaveBaseUrl}
                disabled={isSavingBaseUrl}
                className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-30 transition-opacity"
              >
                {isSavingBaseUrl ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              </button>
              <button
                onClick={() => { setIsEditingBaseUrl(false); setBaseUrlInput(config.baseUrl || ''); }}
                className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingBaseUrl(true)}
              className="w-full h-8 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center px-3 hover:border-[var(--color-primary)]/30 transition-colors text-left"
            >
              <span className="text-xs text-[var(--color-text-secondary)] font-mono truncate">
                {config.baseUrl || brand.defaultBaseUrl}
              </span>
            </button>
          )}
        </div>

        {/* API Key 区域 */}
        <div>
          <label className="text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1 block">
            API Key
          </label>
          {config.maskedKey && !isEditing ? (
            // 已配置：脱敏显示
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-8 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center px-3">
                <span className="text-xs text-[var(--color-text-secondary)] font-mono">
                  {showKey ? config.maskedKey : '••••••••••••'}
                </span>
              </div>
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
              >
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="text-[10px] text-[var(--color-primary)] hover:underline"
              >
                更换
              </button>
              <button
                onClick={() => onRemoveKey(config.provider)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] transition-colors"
                title="移除 Key"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ) : (
            // 未配置 or 编辑中：输入框
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={`输入 ${brand.name} API Key`}
                className="input-base flex-1 h-8 text-xs font-mono"
              />
              <button
                onClick={handleSave}
                disabled={!apiKeyInput.trim() || isSaving}
                className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-30 transition-opacity"
              >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              </button>
              {isEditing && (
                <button
                  onClick={() => { setIsEditing(false); setApiKeyInput(''); }}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* 模型选择 */}
        <div>
          <label className="text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1 block">
            模型
          </label>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder={config.model || '输入模型 ID'}
                  className="input-base flex-1 h-8 text-xs font-mono"
                  onFocus={() => {
                    if (availableModels.length > 0) {
                      setShowModelDropdown(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleSaveModel();
                    }
                  }}
                />
                <button
                  onClick={() => void handleSaveModel()}
                  disabled={!modelInput.trim() || isSavingModel}
                  className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-30 transition-opacity"
                  title="保存模型 ID"
                >
                  {isSavingModel ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                </button>
                <button
                  onClick={() => {
                    if (availableModels.length > 0) {
                      setShowModelDropdown(!showModelDropdown);
                    } else {
                      handleFetchModels();
                    }
                  }}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
                  title="显示已拉取模型"
                >
                  <ChevronDown size={12} className="text-[var(--color-text-quaternary)] shrink-0" />
                </button>
              </div>

              {/* 模型下拉列表 */}
              {showModelDropdown && availableModels.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleSelectModel(m.id)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] transition-colors ${
                        m.id === (modelInput || config.model) ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)]'
                      }`}
                    >
                      <span className="font-mono">{m.id}</span>
                      {m.name && m.name !== m.id && (
                        <span className="text-[var(--color-text-quaternary)] ml-1.5">
                          {m.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 拉取模型按钮 */}
            <button
              onClick={handleFetchModels}
              disabled={isFetchingModels || !config.maskedKey}
              className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] disabled:opacity-30 transition-colors"
              title={config.maskedKey ? '拉取可用模型' : '请先配置 API Key'}
            >
              {isFetchingModels ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          </div>
        </div>

        {/* 测试连接按钮 */}
        {config.maskedKey && (
          <div className="flex items-center gap-2 pt-1">
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

      {/* 点击外部关闭模型下拉 */}
      {showModelDropdown && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowModelDropdown(false)}
        />
      )}
    </div>
  );
};
