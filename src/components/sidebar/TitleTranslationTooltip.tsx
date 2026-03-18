import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages } from 'lucide-react';

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
 * 样式 100% 对齐 TranslationBubble（glass-panel + 暖金色设计变量）：
 * - backgroundColor: rgba(255, 240, 200, 0.35)
 * - backdrop-blur-xl + backdrop-saturate-150
 * - border border-white/30 dark:border-white/10
 * - shadow-xl + rounded-xl
 * - 动画: scale 0.9 → 1, duration 0.15
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

  const adjustedX = Math.min(anchorX, window.innerWidth - tooltipWidth - padding);
  const adjustedY =
    anchorY + tooltipMaxHeight + padding > window.innerHeight
      ? anchorY - tooltipMaxHeight - 8 // 上方显示
      : anchorY + 4; // 下方显示

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -4 }}
          transition={{ duration: 0.15 }}
          className="fixed z-[200] rounded-xl backdrop-blur-xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl pointer-events-none"
          style={{
            backgroundColor: 'rgba(255, 240, 200, 0.35)',
            left: adjustedX,
            top: adjustedY,
            maxWidth: tooltipWidth,
            minWidth: 160,
          }}
        >
          {/* 内容区域 — 对齐 TranslationBubble 的 px-3 py-2.5 */}
          <div className="flex items-start gap-2 px-3 py-2.5">
            {/* 翻译图标 */}
            <div className="shrink-0 mt-0.5">
              <Languages
                size={14}
                className="text-[var(--color-text-tertiary)]"
              />
            </div>

            {/* 翻译文本 */}
            <div className="min-w-0 flex-1">
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
