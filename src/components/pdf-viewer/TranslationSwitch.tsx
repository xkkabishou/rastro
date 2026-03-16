import React, { useEffect, useCallback } from 'react';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { motion } from 'framer-motion';

/**
 * 翻译 PDF 切换组件
 * T2.3.2 [REQ-012]
 *
 * 功能：
 * - 翻译完成后显示 [原文 | 译文] 分段控件，当前选中状态高亮
 * - 按住 Option/Alt 键切换到原文 PDF（快捷方式兼容）
 * - 松开恢复译文
 * - 侧栏点击 "翻译 PDF" 子项时自动同步为 "译文" 选中
 * - 翻译进行中显示进度骨架屏
 * - 文档没有翻译时不显示
 */
export const TranslationSwitch: React.FC = () => {
  const {
    bilingualMode,
    setBilingualMode,
    translationJob,
    translationProgress,
    translatedPdfUrl,
    currentDocument,
  } = useDocumentStore();
  const isTranslationActive = translationJob?.status === 'queued' || translationJob?.status === 'running';

  // 是否有可用翻译（通过 currentDocument 的 cachedTranslation 判断）
  const hasTranslation = !!(translatedPdfUrl || currentDocument?.cachedTranslation?.available);

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

  // 主动切换原文/译文
  const handleSegmentClick = useCallback(
    (showOriginal: boolean) => {
      setBilingualMode(showOriginal);
    },
    [setBilingualMode],
  );

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

  // 翻译完成且有翻译可用 — 分段控件
  if (hasTranslation) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl shadow-md flex items-center overflow-hidden"
        >
          {/* 分段控件 */}
          <div className="flex items-center p-0.5 gap-0.5">
            {/* 原文按钮 */}
            <button
              onClick={() => handleSegmentClick(true)}
              className={`px-3 py-1 text-[10px] font-medium rounded-lg transition-all duration-200 ${
                bilingualMode
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
              }`}
            >
              原文
            </button>
            {/* 译文按钮 */}
            <button
              onClick={() => handleSegmentClick(false)}
              className={`px-3 py-1 text-[10px] font-medium rounded-lg transition-all duration-200 ${
                !bilingualMode
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
              }`}
            >
              译文
            </button>
          </div>
          {/* Option 键提示 */}
          <span className="text-[9px] text-[var(--color-text-quaternary)] pr-2.5 pl-1">
            ⌥
          </span>
        </motion.div>
      </div>
    );
  }

  return null;
};
