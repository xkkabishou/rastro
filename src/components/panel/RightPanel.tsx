import React, { useState } from 'react';
import { X, MessageSquare, Settings, BookOpen, Highlighter } from 'lucide-react';
import { ChatPanel } from '../chat-panel/ChatPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { AnnotationPanel } from '../annotations/AnnotationPanel';

type PanelTab = 'chat' | 'annotations' | 'settings' | 'summary';

interface RightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  activeTab?: PanelTab;
  onTabChange?: (tab: PanelTab) => void;
  /** 外部控制宽度（桌面端拖拽调整） */
  width?: number;
  /** 拖拽中禁用动画 */
  isResizing?: boolean;
}

export const RightPanel = ({ isOpen, onToggle, activeTab: controlledTab, onTabChange, width, isResizing }: RightPanelProps) => {
  const effectiveWidth = width ?? 360;
  const [internalTab, setInternalTab] = useState<PanelTab>('chat');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;

  // 动画期间禁用 backdrop-blur（直接操作 DOM 避免 setState 重渲染）
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onStart = () => { el.style.backdropFilter = 'none'; (el.style as unknown as Record<string, string>).webkitBackdropFilter = 'none'; };
    const onEnd = () => { el.style.backdropFilter = ''; (el.style as unknown as Record<string, string>).webkitBackdropFilter = ''; };
    el.addEventListener('transitionstart', onStart);
    el.addEventListener('transitionend', onEnd);
    el.addEventListener('transitioncancel', onEnd);
    return () => {
      el.removeEventListener('transitionstart', onStart);
      el.removeEventListener('transitionend', onEnd);
      el.removeEventListener('transitioncancel', onEnd);
    };
  }, []);

  return (
    <aside
      ref={panelRef}
      style={{
        width: isOpen ? effectiveWidth : 0,
        transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'width',
      }}
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
            icon={<Highlighter size={14} />}
            label="标注"
            active={activeTab === 'annotations'}
            onClick={() => setActiveTab('annotations')}
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
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </aside>
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
