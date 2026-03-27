// 翻译任务轮询 Hook
// 从 PdfViewer.tsx 中提取的翻译全文处理 + 轮询逻辑
import { useEffect, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipcClient } from './ipc-client';
import { useDocumentStore } from '../stores/useDocumentStore';
import type { DocumentSnapshot, TranslationJobDto } from '../shared/types';

/** 翻译任务轮询间隔（毫秒） */
const FALLBACK_TRANSLATION_POLL_MS = 5000;

/** 从翻译结果中解析 PDF 预览 URL */
export const resolveTranslatedPdfUrl = (
  paths: { translatedPdfPath?: string; bilingualPdfPath?: string } | null | undefined,
) => {
  const filePath = paths?.translatedPdfPath ?? paths?.bilingualPdfPath ?? null;
  return filePath ? convertFileSrc(filePath) : null;
};

/** 将后端进度值归一化为 0-100 整数百分比 */
export const toProgressPercentage = (progress: number) => {
  const normalized = progress > 1 ? progress / 100 : progress;
  return Math.round(Math.min(100, Math.max(0, normalized * 100)));
};

/**
 * 管理翻译任务的发起、轮询和状态同步
 *
 * - 监听 cachedTranslation 变化自动设置已翻译 PDF URL
 * - 发起翻译请求后启动定时轮询
 * - 翻译任务完成/失败/取消时自动停止轮询
 *
 * @param currentDocument 当前打开的文档快照
 */
export function useTranslationPoller(currentDocument: DocumentSnapshot | null) {
  const translationJob = useDocumentStore((s) => s.translationJob);
  const translationProgress = useDocumentStore((s) => s.translationProgress);
  const setTranslationJob = useDocumentStore((s) => s.setTranslationJob);
  const setTranslationProgress = useDocumentStore((s) => s.setTranslationProgress);
  const setTranslatedPdfUrl = useDocumentStore((s) => s.setTranslatedPdfUrl);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const currentDocumentId = currentDocument?.documentId;
  const cachedTranslatedPdfPath = currentDocument?.cachedTranslation?.translatedPdfPath;
  const cachedBilingualPdfPath = currentDocument?.cachedTranslation?.bilingualPdfPath;

  // 更新已缓存的翻译 PDF URL
  useEffect(() => {
    setTranslatedPdfUrl(resolveTranslatedPdfUrl(currentDocument?.cachedTranslation));
  }, [
    currentDocumentId,
    cachedTranslatedPdfPath,
    cachedBilingualPdfPath,
    setTranslatedPdfUrl,
  ]);

  // 发起翻译请求
  const handleTranslate = useCallback(async () => {
    if (!currentDocument) {
      setTranslationError('请先打开一个 PDF 文档');
      return;
    }
    setTranslationError(null);
    try {
      setTranslationProgress(0);
      setTranslatedPdfUrl(null);
      const job = await ipcClient.requestTranslation({
        documentId: currentDocument.documentId,
        filePath: currentDocument.filePath,
      });
      setTranslationJob(job);
      setTranslationProgress(toProgressPercentage(job.progress));
      setTranslatedPdfUrl(resolveTranslatedPdfUrl(job));
    } catch (err) {
      console.error('翻译请求失败:', err);
      const userMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : '翻译请求失败';
      setTranslationError(userMessage);
    }
  }, [currentDocument, setTranslatedPdfUrl, setTranslationJob, setTranslationProgress]);

  // 监听翻译任务完成状态（非活跃任务的终态处理）
  useEffect(() => {
    if (!currentDocument || !translationJob) {
      return;
    }

    if (translationJob.documentId !== currentDocument.documentId) {
      return;
    }

    const isActiveJob = translationJob.status === 'queued' || translationJob.status === 'running';
    if (!isActiveJob) {
      setTranslatedPdfUrl(resolveTranslatedPdfUrl(translationJob));
      if (translationJob.status === 'failed' || translationJob.status === 'cancelled') {
        setTranslationError(translationJob.errorMessage || `翻译任务${translationJob.status === 'failed' ? '失败' : '已取消'}`);
      }
      return;
    }
  }, [currentDocument?.documentId, setTranslatedPdfUrl, translationJob]);

  // 活跃翻译任务的定时轮询
  const activeJobId = translationJob?.jobId;

  useEffect(() => {
    if (!currentDocument || !translationJob) {
      return;
    }

    if (translationJob.documentId !== currentDocument.documentId) {
      return;
    }

    const isActiveJob = translationJob.status === 'queued' || translationJob.status === 'running';
    if (!isActiveJob) {
      return;
    }

    let disposed = false;
    let timerId: number | undefined;

    const pollTranslationJob = async () => {
      const currentStore = useDocumentStore.getState();
      const liveJob = currentStore.translationJob;
      if (!liveJob || liveJob.jobId !== translationJob.jobId) {
        return;
      }
      if (liveJob.status !== 'queued' && liveJob.status !== 'running') {
        return;
      }
      if (currentStore.currentDocument?.documentId !== currentDocument.documentId) {
        return;
      }

      try {
        const latestJob = await ipcClient.getTranslationJob(translationJob.jobId);
        if (disposed) {
          return;
        }

        if (useDocumentStore.getState().currentDocument?.documentId !== currentDocument.documentId) {
          return;
        }

        setTranslationJob(latestJob);
        setTranslationProgress(toProgressPercentage(latestJob.progress));
        setTranslatedPdfUrl(resolveTranslatedPdfUrl(latestJob));

        if (latestJob.status === 'queued' || latestJob.status === 'running') {
          timerId = window.setTimeout(() => {
            void pollTranslationJob();
          }, FALLBACK_TRANSLATION_POLL_MS);
        } else if (latestJob.status === 'failed' || latestJob.status === 'cancelled') {
          setTranslationError(latestJob.errorMessage || `翻译任务${latestJob.status === 'failed' ? '失败' : '已取消'}`);
        }
      } catch (err) {
        if (disposed) {
          return;
        }
        console.error('轮询翻译任务失败:', err);
        timerId = window.setTimeout(() => {
          void pollTranslationJob();
        }, FALLBACK_TRANSLATION_POLL_MS);
      }
    };

    timerId = window.setTimeout(() => {
      void pollTranslationJob();
    }, FALLBACK_TRANSLATION_POLL_MS);

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    currentDocumentId,
    setTranslatedPdfUrl,
    setTranslationJob,
    setTranslationProgress,
    activeJobId,
  ]);

  const isTranslating = translationJob?.status === 'running' || translationJob?.status === 'queued';
  const hasTranslation = !!currentDocument?.cachedTranslation;

  return {
    translationJob,
    translationProgress,
    translationError,
    isTranslating,
    hasTranslation,
    handleTranslate,
    setTranslationError,
  };
}
