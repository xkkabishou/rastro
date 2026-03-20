import React, { useEffect, useCallback, useState } from 'react';
import { FolderOpen, Check, X, RefreshCw, Loader2, Search } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useObsidianStore } from '../../stores/useObsidianStore';
import { ipcClient } from '../../lib/ipc-client';
import type { DetectedVault } from '../../shared/types';

/**
 * Obsidian 配置区块 — 嵌入 SettingsPanel 的存储管理 Tab
 */
export const ObsidianSettings: React.FC = () => {
  const { config, validation, isValidating, isLoading, loadConfig, setVaultPath, setAutoSync, validateVault } = useObsidianStore();
  const [justSaved, setJustSaved] = useState(false);
  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);

  // 初始化加载配置 + 自动检测 vault
  useEffect(() => {
    loadConfig();
    detectVaults();
  }, [loadConfig]);

  // 自动检测 Obsidian vault
  const detectVaults = useCallback(async () => {
    setIsDetecting(true);
    try {
      const vaults = await ipcClient.detectObsidianVaults();
      setDetectedVaults(vaults);
      // 如果还没配置路径且只检测到一个 vault，自动填入
      const currentConfig = useObsidianStore.getState().config;
      if (!currentConfig.vaultPath && vaults.length === 1) {
        await setVaultPath(vaults[0].path);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      }
    } catch (err) {
      console.warn('[Obsidian] 自动检测失败:', err);
    } finally {
      setIsDetecting(false);
    }
  }, [setVaultPath]);

  // 选择文件夹（手动）
  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择 Obsidian Vault 路径',
      });
      if (selected && typeof selected === 'string') {
        await setVaultPath(selected);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      }
    } catch (err) {
      console.error('选择文件夹失败:', err);
    }
  }, [setVaultPath]);

  // 点击检测到的 vault
  const handleSelectDetected = useCallback(async (path: string) => {
    await setVaultPath(path);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }, [setVaultPath]);

  // 重新校验
  const handleRevalidate = useCallback(async () => {
    if (config.vaultPath) {
      await validateVault(config.vaultPath);
    }
  }, [config.vaultPath, validateVault]);

  // 切换自动同步
  const handleToggleAutoSync = useCallback(async () => {
    await setAutoSync(!config.autoSync);
  }, [config.autoSync, setAutoSync]);

  if (isLoading) {
    return (
      <div className="apple-card p-6 text-center">
        <Loader2 size={16} className="animate-spin text-[var(--color-text-tertiary)] mx-auto" />
      </div>
    );
  }

  return (
    <div className="apple-card p-4 space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center">
          <span className="text-[10px]">📝</span>
        </div>
        <span className="text-xs font-medium text-[var(--color-text)]">
          Obsidian 同步
        </span>
      </div>

      {/* Vault 路径 */}
      <div className="space-y-1.5">
        <label className="text-[10px] text-[var(--color-text-quaternary)]">
          Vault 路径
        </label>

        {/* 自动检测到的 vault 列表 */}
        {!config.vaultPath && detectedVaults.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
              <Search size={9} />
              <span>检测到 {detectedVaults.length} 个 Vault</span>
            </div>
            {detectedVaults.map((v) => (
              <button
                key={v.path}
                onClick={() => handleSelectDetected(v.path)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/15 hover:bg-[var(--color-primary)]/10 transition-colors text-left"
              >
                <div className="w-4 h-4 rounded bg-[var(--color-primary)]/15 flex items-center justify-center shrink-0">
                  <span className="text-[9px]">📂</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--color-text)] truncate">{v.name}</p>
                  <p className="text-[9px] text-[var(--color-text-quaternary)] truncate">{v.path}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 已配置的路径 或 手动选择 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-tertiary)] text-xs text-[var(--color-text-secondary)] truncate min-w-0">
            {config.vaultPath || '未配置'}
          </div>
          <button
            onClick={handleSelectFolder}
            className="shrink-0 p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            title="选择文件夹"
          >
            <FolderOpen size={14} />
          </button>
        </div>

        {/* 校验状态 */}
        {config.vaultPath && (
          <div className="flex items-center gap-1.5 text-[10px]">
            {isValidating ? (
              <>
                <Loader2 size={10} className="animate-spin text-[var(--color-text-tertiary)]" />
                <span className="text-[var(--color-text-tertiary)]">校验中...</span>
              </>
            ) : validation ? (
              <>
                {validation.valid ? (
                  <Check size={10} className="text-emerald-500" />
                ) : (
                  <X size={10} className="text-red-400" />
                )}
                <span className={validation.valid ? 'text-emerald-500' : 'text-red-400'}>
                  {validation.message}
                </span>
                <button
                  onClick={handleRevalidate}
                  className="ml-auto p-0.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-quaternary)]"
                  title="重新校验"
                >
                  <RefreshCw size={9} />
                </button>
              </>
            ) : null}
            {justSaved && (
              <span className="ml-auto text-emerald-500 animate-pulse">✓ 已保存</span>
            )}
          </div>
        )}
      </div>

      {/* 自动同步开关 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <span className="text-xs text-[var(--color-text)]">自动同步总结</span>
          <p className="text-[10px] text-[var(--color-text-quaternary)] mt-0.5">
            生成总结后自动写入 Obsidian
          </p>
        </div>
        <button
          onClick={handleToggleAutoSync}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            config.autoSync
              ? 'bg-[var(--color-primary)]'
              : 'bg-[var(--color-bg-tertiary)]'
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              config.autoSync ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* 文件夹结构说明 */}
      <div className="pt-1 border-t border-[var(--color-border)]">
        <p className="text-[10px] text-[var(--color-text-quaternary)] leading-relaxed">
          文件结构：
          <code className="px-1 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[9px]">
            Vault/文献笔记/&#123;文献名&#125;/总结.md
          </code>
        </p>
      </div>
    </div>
  );
};
