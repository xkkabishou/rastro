import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareQuote, Languages } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectionPopupMenuProps {
  /** 浮窗是否可见（控制 AnimatePresence） */
  visible: boolean;
  /** 相对于容器的 x 坐标（px） */
  x: number;
  /** 相对于容器的 y 坐标（px） */
  y: number;
  /** 弹出方向：above = 选区上方，below = 选区下方 */
  placement: 'above' | 'below';
  /** 选中的文本 */
  selectedText: string;
  /** 「引用到对话」回调 */
  onQuote: (text: string) => void;
  /** 「翻译」回调 */
  onTranslate: (text: string) => void;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 毛玻璃选词浮窗菜单 — 替代旧版单按钮弹窗
 *
 * 包含两个选项：「引用到对话」和「翻译」
 * 样式参考 NotePopup.tsx 的毛玻璃风格
 */
export const SelectionPopupMenu: React.FC<SelectionPopupMenuProps> = ({
  visible,
  x,
  y,
  placement,
  selectedText,
  onQuote,
  onTranslate,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="selection-popup-menu absolute z-[100] flex items-center gap-0.5 p-1 rounded-xl backdrop-blur-2xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl"
          style={{
            backgroundColor: 'rgba(255, 251, 245, 0.38)',
            left: x,
            top: y,
            transform: placement === 'above'
              ? 'translate(-50%, -100%)'
              : 'translate(-50%, 0)',
          }}
          initial={{ opacity: 0, scale: 0.9, y: placement === 'above' ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: placement === 'above' ? 4 : -4 }}
          transition={{ duration: 0.15 }}
        >
          {/* 引用到对话 */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text)] hover:bg-white/40 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            onClick={() => onQuote(selectedText)}
          >
            <MessageSquareQuote size={13} strokeWidth={2.2} />
            引用到对话
          </button>

          {/* 分隔线 */}
          <div className="w-px h-4 bg-black/10 dark:bg-white/15 shrink-0" />

          {/* 翻译 */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text)] hover:bg-white/40 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            onClick={() => onTranslate(selectedText)}
          >
            <Languages size={13} strokeWidth={2.2} />
            翻译
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
