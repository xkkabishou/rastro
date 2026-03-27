// safeInvoke 单元测试
// 验证 IPC 封装层的错误处理、类型透传和异常归一化逻辑
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ipcClient } from './ipc-client';

// invoke 已被 mock（通过 vitest alias → src/__mocks__/tauri-api-core.ts）
const mockInvoke = vi.mocked(invoke);

describe('safeInvoke（通过 ipcClient 间接测试）', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ----- 正常路径 -----

  it('成功调用时返回后端数据', async () => {
    const mockHealth = { status: 'ok', version: '1.0.0' };
    mockInvoke.mockResolvedValueOnce(mockHealth);

    const result = await ipcClient.getBackendHealth();
    expect(result).toEqual(mockHealth);
    expect(mockInvoke).toHaveBeenCalledWith('get_backend_health', undefined);
  });

  it('正确传递参数到 invoke', async () => {
    const mockDoc = { documentId: 'doc-1', filePath: '/test.pdf' };
    mockInvoke.mockResolvedValueOnce(mockDoc);

    await ipcClient.openDocument({ filePath: '/test.pdf' });
    expect(mockInvoke).toHaveBeenCalledWith(
      'open_document',
      expect.objectContaining({ filePath: '/test.pdf' }),
    );
  });

  // ----- AppError 透传 -----

  it('后端返回 AppError 时原样透传', async () => {
    const appError = {
      code: 'DOCUMENT_NOT_FOUND',
      message: '文档不存在',
      retryable: false,
    };
    mockInvoke.mockRejectedValueOnce(appError);

    await expect(ipcClient.getBackendHealth()).rejects.toEqual(appError);
  });

  it('AppError 保留 retryable 标记', async () => {
    const retryableError = {
      code: 'ENGINE_BUSY',
      message: '引擎忙',
      retryable: true,
    };
    mockInvoke.mockRejectedValueOnce(retryableError);

    try {
      await ipcClient.getBackendHealth();
      expect.unreachable('应该抛出异常');
    } catch (err: unknown) {
      const e = err as { code: string; retryable: boolean };
      expect(e.code).toBe('ENGINE_BUSY');
      expect(e.retryable).toBe(true);
    }
  });

  // ----- 非结构化错误归一化 -----

  it('字符串错误被包装为 INTERNAL_ERROR', async () => {
    mockInvoke.mockRejectedValueOnce('connection refused');

    try {
      await ipcClient.getBackendHealth();
      expect.unreachable('应该抛出异常');
    } catch (err: unknown) {
      const e = err as { code: string; message: string; retryable: boolean };
      expect(e.code).toBe('INTERNAL_ERROR');
      expect(e.message).toBe('connection refused');
      expect(e.retryable).toBe(false);
    }
  });

  it('非字符串非 AppError 错误被包装为通用错误信息', async () => {
    mockInvoke.mockRejectedValueOnce(42);

    try {
      await ipcClient.getBackendHealth();
      expect.unreachable('应该抛出异常');
    } catch (err: unknown) {
      const e = err as { code: string; message: string };
      expect(e.code).toBe('INTERNAL_ERROR');
      expect(e.message).toContain('IPC');
    }
  });

  it('undefined 错误被包装为 INTERNAL_ERROR', async () => {
    mockInvoke.mockRejectedValueOnce(undefined);

    try {
      await ipcClient.getBackendHealth();
      expect.unreachable('应该抛出异常');
    } catch (err: unknown) {
      const e = err as { code: string };
      expect(e.code).toBe('INTERNAL_ERROR');
    }
  });
});
