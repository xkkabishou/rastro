import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, FileText, Library, Menu } from 'lucide-react';
import { ZoteroList } from './ZoteroList';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type SidebarSection = 'recent' | 'zotero';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export const Sidebar = ({ isOpen, onToggle, onOpenSettings }: SidebarProps) => {
  const [activeSection, setActiveSection] = useState<SidebarSection>('recent');

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 260, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="h-full border-r border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-xl overflow-hidden flex flex-col pt-8"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 pb-4 border-b border-[var(--color-separator)] shrink-0">
            <span className="font-semibold px-2 text-[var(--color-text)]">Rastro</span>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md hover:bg-[var(--color-hover)] text-[var(--color-text-tertiary)] transition-colors"
            >
              <Menu size={18} />
            </button>
          </div>

          {/* 导航列表 */}
          <div className="py-2 px-3 space-y-1 shrink-0">
            <NavItem
              icon={<FileText size={18} />}
              label="近期文档"
              active={activeSection === 'recent'}
              onClick={() => setActiveSection('recent')}
            />
            <NavItem
              icon={<Library size={18} />}
              label="Zotero"
              active={activeSection === 'zotero'}
              onClick={() => setActiveSection('zotero')}
            />
          </div>

          {/* 内容区域 — 根据 activeSection 切换 */}
          <div className="flex-1 overflow-hidden border-t border-[var(--color-separator)]">
            {activeSection === 'recent' && (
              <div className="p-4 text-xs text-[var(--color-text-quaternary)] text-center">
                拖拽 PDF 到窗口即可打开
              </div>
            )}
            {activeSection === 'zotero' && (
              <ZoteroList />
            )}
          </div>

          {/* 底部设置 */}
          <div className="p-4 border-t border-[var(--color-separator)] shrink-0">
            <NavItem
              icon={<Settings size={18} />}
              label="设置"
              onClick={onOpenSettings}
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

const NavItem = ({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex flex-shrink-0 whitespace-nowrap items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
      active
        ? 'bg-[var(--color-selected)] text-[var(--color-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
