import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { PdfToolbar } from './PdfToolbar';

// 配置 pdf.js worker，避免主线程阻塞
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

/** 缩放范围常量 */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;

/** 预加载页面数 (前后各 N 页) */
const PRELOAD_PAGES = 2;

/** 单页渲染组件 props */
interface PageCanvasProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  isVisible: boolean;
}

/** 单页 Canvas 渲染 */
const PageCanvas: React.FC<PageCanvasProps> = ({ pdf, pageNumber, scale, isVisible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    const renderPage = async () => {
      try {
        const page: PDFPageProxy = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: scale * 1.5 }); // 1.5x 提升渲染清晰度

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // 取消正在进行的渲染
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        setPageSize({ width: viewport.width, height: viewport.height });

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        renderTaskRef.current = page.render(renderContext as any);
        await renderTaskRef.current.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error(`渲染第 ${pageNumber} 页失败:`, err);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, scale, isVisible]);

  return (
    <div
      className="flex justify-center mb-2"
      data-page-number={pageNumber}
    >
      <canvas
        ref={canvasRef}
        className="shadow-card rounded-md"
        style={pageSize ? {
          width: pageSize.width / 1.5, // 按 CSS 像素还原显示尺寸
          height: pageSize.height / 1.5,
        } : undefined}
      />
    </div>
  );
};

/** PdfViewer 主组件 */
export const PdfViewer = ({ url: initialUrl }: { url?: string }) => {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(ZOOM_DEFAULT);
  const [url, setUrl] = useState<string | undefined>(initialUrl);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 加载 PDF 文档
  useEffect(() => {
    if (!url) {
      setPdf(null);
      setTotalPages(0);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(1);

        // 初始可见页面
        const initialVisible = new Set<number>();
        for (let i = 1; i <= Math.min(1 + PRELOAD_PAGES, pdfDoc.numPages); i++) {
          initialVisible.add(i);
        }
        setVisiblePages(initialVisible);
      } catch (err) {
        if (!cancelled) {
          console.error("PDF 加载失败:", err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Intersection Observer 实现懒加载 + 当前页检测
  useEffect(() => {
    if (!containerRef.current || totalPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const newVisible = new Set(visiblePages);
        let topMostPage = currentPage;
        let topMostRatio = 0;

        entries.forEach((entry) => {
          const pageNum = Number(entry.target.getAttribute('data-page-sentinel'));
          if (isNaN(pageNum)) return;

          if (entry.isIntersecting) {
            // 将该页及前后 PRELOAD_PAGES 页加入可见集
            for (let i = Math.max(1, pageNum - PRELOAD_PAGES); i <= Math.min(totalPages, pageNum + PRELOAD_PAGES); i++) {
              newVisible.add(i);
            }

            if (entry.intersectionRatio > topMostRatio) {
              topMostRatio = entry.intersectionRatio;
              topMostPage = pageNum;
            }
          }
        });

        setVisiblePages(newVisible);
        if (topMostRatio > 0) {
          setCurrentPage(topMostPage);
        }
      },
      {
        root: containerRef.current,
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
        rootMargin: "200px 0px",
      }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, [totalPages, currentPage, visiblePages]);

  // 注册 sentinel 元素到 Observer
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (node && observerRef.current) {
      observerRef.current.observe(node);
    }
  }, []);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + ZOOM_STEP, ZOOM_MAX));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - ZOOM_STEP, ZOOM_MIN));
  }, []);

  const handleZoomReset = useCallback(() => {
    setScale(ZOOM_DEFAULT);
  }, []);

  // Ctrl+滚轮缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale(prev => Math.min(Math.max(prev + delta, ZOOM_MIN), ZOOM_MAX));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // 拖拽 PDF 文件打开
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      }
    }
  }, []);

  return (
    <div
      className="flex-1 w-full h-full flex flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 工具栏 */}
      {pdf && (
        <PdfToolbar
          currentPage={currentPage}
          totalPages={totalPages}
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
      )}

      {/* PDF 渲染区域 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
      >
        {/* 拖拽覆盖层 */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-primary)]/5 border-2 border-dashed border-[var(--color-primary)] rounded-lg m-4 transition-all">
            <div className="flex flex-col items-center gap-2 text-[var(--color-primary)]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-sm font-medium">放开以打开 PDF</span>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-[var(--color-text-tertiary)]">
              <div className="w-8 h-8 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          </div>
        )}

        {pdf && !isLoading && (
          <div className="p-6 space-y-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                data-page-sentinel={pageNum}
                ref={sentinelRef}
              >
                <PageCanvas
                  pdf={pdf}
                  pageNumber={pageNum}
                  scale={scale}
                  isVisible={visiblePages.has(pageNum)}
                />
              </div>
            ))}
          </div>
        )}

        {!pdf && !isLoading && !isDragging && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-[var(--color-text-quaternary)]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-40">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="text-sm">拖拽 PDF 文件到此处打开</span>
              <span className="text-xs text-[var(--color-text-quaternary)]">或使用侧边栏选择文档</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
