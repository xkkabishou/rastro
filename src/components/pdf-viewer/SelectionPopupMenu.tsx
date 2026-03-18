import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareQuote, Languages } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectionPopupMenuProps {
  /** 浮窗是否可见（控制 AnimatePresence） */
  visible: boolean;
  /** viewport 坐标 x（px） */
  x: number;
  /** viewport 坐标 y（px） */
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
 * 样式 100% 对齐 NotePopup（glass-panel + 暖金色设计变量）
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
          className="selection-popup-menu fixed z-[200] flex items-center gap-0.5 p-1 rounded-xl backdrop-blur-xl backdrop-saturate-150 border border-white/30 dark:border-white/10 shadow-xl"
          style={{
            backgroundColor: 'rgba(255, 240, 200, 0.35)',
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors whitespace-nowrap"
            onClick={() => onQuote(selectedText)}
          >
            <MessageSquareQuote size={13} strokeWidth={2.2} />
            引用到对话
          </button>

          {/* 分隔线 — 使用设计系统分隔色 */}
          <div className="w-px h-4 bg-[var(--color-separator)] shrink-0" />

          {/* 翻译 */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors whitespace-nowrap"
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
