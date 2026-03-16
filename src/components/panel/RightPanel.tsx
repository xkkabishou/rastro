import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Settings, BookOpen, Globe, Highlighter } from 'lucide-react';
import { ChatPanel } from '../chat-panel/ChatPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { NotebookLMView } from '../notebooklm/NotebookLMView';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { useAnnotationStore } from '../../stores/useAnnotationStore';

type PanelTab = 'chat' | 'annotations' | 'settings' | 'summary' | 'notebooklm';

interface RightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  activeTab?: PanelTab;
  onTabChange?: (tab: PanelTab) => void;
  /** 外部控制宽度（桌面端拖拽调整） */
  width?: number;
  /** 拖拽中禁用 spring 动画 */
  isResizing?: boolean;
}

export const RightPanel = ({ isOpen, onToggle, activeTab: controlledTab, onTabChange, width, isResizing }: RightPanelProps) => {
  const effectiveWidth = width ?? 360;
  const [internalTab, setInternalTab] = useState<PanelTab>('chat');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;
  const annotationCount = useAnnotationStore((s) => s.annotations.length);

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: effectiveWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={isResizing
            ? { duration: 0 }
            : { type: "spring", stiffness: 300, damping: 30 }
          }
          className="h-full border-l border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-xl overflow-hidden flex flex-col shadow-[-4px_0_24px_-12px_rgba(0,0,0,0.05)]"
        >
          {/* Tab 栏 */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] shrink-0 pt-7">
            <div className="flex flex-1 px-2">
              <PanelTabButton
                icon={<MessageSquare size={14} />}
                label="对话"
                active={activeTab === 'chat'}
                onClick={() => setActiveTab('chat')}
              />
              <PanelTabButton
                icon={<Highlighter size={14} />}
                label="标注"
                active={activeTab === 'annotations'}
                onClick={() => setActiveTab('annotations')}
                badge={annotationCount > 0 ? annotationCount : undefined}
              />
              <PanelTabButton
                icon={<BookOpen size={14} />}
                label="总结"
                active={activeTab === 'summary'}
                onClick={() => setActiveTab('summary')}
              />
              <PanelTabButton
                icon={<Globe size={14} />}
                label="NLM"
                active={activeTab === 'notebooklm'}
                onClick={() => setActiveTab('notebooklm')}
              />
              <PanelTabButton
                icon={<Settings size={14} />}
                label="设置"
                active={activeTab === 'settings'}
                onClick={() => setActiveTab('settings')}
              />
            </div>
            <button
              onClick={onToggle}
              className="p-1.5 mr-2 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* 面板内容 */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'chat' && <ChatPanel />}
            {activeTab === 'annotations' && <AnnotationPanel />}
            {activeTab === 'summary' && <SummaryPanel />}
            {activeTab === 'notebooklm' && <NotebookLMView />}
            {activeTab === 'settings' && <SettingsPanel />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

/** Tab 按钮 */
const PanelTabButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}> = ({ icon, label, active, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`relative flex-1 flex items-center justify-center gap-1.5 px-1 py-2 text-xs font-medium border-b-2 transition-colors ${
      active
        ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
        : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
    }`}
  >
    {icon}
    {label}
    {badge !== undefined && badge > 0 && (
      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[var(--color-primary)] text-white text-[9px] font-bold px-0.5">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);
