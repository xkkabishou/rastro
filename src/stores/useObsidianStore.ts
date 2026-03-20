// Obsidian 集成状态管理
import { create } from 'zustand';
import { ipcClient } from '../lib/ipc-client';
import type { ObsidianConfigDto, ValidateVaultResult, ExportSummaryResult, ExportChatsResult } from '../shared/types';

interface ObsidianState {
  // 配置
  config: ObsidianConfigDto;
  // 校验状态
  validation: ValidateVaultResult | null;
  isValidating: boolean;
  // 导出状态
  isExporting: boolean;
  exportError: string | null;
  lastExportResult: ExportSummaryResult | null;
  // 加载状态
  isLoading: boolean;
}

interface ObsidianActions {
  /** 从后端加载配置 */
  loadConfig: () => Promise<void>;
  /** 保存 Vault 路径 */
  setVaultPath: (path: string) => Promise<void>;
  /** 切换自动同步开关 */
  setAutoSync: (enabled: boolean) => Promise<void>;
  /** 校验 Vault 路径 */
  validateVault: (path: string) => Promise<ValidateVaultResult>;
  /** 导出总结到 Obsidian */
  exportSummary: (documentId: string, title: string, contentMd: string, summaryType?: string) => Promise<ExportSummaryResult | null>;
  /** 导出聊天记录到 Obsidian */
  exportChats: (documentId: string, title: string, sessionIds: string[]) => Promise<ExportChatsResult | null>;
  /** 自动同步（静默执行） */
  autoSyncSummary: (documentId: string, title: string, contentMd: string) => Promise<void>;
}

const initialConfig: ObsidianConfigDto = {
  vaultPath: null,
  autoSync: false,
};

export const useObsidianStore = create<ObsidianState & ObsidianActions>((set, get) => ({
  // 初始状态
  config: initialConfig,
  validation: null,
  isValidating: false,
  isExporting: false,
  exportError: null,
  lastExportResult: null,
  isLoading: false,

  loadConfig: async () => {
    set({ isLoading: true });
    try {
      const config = await ipcClient.getObsidianConfig();
      set({ config });
      // 如果有路径，自动校验
      if (config.vaultPath) {
        const validation = await get().validateVault(config.vaultPath);
        set({ validation });
      }
    } catch (err) {
      console.error('[Obsidian] 加载配置失败:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  setVaultPath: async (path: string) => {
    try {
      const config = await ipcClient.saveObsidianConfig(path, undefined);
      set({ config });
      // 保存后自动校验
      const validation = await get().validateVault(path);
      set({ validation });
    } catch (err) {
      console.error('[Obsidian] 保存路径失败:', err);
    }
  },

  setAutoSync: async (enabled: boolean) => {
    try {
      const config = await ipcClient.saveObsidianConfig(undefined, enabled);
      set({ config });
    } catch (err) {
      console.error('[Obsidian] 保存自动同步设置失败:', err);
    }
  },

  validateVault: async (path: string): Promise<ValidateVaultResult> => {
    set({ isValidating: true });
    try {
      const validation = await ipcClient.validateObsidianVault(path);
      set({ validation });
      return validation;
    } catch (err) {
      const fallback: ValidateVaultResult = { valid: false, message: '校验失败' };
      set({ validation: fallback });
      return fallback;
    } finally {
      set({ isValidating: false });
    }
  },

  exportSummary: async (documentId, title, contentMd, summaryType) => {
    set({ isExporting: true, exportError: null });
    try {
      const result = await ipcClient.exportSummaryToObsidian(documentId, title, contentMd, summaryType);
      set({ lastExportResult: result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出失败';
      set({ exportError: message });
      return null;
    } finally {
      set({ isExporting: false });
    }
  },

  exportChats: async (documentId, title, sessionIds) => {
    set({ isExporting: true, exportError: null });
    try {
      const result = await ipcClient.exportChatsToObsidian(documentId, title, sessionIds);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出失败';
      set({ exportError: message });
      return null;
    } finally {
      set({ isExporting: false });
    }
  },

  autoSyncSummary: async (documentId, title, contentMd) => {
    const { config, validation } = get();
    // 静默检查：自动同步未启用 或 路径无效时跳过
    if (!config.autoSync || !config.vaultPath || !validation?.valid) {
      return;
    }
    try {
      await ipcClient.exportSummaryToObsidian(documentId, title, contentMd);
    } catch (err) {
      // 自动同步失败只打印警告，不打断用户
      console.warn('[Obsidian 自动同步] 导出失败:', err);
    }
  },
}));
