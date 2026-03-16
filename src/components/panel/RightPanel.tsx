import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Settings, BookOpen, Globe } from 'lucide-react';
import { ChatPanel } from '../chat-panel/ChatPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { NotebookLMView } from '../notebooklm/NotebookLMView';

type PanelTab = 'chat' | 'settings' | 'summary' | 'notebooklm';

interface RightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  activeTab?: PanelTab;
  onTabChange?: (tab: PanelTab) => void;
}

export const RightPanel = ({ isOpen, onToggle, activeTab: controlledTab, onTabChange }: RightPanelProps) => {
  const [internalTab, setInternalTab] = useState<PanelTab>('chat');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
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
}> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 px-1 py-2 text-xs font-medium border-b-2 transition-colors ${
      active
        ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
        : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
    }`}
  >
    {icon}
    {label}
  </button>
);
