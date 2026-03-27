/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';

// vitest 配置——仅用于不依赖 Tauri 运行时的纯逻辑单元测试
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      // Tauri API 在 node 环境不可用，指向本地 mock
      '@tauri-apps/api/core': path.resolve(__dirname, 'src/__mocks__/tauri-api-core.ts'),
      '@tauri-apps/api/webview': path.resolve(__dirname, 'src/__mocks__/tauri-api-webview.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, 'src/__mocks__/tauri-api-event.ts'),
    },
  },
});
