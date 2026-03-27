// Tauri API core mock — 提供 invoke 的可控替身
// vitest 通过 alias 将 '@tauri-apps/api/core' 指向此文件
import { vi } from 'vitest';

// 默认的 mock invoke 函数，测试中通过 vi.mocked(invoke) 控制行为
export const invoke = vi.fn();

// convertFileSrc 简化实现
export const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
