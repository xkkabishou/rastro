import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFLinkService, PDFViewer as PdfJsViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { PdfToolbar } from './PdfToolbar';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';

import shibaReadingUrl from '../../assets/shiba/shiba-reading.png';

// 配置 pdf.js worker，使用 Vite 本地资源导入（避免 CDN 被 Vite ?import 干扰）
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
/** 缩放范围常量 */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;
const PDF_SELECTION_DEBUG_ENABLED = import.meta.env.DEV;
const PDF_SELECTION_DEBUG_STORAGE_KEY = 'pdf-selection-debug';
const PDF_JS_FONT_FAMILY_RE = /^g_d\d+_f\d+$/i;
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'emoji',
  'math',
  'fangsong',
]);

type NullablePdfJsViewer = PdfJsViewer & {
  setDocument(pdfDocument: PDFDocumentProxy | null): void;
};

type RectSnapshot = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type NodeSnapshot = {
  nodeType: number;
  nodeName: string;
  textPreview: string;
  parentElement: string | null;
};

type SpanSnapshot = {
  element: string;
  textPreview: string;
  rect: RectSnapshot | null;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: string;
  transform: string;
};

type FontFaceSnapshot = {
  family: string;
  status: string;
  style: string;
  weight: string;
  stretch: string;
  loaded: boolean;
};

type FontDebugSnapshot = {
  supported: boolean;
  status: string | null;
  readyResolved: boolean;
  usedFamilies: string[];
  matchingFaces: FontFaceSnapshot[];
  pdfJsInjectedFaces: FontFaceSnapshot[];
  totalFaces: number;
};

type SelectionDebugSnapshot = {
  updatedAt: string;
  selectionText: string;
  selectionInsideViewer: boolean;
  rangeRect: RectSnapshot | null;
  startContainer: NodeSnapshot | null;
  startOffset: number | null;
  endContainer: NodeSnapshot | null;
  endOffset: number | null;
  commonAncestor: NodeSnapshot | null;
  hitSpans: SpanSnapshot[];
  pageRect: RectSnapshot | null;
  textLayerRect: RectSnapshot | null;
  canvasRect: RectSnapshot | null;
  viewerContainerRect: RectSnapshot | null;
  viewerRect: RectSnapshot | null;
  fontDebug: FontDebugSnapshot;
};

type PdfDebugWindow = Window & typeof globalThis & {
  __pdfSelectionDebug__?: SelectionDebugSnapshot | null;
  __pdfFontDebug__?: FontDebugSnapshot | null;
  __setPdfSelectionDebug__?: (enabled: boolean) => void;
};

const roundDebugNumber = (value: number) => Number(value.toFixed(2));

const serializeRect = (rect: DOMRect | DOMRectReadOnly | null | undefined): RectSnapshot | null => {
  if (!rect) return null;
  return {
    top: roundDebugNumber(rect.top),
    left: roundDebugNumber(rect.left),
    right: roundDebugNumber(rect.right),
    bottom: roundDebugNumber(rect.bottom),
    width: roundDebugNumber(rect.width),
    height: roundDebugNumber(rect.height),
  };
};

