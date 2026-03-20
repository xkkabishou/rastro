import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '../components/sidebar/Sidebar';
import { RightPanel } from '../components/panel/RightPanel';
import { ResizeHandle } from '../components/ui/ResizeHandle';
import { TranslationSwitch } from '../components/pdf-viewer/TranslationSwitch';
import { PanelRightOpen, PanelLeftOpen } from 'lucide-react';

// ---------------------------------------------------------------------------
// 面板宽度常量
// ---------------------------------------------------------------------------

const SIDEBAR_DEFAULT = 280;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const RIGHT_PANEL_DEFAULT = 360;
const RIGHT_PANEL_MIN = 280;
const RIGHT_PANEL_MAX = 600;
const MAIN_MIN = 360;

// localStorage key
const LS_SIDEBAR_WIDTH = 'rastro:layout:sidebar-width';
const LS_RIGHT_PANEL_WIDTH = 'rastro:layout:right-panel-width';

// ---------------------------------------------------------------------------
// localStorage 读写辅助
// ---------------------------------------------------------------------------

/** 从 localStorage 读取面板宽度，带范围校验 */
const readStoredWidth = (key: string, defaultVal: number, min: number, max: number): number => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultVal;
    const val = Number(raw);
    if (Number.isFinite(val) && val >= min && val <= max) return val;
  } catch { /* Tauri WebView 极端情况 */ }
  return defaultVal;
};

/** 写入面板宽度到 localStorage */
const writeStoredWidth = (key: string, val: number) => {
  try {
    localStorage.setItem(key, String(Math.round(val)));
  } catch { /* 静默 */ }
};

