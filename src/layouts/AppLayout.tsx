import React, { useState } from 'react';
import { Sidebar } from '../components/sidebar/Sidebar';
import { RightPanel } from '../components/panel/RightPanel';
import { TranslationSwitch } from '../components/pdf-viewer/TranslationSwitch';
import { motion } from 'framer-motion';
import { PanelRightOpen, PanelLeftOpen } from 'lucide-react';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isRightPanelOpen, setRightPanelOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* 左侧 Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setSidebarOpen(!isSidebarOpen)}
        onOpenSettings={() => setRightPanelOpen(true)}
      />

      {/* 主内容区域（PDF Viewer） */}
      <motion.main
        layout
        className="flex-1 relative h-full flex flex-col bg-[var(--color-bg-secondary)]"
      >
        {/* 控制按钮 */}
        <div className="absolute top-3 left-3 z-10">
          {!isSidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg bg-[var(--color-bg-overlay)] backdrop-blur-lg shadow-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
              title="打开侧边栏"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
        </div>
        <div className="absolute top-3 right-3 z-10">
          {!isRightPanelOpen && (
            <button
              onClick={() => setRightPanelOpen(true)}
              className="p-2 rounded-lg bg-[var(--color-bg-overlay)] backdrop-blur-lg shadow-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
              title="打开 AI 助手"
            >
              <PanelRightOpen size={18} />
            </button>
          )}
        </div>

        {/* PDF 渲染内容 */}
        <div className="flex-1 h-full overflow-hidden">
          {children}
        </div>

        {/* 翻译状态悬浮层 */}
        <TranslationSwitch />
      </motion.main>

      {/* 右侧面板（Chat/Settings/Summary） */}
      <RightPanel
        isOpen={isRightPanelOpen}
        onToggle={() => setRightPanelOpen(!isRightPanelOpen)}
      />
    </div>
  );
};
