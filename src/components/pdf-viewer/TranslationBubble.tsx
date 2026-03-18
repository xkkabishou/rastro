import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 超长文本截断阈值 */
const MAX_TEXT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TranslationBubbleProps {
  /** 待翻译的文本 */
  text: string;
  /** 相对于容器的 x 坐标（px） */
  x: number;
  /** 相对于容器的 y 坐标（px） */
  y: number;
  /** 弹出方向 */
  placement: 'above' | 'below';
  /** 关闭回调 */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 翻译结果气泡 — 调用 translate_text IPC 并展示翻译结果
 *
 * 包含三种状态：
 * 1. loading（spinner 旋转）
 * 2. 翻译成功（展示中文翻译文本）
 * 3. 错误态（友好提示）
 */
export const TranslationBubble: React.FC<TranslationBubbleProps> = ({
  text,
  x,
  y,
  placement,
  onClose,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [translatedText, setTranslatedText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [truncated, setTruncated] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const abortedRef = useRef(false);

  // 发起翻译请求
  useEffect(() => {
    abortedRef.current = false;
    setStatus('loading');
    setTranslatedText('');
    setErrorMessage('');
    setTruncated(false);

    // 超长文本截断
    const inputText = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH)
      : text;
    const isTruncated = text.length > MAX_TEXT_LENGTH;

    ipcClient.translateText(inputText)
      .then((result) => {
        if (abortedRef.current) return;
        setTranslatedText(result.translated);
        setTruncated(isTruncated);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (abortedRef.current) return;
        // 解析错误消息
        const appError = err as { code?: string; message?: string } | undefined;
        if (appError?.code === 'PROVIDER_NOT_CONFIGURED' || appError?.code === 'NO_ACTIVE_PROVIDER') {
          setErrorMessage('请先在设置中配置翻译 API');
        } else {
          setErrorMessage(appError?.message ?? '翻译失败，请稍后重试');
        }
        setStatus('error');
      });

    return () => {
      abortedRef.current = true;
    };
  }, [text]);

  // 点击外部关闭
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
      // 不要在 SelectionPopupMenu 按钮上关闭
      if ((e.target as HTMLElement)?.closest('.selection-popup-menu')) return;
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  return (
    <AnimatePresence>
      <motion.div
        ref={bubbleRef}
        className="absolute z-[101] w-80 max-w-[90vw] rounded-xl backdrop-blur-2xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl"
        style={{
          backgroundColor: 'rgba(255, 251, 245, 0.38)',
          left: x,
          top: placement === 'below' ? y + 8 : y,
          transform: placement === 'above'
            ? 'translate(-50%, -100%)'
            : 'translate(-50%, 0)',
        }}
        initial={{ opacity: 0, scale: 0.9, y: placement === 'above' ? 4 : -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: placement === 'above' ? 4 : -4 }}
        transition={{ duration: 0.15 }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-black/5 dark:border-white/10">
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            翻译结果
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[var(--color-text-tertiary)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="px-3 py-2.5 min-h-[40px] max-h-[200px] overflow-y-auto">
          {/* Loading 态 */}
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">正在翻译...</span>
            </div>
          )}

          {/* 成功态 */}
          {status === 'success' && (
            <div>
              <p className="text-sm leading-relaxed text-[var(--color-text)] select-text">
                {translatedText}
              </p>
              {truncated && (
                <p className="mt-1.5 text-[10px] text-[var(--color-text-quaternary)]">
                  ⚠ 原文过长，已截断至 {MAX_TEXT_LENGTH} 字符后翻译
                </p>
              )}
            </div>
          )}

          {/* 错误态 */}
          {status === 'error' && (
            <div className="flex items-start gap-2 text-[var(--color-destructive)]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="text-xs leading-relaxed">{errorMessage}</span>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
