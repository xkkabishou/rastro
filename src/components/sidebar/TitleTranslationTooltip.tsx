import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TitleTranslationTooltipProps {
  /** 翻译后的标题（null 表示加载中或无翻译） */
  translatedTitle: string | null;
  /** 是否可见 */
  visible: boolean;
  /** tooltip 锚点位置（相对于视口） */
  anchorX: number;
  anchorY: number;
  /** 是否正在加载 */
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 标题翻译 Tooltip — 毛玻璃设计语言
 *
 * 样式 100% 对齐 TranslationBubble（glass-panel + 暖金色设计变量）。
 * 通过 React Portal 渲染到 document.body，确保不受侧边栏层叠上下文限制。
 */
export const TitleTranslationTooltip: React.FC<TitleTranslationTooltipProps> = ({
  translatedTitle,
  visible,
  anchorX,
  anchorY,
  loading = false,
}) => {
  // 自适应定位：确保不超出视口
  const tooltipWidth = 320;
  const tooltipMaxHeight = 120;
  const padding = 12;

  const adjustedX = Math.min(
    Math.max(padding, anchorX),
    window.innerWidth - tooltipWidth - padding,
  );
  const adjustedY =
    anchorY + tooltipMaxHeight + padding > window.innerHeight
      ? anchorY - tooltipMaxHeight - 8 // 上方显示
      : anchorY + 4; // 下方显示

  // Portal 渲染到 body，脱离侧边栏层叠上下文
  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 600, damping: 35 }}
          className="fixed rounded-xl backdrop-blur-xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl pointer-events-none"
          style={{
            zIndex: 99999,
            backgroundColor: 'rgba(255, 240, 200, 0.35)',
            left: adjustedX,
            top: adjustedY,
            maxWidth: tooltipWidth,
            minWidth: 160,
          }}
        >
          {/* 内容区域 */}
          <div className="px-3 py-2.5">
            {loading ? (
              // 加载骨架屏
              <div className="flex flex-col gap-1.5">
                <div className="h-3 w-4/5 rounded bg-white/30 dark:bg-white/10 animate-pulse" />
                <div className="h-3 w-3/5 rounded bg-white/30 dark:bg-white/10 animate-pulse" />
              </div>
            ) : translatedTitle ? (
              <span className="text-xs leading-relaxed text-[var(--color-text)] block">
                {translatedTitle}
              </span>
            ) : (
              <span className="text-xs text-[var(--color-text-quaternary)] italic">
                暂无翻译
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
