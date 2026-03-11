import React from "react";
import { AppLayout } from "./layouts/AppLayout";
import { PdfViewer } from "./components/pdf-viewer/PdfViewer";

function App() {
  return (
    <AppLayout>
      <PdfViewer />
    </AppLayout>
  );
}

export default App;
