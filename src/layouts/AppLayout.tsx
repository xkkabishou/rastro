import React, { useState, useEffect } from 'react';
import { Sidebar } from '../components/sidebar/Sidebar';
import { RightPanel } from '../components/panel/RightPanel';
import { TranslationSwitch } from '../components/pdf-viewer/TranslationSwitch';
import { motion } from 'framer-motion';
import { PanelRightOpen, PanelLeftOpen } from 'lucide-react';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isRightPanelOpen, setRightPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 响应式监听
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1024px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) {
        setSidebarOpen(false); // 小屏幕默认折叠
      } else {
        setSidebarOpen(true);  // 大屏幕默认打开
      }
    };
    
    // 初始化
    handleMediaChange(mql);
    
    // 监听变化
    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)] relative">
      {/* 左侧 Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        isMobile={isMobile}
        onToggle={() => setSidebarOpen(!isSidebarOpen)}
        onOpenSettings={() => setRightPanelOpen(true)}
      />

      {/* 小屏幕下的灰色蒙层 (当 Sidebar 打开时) */}
      {isMobile && isSidebarOpen && (
        <div 
          className="absolute inset-0 z-20 bg-black/20 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 主内容区域（PDF Viewer） */}
      <motion.main
        layout
        className="flex-1 relative h-full flex flex-col bg-[var(--color-bg-secondary)] min-w-0"
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
