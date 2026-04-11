import React, { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { PdfViewer } from "./components/pdf-viewer/PdfViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initDocumentEventListeners } from "./stores/useDocumentStore";
import { useObsidianStore } from "./stores/useObsidianStore";

function App() {
  useEffect(() => {
    initDocumentEventListeners();
    // 启动时预加载 Obsidian 配置，让总结面板的"同步到笔记库"按钮
    // 不再需要用户先打开设置面板触发 loadConfig 才能显示
    void useObsidianStore.getState().loadConfig();
  }, []);

  return (
    <ErrorBoundary>
      <AppLayout>
        <PdfViewer />
      </AppLayout>
    </ErrorBoundary>
  );
}

export default App;
