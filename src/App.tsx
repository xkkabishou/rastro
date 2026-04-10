import React, { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { PdfViewer } from "./components/pdf-viewer/PdfViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initDocumentEventListeners } from "./stores/useDocumentStore";

function App() {
  useEffect(() => {
    initDocumentEventListeners();
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
