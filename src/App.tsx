import React, { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { PdfViewer } from "./components/pdf-viewer/PdfViewer";
import { initDocumentEventListeners } from "./stores/useDocumentStore";

function App() {
  useEffect(() => {
    initDocumentEventListeners();
  }, []);

  return (
    <AppLayout>
      <PdfViewer />
    </AppLayout>
  );
}

export default App;