/** 清除面板宽度记录 */
const clearStoredWidth = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch { /* 静默 */ }
};

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isRightPanelOpen, setRightPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 面板宽度（从 localStorage 初始化）
  const [sidebarWidth, setSidebarWidth] = useState(
    () => readStoredWidth(LS_SIDEBAR_WIDTH, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(
    () => readStoredWidth(LS_RIGHT_PANEL_WIDTH, RIGHT_PANEL_DEFAULT, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX),
  );

  // 拖拽状态
  const [isResizing, setIsResizing] = useState(false);

  // 响应式监听
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1024px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    handleMediaChange(mql);
    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, []);

  // -------------------------------------------------------------------------
  // 拖拽处理
  // -------------------------------------------------------------------------

  const handleResizeStart = useCallback(() => setIsResizing(true), []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    // 拖拽结束时持久化宽度
    setSidebarWidth((w) => { writeStoredWidth(LS_SIDEBAR_WIDTH, w); return w; });
    setRightPanelWidth((w) => { writeStoredWidth(LS_RIGHT_PANEL_WIDTH, w); return w; });
  }, []);

  // 左侧栏拖拽（delta > 0 = 向右拖 = 变宽）
  const handleLeftResize = useCallback((delta: number) => {
    setSidebarWidth((prev) => {
      const next = prev + delta;
      return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next));
    });
  }, []);

  // 右侧面板拖拽（delta > 0 = 向右拖 = 变窄）
  const handleRightResize = useCallback((delta: number) => {
    setRightPanelWidth((prev) => {
      const next = prev - delta;
      return Math.max(RIGHT_PANEL_MIN, Math.min(RIGHT_PANEL_MAX, next));
    });
  }, []);

  // 双击重置
  const handleLeftDoubleClick = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    clearStoredWidth(LS_SIDEBAR_WIDTH);
  }, []);

  const handleRightDoubleClick = useCallback(() => {
    setRightPanelWidth(RIGHT_PANEL_DEFAULT);
    clearStoredWidth(LS_RIGHT_PANEL_WIDTH);
  }, []);

  // -------------------------------------------------------------------------
  // 窗口缩小保护：确保主内容区 >= MAIN_MIN
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleWindowResize = () => {
      const winWidth = window.innerWidth;
      const leftWidth = isSidebarOpen && !isMobile ? sidebarWidth : 0;
      const rightWidth = isRightPanelOpen ? rightPanelWidth : 0;
      const handleSpace = 0; // ResizeHandle 使用负 margin，不占用 flex 空间
      const mainWidth = winWidth - leftWidth - rightWidth - handleSpace;

      if (mainWidth < MAIN_MIN) {
        let deficit = MAIN_MIN - mainWidth;

        // 优先缩小右面板
        if (rightWidth > RIGHT_PANEL_MIN) {
          const rightReduction = Math.min(deficit, rightWidth - RIGHT_PANEL_MIN);
          setRightPanelWidth((prev) => Math.max(RIGHT_PANEL_MIN, prev - rightReduction));
          deficit -= rightReduction;
        }

        // 仍不够则缩小左侧栏
        if (deficit > 0 && leftWidth > SIDEBAR_MIN) {
          setSidebarWidth((prev) => Math.max(SIDEBAR_MIN, prev - deficit));
        }
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [isSidebarOpen, isRightPanelOpen, isMobile, sidebarWidth, rightPanelWidth]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)] relative">
      {/* 左侧 Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        isMobile={isMobile}
        onToggle={() => setSidebarOpen(!isSidebarOpen)}
        width={sidebarWidth}
        isResizing={isResizing}
      />

      {/* 左侧分隔线（桌面端 + 侧栏展开时显示） */}
      <ResizeHandle
        side="left"
        isVisible={isSidebarOpen && !isMobile}
        onResizeStart={handleResizeStart}
        onResize={handleLeftResize}
        onResizeEnd={handleResizeEnd}
        onDoubleClick={handleLeftDoubleClick}
        currentWidth={sidebarWidth}
        minWidth={SIDEBAR_MIN}
        maxWidth={SIDEBAR_MAX}
      />

      {/* 小屏幕下的灰色蒙层 (当 Sidebar 打开时) */}
      {isMobile && isSidebarOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="关闭侧边栏"
          className="absolute inset-0 z-20 bg-black/20 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSidebarOpen(false);
            }
          }}
        />
      )}

      {/* 主内容区域（PDF Viewer） */}
      <main className="flex-1 relative h-full flex flex-col bg-[var(--color-bg-secondary)] min-w-0">
        {/* 拖拽中覆盖层 — 防止 PDF canvas 吞噬鼠标事件 */}
        {isResizing && (
          <div className="absolute inset-0 z-50" />
        )}

        {/* 控制按钮（带淡入淡出动画） */}
        <div className="absolute top-3 left-3 z-10">
          <AnimatePresence>
            {!isSidebarOpen && (
              <motion.button
                key="sidebar-toggle"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg bg-[var(--color-bg-overlay)] backdrop-blur-lg shadow-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
                aria-label="打开侧边栏"
              >
                <PanelLeftOpen size={18} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <AnimatePresence>
            {!isRightPanelOpen && (
              <motion.button
                key="panel-toggle"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={() => setRightPanelOpen(true)}
                className="p-2 rounded-lg bg-[var(--color-bg-overlay)] backdrop-blur-lg shadow-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] transition-colors"
                aria-label="打开 AI 助手"
              >
                <PanelRightOpen size={18} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* PDF 渲染内容 */}
        <div className="flex-1 h-full overflow-hidden">
          {children}
        </div>

        {/* 翻译状态悬浮层 */}
        <TranslationSwitch />
      </main>

      {/* 右侧分隔线（右面板展开时显示） */}
      <ResizeHandle
        side="right"
        isVisible={isRightPanelOpen && !isMobile}
        onResizeStart={handleResizeStart}
        onResize={handleRightResize}
        onResizeEnd={handleResizeEnd}
        onDoubleClick={handleRightDoubleClick}
        currentWidth={rightPanelWidth}
        minWidth={RIGHT_PANEL_MIN}
        maxWidth={RIGHT_PANEL_MAX}
      />

      {/* 右侧面板（Chat/Settings/Summary） */}
      <RightPanel
        isOpen={isRightPanelOpen}
        onToggle={() => setRightPanelOpen(!isRightPanelOpen)}
        width={rightPanelWidth}
        isResizing={isResizing}
      />
    </div>
  );
};