const previewText = (value: string | null | undefined, maxLength = 120) => {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const elementClassName = (element: Element) => {
  const rawClassName = typeof element.className === 'string' ? element.className : '';
  return rawClassName.trim().split(/\s+/).filter(Boolean).slice(0, 3);
};

const describeElement = (element: Element | null) => {
  if (!element) return null;
  const classes = elementClassName(element);
  const pageNumber = element.getAttribute('data-page-number');
  const base = [
    element.tagName.toLowerCase(),
    ...classes.map((className) => `.${className}`),
  ].join('');
  return pageNumber ? `${base}[data-page-number="${pageNumber}"]` : base;
};

const serializeNode = (node: Node | null): NodeSnapshot | null => {
  if (!node) return null;
  const parentElement = node instanceof Element ? node : node.parentElement;
  return {
    nodeType: node.nodeType,
    nodeName: node.nodeName,
    textPreview: previewText(node.textContent),
    parentElement: describeElement(parentElement),
  };
};

const normalizeFontFamily = (family: string) => family.trim().replace(/^['"]|['"]$/g, '');

const getPdfSelectionDebugEnabled = () => {
  if (!PDF_SELECTION_DEBUG_ENABLED || typeof window === 'undefined') return false;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('pdfSelectionDebug') === '1') return true;
    return window.localStorage.getItem(PDF_SELECTION_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const extractFontFamilies = (fontFamily: string) => (
  fontFamily
    .split(',')
    .map(normalizeFontFamily)
    .filter((family) => family && !GENERIC_FONT_FAMILIES.has(family.toLowerCase()))
);

const serializeFontFace = (fontFace: FontFace): FontFaceSnapshot => {
  const family = normalizeFontFamily(fontFace.family);
  let loaded = fontFace.status === 'loaded';
  if (typeof document !== 'undefined' && 'fonts' in document) {
    loaded = document.fonts.check(`12px "${family}"`);
  }
  return {
    family,
    status: fontFace.status,
    style: fontFace.style,
    weight: fontFace.weight,
    stretch: fontFace.stretch,
    loaded,
  };
};

const collectFontDebugSnapshot = (usedFamilies: string[], readyResolved: boolean): FontDebugSnapshot => {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return {
      supported: false,
      status: null,
      readyResolved,
      usedFamilies: [],
      matchingFaces: [],
      pdfJsInjectedFaces: [],
      totalFaces: 0,
    };
  }

  const fontFaces = Array.from(document.fonts);
  const uniqueUsedFamilies = Array.from(new Set(usedFamilies.map(normalizeFontFamily).filter(Boolean)));
  const matchingFaces = fontFaces
    .filter((fontFace) => uniqueUsedFamilies.includes(normalizeFontFamily(fontFace.family)))
    .map(serializeFontFace);
  const pdfJsInjectedFaces = fontFaces
    .filter((fontFace) => PDF_JS_FONT_FAMILY_RE.test(normalizeFontFamily(fontFace.family)))
    .map(serializeFontFace)
    .slice(0, 12);

  return {
    supported: true,
    status: document.fonts.status,
    readyResolved,
    usedFamilies: uniqueUsedFamilies,
    matchingFaces,
    pdfJsInjectedFaces,
    totalFaces: fontFaces.length,
  };
};

const collectSpanSnapshot = (span: HTMLSpanElement): SpanSnapshot => {
  const computedStyle = window.getComputedStyle(span);
  return {
    element: describeElement(span) ?? 'span',
    textPreview: previewText(span.textContent),
    rect: serializeRect(span.getBoundingClientRect()),
    fontFamily: computedStyle.fontFamily,
    fontSize: computedStyle.fontSize,
    lineHeight: computedStyle.lineHeight,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    letterSpacing: computedStyle.letterSpacing,
    transform: computedStyle.transform,
  };
};

const buildSelectionDebugSnapshot = ({
  selection,
  range,
  container,
  viewer,
  fontsReadyResolved,
}: {
  selection: Selection | null;
  range: Range | null;
  container: HTMLDivElement | null;
  viewer: HTMLDivElement | null;
  fontsReadyResolved: boolean;
}): SelectionDebugSnapshot => {
  const selectionText = selection?.toString() ?? '';
  const commonAncestor = range?.commonAncestorContainer ?? null;
  const selectionInsideViewer = !!container && !!commonAncestor && container.contains(commonAncestor);
  const hitSpanElements = range && container
    ? Array.from(container.querySelectorAll('.textLayer span')).filter((node): node is HTMLSpanElement => {
      if (!(node instanceof HTMLSpanElement)) return false;
      try {
        return range.intersectsNode(node) && !!node.textContent?.trim();
      } catch {
        return false;
      }
    })
    : [];
  const primarySpan = hitSpanElements[0] ?? null;
  const primaryElement = primarySpan
    ?? (range?.startContainer.parentElement?.closest('.textLayer span') as HTMLSpanElement | null);
  const textLayer = primaryElement?.closest('.textLayer')
    ?? (range?.startContainer.parentElement?.closest('.textLayer') as HTMLElement | null);
  const page = primaryElement?.closest('.page')
    ?? textLayer?.closest('.page')
    ?? (range?.startContainer.parentElement?.closest('.page') as HTMLElement | null);
  const canvas = page?.querySelector('canvas') ?? null;
  const hitSpans = hitSpanElements.slice(0, 8).map(collectSpanSnapshot);
  const usedFamilies = Array.from(new Set(hitSpans.flatMap((span) => extractFontFamilies(span.fontFamily))));

  return {
    updatedAt: new Date().toISOString(),
    selectionText,
    selectionInsideViewer,
    rangeRect: serializeRect(range?.getBoundingClientRect()),
    startContainer: serializeNode(range?.startContainer ?? null),
    startOffset: range?.startOffset ?? null,
    endContainer: serializeNode(range?.endContainer ?? null),
    endOffset: range?.endOffset ?? null,
    commonAncestor: serializeNode(commonAncestor),
    hitSpans,
    pageRect: serializeRect(page?.getBoundingClientRect()),
    textLayerRect: serializeRect(textLayer?.getBoundingClientRect()),
    canvasRect: serializeRect(canvas?.getBoundingClientRect()),
    viewerContainerRect: serializeRect(container?.getBoundingClientRect()),
    viewerRect: serializeRect(viewer?.getBoundingClientRect()),
    fontDebug: collectFontDebugSnapshot(usedFamilies, fontsReadyResolved),
  };
};

const resetPdfViewerDocument = (pdfViewer: PdfJsViewer, linkService: PDFLinkService) => {
  (pdfViewer as NullablePdfJsViewer).setDocument(null);
  linkService.setDocument(null);
};

const resolveTranslatedPdfUrl = (
  paths: { translatedPdfPath?: string; bilingualPdfPath?: string } | null | undefined,
) => {
  const filePath = paths?.translatedPdfPath ?? paths?.bilingualPdfPath ?? null;
  return filePath ? convertFileSrc(filePath) : null;
};

const toProgressPercentage = (progress: number) => {
  const normalized = progress > 1 ? progress / 100 : progress;
  return Math.round(Math.min(100, Math.max(0, normalized * 100)));
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
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<{
    text: string;
    x: number;
    y: number;
    placement: 'above' | 'below';
  } | null>(null);
  const [isSelectionDebugEnabled, setIsSelectionDebugEnabled] = useState(getPdfSelectionDebugEnabled);
  const [selectionDebug, setSelectionDebug] = useState<SelectionDebugSnapshot | null>(null);
  const [fontDebug, setFontDebug] = useState<FontDebugSnapshot | null>(
    getPdfSelectionDebugEnabled() ? collectFontDebugSnapshot([], false) : null,
  );

  // 监听全局 store 中的 pdfUrl 变化（来自 Sidebar 文件选择 / Zotero 打开）
  const storePdfUrl = useDocumentStore((s) => s.pdfUrl);
  const translatedPdfUrl = useDocumentStore((s) => s.translatedPdfUrl);
  const bilingualMode = useDocumentStore((s) => s.bilingualMode);
  const ownedObjectUrlRef = useRef<string | null>(null);
  const fontsReadyResolvedRef = useRef(false);
  const latestUsedFamiliesRef = useRef<string[]>([]);
  const sourcePdfUrl = storePdfUrl ?? initialUrl;
  const activePdfUrl = translatedPdfUrl && !bilingualMode ? translatedPdfUrl : sourcePdfUrl;

  useEffect(() => {
    if (!activePdfUrl) {
      if (ownedObjectUrlRef.current) {
        URL.revokeObjectURL(ownedObjectUrlRef.current);
        ownedObjectUrlRef.current = null;
      }
      setUrl(undefined);
      return;
    }

    if (activePdfUrl === url) return;

    if (ownedObjectUrlRef.current) {
      URL.revokeObjectURL(ownedObjectUrlRef.current);
      ownedObjectUrlRef.current = null;
    }
    setUrl(activePdfUrl);
  }, [activePdfUrl, url]);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PdfJsViewer | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);

  useEffect(() => {
    return () => {
      if (ownedObjectUrlRef.current) {
        URL.revokeObjectURL(ownedObjectUrlRef.current);
      }
    };
  }, []);

  // Tauri 原生拖拽事件：获取文件绝对路径 → 注册文档 → 渲染
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== 'drop') return;
        const pdfPath = event.payload.paths.find((p: string) =>
          p.toLowerCase().endsWith('.pdf'),
        );
        if (!pdfPath) return;
        try {
          const doc = await ipcClient.openDocument({ filePath: pdfPath });
          useDocumentStore.getState().setCurrentDocument(doc);
          const assetUrl = convertFileSrc(doc.filePath);
          useDocumentStore.getState().setPdfUrl(assetUrl);
        } catch (err) {
          console.error('打开拖拽文档失败:', err);
        }
      });
    };
    setup();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!PDF_SELECTION_DEBUG_ENABLED) return;

    const debugWindow = window as PdfDebugWindow;
    debugWindow.__setPdfSelectionDebug__ = (enabled: boolean) => {
      try {
        if (enabled) {
          window.localStorage.setItem(PDF_SELECTION_DEBUG_STORAGE_KEY, '1');
        } else {
          window.localStorage.removeItem(PDF_SELECTION_DEBUG_STORAGE_KEY);
        }
      } catch {
        // 忽略存储异常，仍然允许本次会话切换诊断开关
      }
      setIsSelectionDebugEnabled(enabled);
    };

    return () => {
      delete debugWindow.__setPdfSelectionDebug__;
    };
  }, []);

  useEffect(() => {
    if (!PDF_SELECTION_DEBUG_ENABLED) return;
    if (isSelectionDebugEnabled) return;

    setSelectionDebug(null);
    setFontDebug(null);

    const debugWindow = window as PdfDebugWindow;
    debugWindow.__pdfSelectionDebug__ = null;
    debugWindow.__pdfFontDebug__ = null;
  }, [isSelectionDebugEnabled]);

  useEffect(() => {
    if (!PDF_SELECTION_DEBUG_ENABLED || !isSelectionDebugEnabled) return;

    const refreshFontDebug = () => {
      setFontDebug(collectFontDebugSnapshot(latestUsedFamiliesRef.current, fontsReadyResolvedRef.current));
    };

    if (typeof document === 'undefined' || !('fonts' in document)) {
      refreshFontDebug();
      return;
    }

    let disposed = false;
    const fontSet = document.fonts;
    const handleFontSetChange = () => {
      if (disposed) return;
      refreshFontDebug();
    };

    refreshFontDebug();
    void fontSet.ready.then(() => {
      if (disposed) return;
      fontsReadyResolvedRef.current = true;
      refreshFontDebug();
    });

    fontSet.addEventListener('loading', handleFontSetChange);
    fontSet.addEventListener('loadingdone', handleFontSetChange);
    fontSet.addEventListener('loadingerror', handleFontSetChange);

    return () => {
      disposed = true;
      fontSet.removeEventListener('loading', handleFontSetChange);
      fontSet.removeEventListener('loadingdone', handleFontSetChange);
      fontSet.removeEventListener('loadingerror', handleFontSetChange);
    };
  }, [isSelectionDebugEnabled]);

  // 加载 PDF 文档
  useEffect(() => {
    if (!url) {
      setPdf(null);
      setTotalPages(0);
      setCurrentPage(1);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setPdf(null);
    setTotalPages(0);
    setCurrentPage(1);
    setSelectionPopup(null);
    setIsLoading(true);

    const loadPdf = async () => {
      try {
        loadingTask = pdfjsLib.getDocument(url);
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(1);
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
      void loadingTask?.destroy();
    };
  }, [url]);

  // 初始化官方 PDFViewer（legacy viewer，兼容旧版 WebKit / WKWebView）
  useEffect(() => {
    const container = viewerContainerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer || pdfViewerRef.current) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PdfJsViewer({
      container,
      viewer,
      eventBus,
      linkService,
      textLayerMode: 1,
      removePageBorders: false,
      supportsPinchToZoom: false,
    });

    linkService.setViewer(pdfViewer);
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setCurrentPage(pageNumber);
    });
    eventBus.on('pagesloaded', ({ pagesCount }: { pagesCount: number }) => {
      setTotalPages(pagesCount);
    });
    eventBus.on('pagesinit', () => {
      pdfViewer.currentScale = scale;
    });

    pdfViewerRef.current = pdfViewer;
    linkServiceRef.current = linkService;

    return () => {
      resetPdfViewerDocument(pdfViewer, linkService);
      pdfViewerRef.current = null;
      linkServiceRef.current = null;
    };
  }, []);

  // 将文档交给官方 PDFViewer 管理
  useEffect(() => {
    const pdfViewer = pdfViewerRef.current;
    const linkService = linkServiceRef.current;
    if (!pdfViewer || !linkService) return;

    if (!pdf) {
      resetPdfViewerDocument(pdfViewer, linkService);
      return;
    }

    pdfViewer.setDocument(pdf);
    linkService.setDocument(pdf);
  }, [pdf]);

  // 缩放同步到官方 viewer
  useEffect(() => {
    if (pdfViewerRef.current) {
      pdfViewerRef.current.currentScale = scale;
    }
  }, [scale]);

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
    const container = viewerContainerRef.current ?? containerRef.current;
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
  }, [pdf]);

  // 判断拖拽内容是否包含文件
  const hasFiles = useCallback((e: React.DragEvent) => {
    return Array.from(e.dataTransfer.types).includes('Files');
  }, []);

  // 拖拽 PDF 文件打开（仅拦截文件拖拽，文本拖拽放行到 ChatPanel）
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return; // 文本拖拽不拦截
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [hasFiles]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, [hasFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return; // 文本拖拽不拦截，让它冒泡到 ChatPanel
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // PDF 文件打开由 Tauri onDragDropEvent 处理（可获取绝对路径）
  }, [hasFiles]);

  // 翻译全文处理
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const translationJob = useDocumentStore((s) => s.translationJob);
  const translationProgress = useDocumentStore((s) => s.translationProgress);
  const setTranslationJob = useDocumentStore((s) => s.setTranslationJob);
  const setTranslationProgress = useDocumentStore((s) => s.setTranslationProgress);
  const setTranslatedPdfUrl = useDocumentStore((s) => s.setTranslatedPdfUrl);

  useEffect(() => {
    setTranslatedPdfUrl(resolveTranslatedPdfUrl(currentDocument?.cachedTranslation));
  }, [
    currentDocument?.documentId,
    currentDocument?.cachedTranslation?.translatedPdfPath,
    currentDocument?.cachedTranslation?.bilingualPdfPath,
    setTranslatedPdfUrl,
  ]);

  const handleTranslate = useCallback(async () => {
    if (!currentDocument) {
      setTranslationError('请先打开一个 PDF 文档');
      return;
    }
    setTranslationError(null);
    try {
      setTranslationProgress(0);
      setTranslatedPdfUrl(null);
      const job = await ipcClient.requestTranslation({
        documentId: currentDocument.documentId,
        filePath: currentDocument.filePath,
      });
      setTranslationJob(job);
      setTranslationProgress(toProgressPercentage(job.progress));
      setTranslatedPdfUrl(resolveTranslatedPdfUrl(job));
    } catch (err: unknown) {
      console.error('提交翻译任务失败:', err);
      const appErr = err as { code?: string; message?: string } | undefined;
      const code = appErr?.code ?? '';
      let userMessage: string;
      switch (code) {
        case 'PROVIDER_KEY_MISSING':
          userMessage = '请先在设置中配置 API Key';
          break;
        case 'UNSUPPORTED_TRANSLATION_PROVIDER':
          userMessage = '未配置翻译 Provider，请到设置中选择';
          break;
        case 'DOCUMENT_NOT_FOUND':
          userMessage = '文档记录不存在，请重新打开 PDF';
          break;
        case 'ENGINE_UNAVAILABLE':
          userMessage = '翻译引擎未就绪，请稍后重试';
          break;
        case 'ENGINE_PORT_CONFLICT':
          userMessage = '翻译引擎端口被占用，请关闭占用程序后重试';
          break;
        case 'ENGINE_TIMEOUT':
          userMessage = '翻译引擎启动超时，请检查 Python 环境';
          break;
        case 'PYTHON_NOT_FOUND':
          userMessage = '未找到 Python 环境，请先安装 Python 3.10+';
          break;
        default:
          userMessage = appErr?.message ?? '翻译请求失败，请检查控制台日志';
      }
      setTranslationError(userMessage);
    }
  }, [currentDocument, setTranslatedPdfUrl, setTranslationJob, setTranslationProgress]);

  useEffect(() => {
    if (!currentDocument || !translationJob) {
      return;
    }

    if (translationJob.documentId !== currentDocument.documentId) {
      return;
    }

    const isActiveJob = translationJob.status === 'queued' || translationJob.status === 'running';
    if (!isActiveJob) {
      setTranslatedPdfUrl(resolveTranslatedPdfUrl(translationJob));
      return;
    }

    let disposed = false;
    let timerId: number | undefined;

    const pollTranslationJob = async () => {
      try {
        const latestJob = await ipcClient.getTranslationJob(translationJob.jobId);
        if (disposed) {
          return;
        }

        if (useDocumentStore.getState().currentDocument?.documentId !== currentDocument.documentId) {
          return;
        }

        setTranslationJob(latestJob);
        setTranslationProgress(toProgressPercentage(latestJob.progress));
        setTranslatedPdfUrl(resolveTranslatedPdfUrl(latestJob));

        if (latestJob.status === 'queued' || latestJob.status === 'running') {
          timerId = window.setTimeout(() => {
            void pollTranslationJob();
          }, 1000);
        }
      } catch (err) {
        if (disposed) {
          return;
        }
        console.error('轮询翻译任务失败:', err);
        timerId = window.setTimeout(() => {
          void pollTranslationJob();
        }, 1000);
      }
    };

    timerId = window.setTimeout(() => {
      void pollTranslationJob();
    }, 1000);

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    currentDocument,
    setTranslatedPdfUrl,
    setTranslationJob,
    setTranslationProgress,
    translationJob,
  ]);

  const isTranslating = translationJob?.status === 'running' || translationJob?.status === 'queued';
  const hasTranslation = !!translatedPdfUrl || !!currentDocument?.cachedTranslation?.available;

  useEffect(() => {
    const scrollContainer = viewerContainerRef.current;
    if (!scrollContainer) return;

    const updateSelectionPopup = () => {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const selectionText = selection?.toString() ?? '';
        const text = selectionText.trim();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const overlayContainer = containerRef.current;
        const debugSnapshot = isSelectionDebugEnabled
          ? buildSelectionDebugSnapshot({
            selection,
            range,
            container: scrollContainer,
            viewer: viewerRef.current,
            fontsReadyResolved: fontsReadyResolvedRef.current,
          })
          : null;

        if (debugSnapshot) {
          latestUsedFamiliesRef.current = debugSnapshot.fontDebug.usedFamilies;
          setSelectionDebug(debugSnapshot);
          setFontDebug(debugSnapshot.fontDebug);
        }

        if (!text || text.length < 2) {
          setSelectionPopup(null);
          return;
        }

        if (!range) {
          setSelectionPopup(null);
          return;
        }

        const selectionInsideViewer = debugSnapshot?.selectionInsideViewer
          ?? scrollContainer.contains(range.commonAncestorContainer as Node);
        if (!selectionInsideViewer) {
          setSelectionPopup(null);
          return;
        }

        if (!overlayContainer) {
          setSelectionPopup(null);
          return;
        }

        const selectionRects = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .sort((leftRect, rightRect) => (
            leftRect.top - rightRect.top || leftRect.left - rightRect.left
          ));
        const endSpan = range.endContainer.parentElement?.closest('.textLayer span') as HTMLElement | null;
        const anchorRect = selectionRects.at(-1)
          ?? endSpan?.getBoundingClientRect()
          ?? range.getBoundingClientRect();
        const containerRect = overlayContainer.getBoundingClientRect();
        const placement = containerRect.bottom - anchorRect.bottom > 56 ? 'below' : 'above';
        setSelectionPopup({
          text,
          x: anchorRect.right - containerRect.left,
          y: placement === 'above'
            ? anchorRect.top - containerRect.top - 8
            : anchorRect.bottom - containerRect.top + 8,
          placement,
        });
      });
    };

    const handleMouseUp = () => {
      updateSelectionPopup();
    };

    const handleMouseDown = (e: MouseEvent) => {
      // 点击引用按钮本身时不清除
      if ((e.target as HTMLElement)?.closest('.quote-popup-btn')) return;
      setSelectionPopup(null);
    };

    document.addEventListener('selectionchange', updateSelectionPopup);
    scrollContainer.addEventListener('mouseup', handleMouseUp);
    scrollContainer.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('selectionchange', updateSelectionPopup);
      scrollContainer.removeEventListener('mouseup', handleMouseUp);
      scrollContainer.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  useEffect(() => {
    if (!PDF_SELECTION_DEBUG_ENABLED || !isSelectionDebugEnabled || !selectionDebug) return;
    const debugWindow = window as PdfDebugWindow;
    debugWindow.__pdfSelectionDebug__ = selectionDebug;
    console.debug('[pdf-selection-debug]', selectionDebug);
  }, [isSelectionDebugEnabled, selectionDebug]);

  useEffect(() => {
    if (!PDF_SELECTION_DEBUG_ENABLED || !isSelectionDebugEnabled || !fontDebug) return;
    const debugWindow = window as PdfDebugWindow;
    debugWindow.__pdfFontDebug__ = fontDebug;
    console.debug('[pdf-selection-fonts]', fontDebug);
  }, [fontDebug, isSelectionDebugEnabled]);

  const handleQuoteToChat = useCallback((text: string) => {
    // 动态导入避免循环依赖
    import('../../stores/useChatStore').then(({ useChatStore }) => {
      useChatStore.getState().setContextQuote(text);
    });
    setSelectionPopup(null);
    // 清除选区
    window.getSelection()?.removeAllRanges();
  }, []);

  const debugPayload = JSON.stringify({
    selection: selectionDebug,
    fonts: fontDebug,
  }, null, 2);

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
          onTranslate={handleTranslate}
          isTranslating={isTranslating}
          translationProgress={translationProgress}
          hasTranslation={hasTranslation}
        />
      )}

      {/* 翻译错误提示 */}
      {translationError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#fef2f2] dark:bg-[#451a1a] border-b border-[#fca5a5] dark:border-[#7f1d1d] text-[#991b1b] dark:text-[#fca5a5] text-xs font-medium shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="flex-1">{translationError}</span>
          <button
            onClick={() => setTranslationError(null)}
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* PDF 渲染区域 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
      >
        {/* 浮动引用按钮 — 选中文字后弹出 */}
        {selectionPopup && (
          <button
            className="quote-popup-btn absolute z-[100] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium shadow-lg hover:opacity-90 transition-opacity whitespace-nowrap"
            style={{
              left: selectionPopup.x,
              top: selectionPopup.y,
              transform: selectionPopup.placement === 'above'
                ? 'translate(-100%, -100%)'
                : 'translate(-100%, 0)',
            }}
            onClick={() => handleQuoteToChat(selectionPopup.text)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            引用到对话
          </button>
        )}

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
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-bg-secondary)]/90">
            <div className="flex flex-col items-center gap-3 text-[var(--color-text-tertiary)]">
              <div className="w-8 h-8 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          </div>
        )}

        <div
          ref={viewerContainerRef}
          className={`absolute inset-0 overflow-auto ${pdf && !isLoading ? '' : 'pointer-events-none opacity-0'}`}
        >
          <div
            ref={viewerRef}
            className="pdfViewer p-6"
          />
        </div>

        {isSelectionDebugEnabled && (
          <aside className="absolute right-3 bottom-3 z-[110] w-[min(32rem,calc(100%-1.5rem))] max-h-[40vh] overflow-auto rounded-lg border border-black/10 bg-black/80 text-white shadow-xl backdrop-blur-sm">
            <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-black/85 px-3 py-2 text-[11px] font-semibold tracking-[0.02em]">
              <span>PDF 选区诊断 DEV</span>
              <div className="flex items-center gap-2">
                <span className="font-normal text-white/70">
                  {selectionDebug?.updatedAt ?? '等待选区'}
                </span>
                <button
                  type="button"
                  className="rounded border border-white/15 px-2 py-1 text-[10px] font-medium text-white/80 transition-colors hover:bg-white/10"
                  onClick={() => {
                    void navigator.clipboard.writeText(debugPayload).catch((error) => {
                      console.error('复制 PDF 诊断失败:', error);
                    });
                  }}
                >
                  复制 JSON
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap break-all px-3 py-2 text-[11px] leading-5">
              {debugPayload}
            </pre>
          </aside>
        )}

        {!pdf && !isLoading && !isDragging && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-[var(--color-text-quaternary)]">
              <img src={shibaReadingUrl} alt="" className="w-[120px] h-auto opacity-80" />
              <span className="text-sm">拖拽 PDF 文件到此处打开</span>
              <span className="text-xs text-[var(--color-text-quaternary)]">或使用侧边栏选择文档</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
