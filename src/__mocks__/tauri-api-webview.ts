// Tauri webview API mock
import { vi } from 'vitest';

export const getCurrentWebview = vi.fn(() => ({
  onDragDropEvent: vi.fn(async () => () => {}),
}));
