// PDF 拖放处理 Hook
// 从 PdfViewer.tsx 中提取的拖拽逻辑（DOM 事件 + Tauri 原生 drop 事件）
import { useEffect, useState, useCallback } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipcClient } from './ipc-client';
import { useDocumentStore } from '../stores/useDocumentStore';

/**
 * 管理 PDF 文件的拖拽交互
 * - DOM 层：维护 isDragging 状态、过滤非文件拖拽
 * - Tauri 原生层：监听 onDragDropEvent 获取文件绝对路径并打开文档
 *
 * @returns isDragging 状态和 DOM 拖拽事件回调
 */
export function usePdfDragDrop() {
  const [isDragging, setIsDragging] = useState(false);

  // 判断拖拽内容是否包含文件
  const hasFiles = useCallback((e: React.DragEvent) => {
    return Array.from(e.dataTransfer.types).includes('Files');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [hasFiles]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, [hasFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return; // 文本拖拽不拦截，让它冒泡到 ChatPanel
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // PDF 文件打开由 Tauri onDragDropEvent 处理（可获取绝对路径）
  }, [hasFiles]);

  // Tauri 原生拖拽事件：获取文件绝对路径 → 注册文档 → 渲染
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== 'drop') return;
        const pdfPath = event.payload.paths.find((p: string) =>
          p.toLowerCase().endsWith('.pdf'),
        );
        if (!pdfPath) return;
        try {
          const doc = await ipcClient.openDocument({ filePath: pdfPath });
          useDocumentStore.getState().setCurrentDocument(doc);
          const assetUrl = convertFileSrc(doc.filePath);
          useDocumentStore.getState().setPdfUrl(assetUrl);
        } catch (err) {
          console.error('打开拖拽文档失败:', err);
        }
      });
    };
    setup();
    return () => unlisten?.();
  }, []);

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
}
