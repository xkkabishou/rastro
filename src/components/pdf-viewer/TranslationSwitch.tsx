import React, { useEffect, useCallback } from 'react';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { motion } from 'framer-motion';

/**
 * 翻译 PDF 切换组件
 * 
 * 功能：
 * - 翻译完成后默认显示译文 PDF
 * - 按住 Option/Alt 键切换到原文 PDF（带渐变淡入动画）
 * - 松开恢复译文
 * - 翻译进行中显示进度骨架屏
 */
export const TranslationSwitch: React.FC = () => {
  const {
    bilingualMode,
    setBilingualMode,
    translationJob,
    translationProgress,
    translatedPdfUrl,
  } = useDocumentStore();
  const isTranslationActive = translationJob?.status === 'queued' || translationJob?.status === 'running';

  // 监听 Option/Alt 键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !bilingualMode) {
        setBilingualMode(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && bilingualMode) {
        setBilingualMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [bilingualMode, setBilingualMode]);

  // 翻译进行中 — 进度骨架屏
  if (translationJob && isTranslationActive) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="glass-panel rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-lg">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--color-text)]">
              正在翻译... {translationProgress}%
            </p>
            <div className="w-32 h-1 rounded-full bg-[var(--color-bg-tertiary)]">
              <motion.div
                className="h-full rounded-full bg-[var(--color-primary)]"
                initial={{ width: 0 }}
                animate={{ width: `${translationProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {translationJob.stage}
          </span>
        </div>
      </div>
    );
  }

  // 翻译完成 — 切换提示
  if (translatedPdfUrl) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl px-3 py-1.5 shadow-md"
        >
          <p className="text-[10px] text-[var(--color-text-secondary)] flex items-center gap-1.5">
            {bilingualMode ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
                原文模式 · 松开 ⌥ Option 恢复译文
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                译文模式 · 按住 ⌥ Option 查看原文
              </>
            )}
          </p>
        </motion.div>
      </div>
    );
  }

  return null;
};
