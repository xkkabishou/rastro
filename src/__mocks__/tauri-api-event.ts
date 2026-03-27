// Tauri event API mock
import { vi } from 'vitest';

export const listen = vi.fn(async () => () => {});
export const emit = vi.fn();
export const once = vi.fn(async () => () => {});
