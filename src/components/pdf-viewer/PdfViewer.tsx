import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFLinkService, PDFViewer as PdfJsViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { PdfToolbar } from './PdfToolbar';
import { AnnotationOverlay } from './AnnotationOverlay';
import { AnnotationContextMenu, useAnnotationContextMenu } from './AnnotationContextMenu';
import { NotePopup } from './NotePopup';
import { SelectionPopupMenu } from './SelectionPopupMenu';
import { TranslationBubble } from './TranslationBubble';
import { ipcClient } from '../../lib/ipc-client';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useAnnotationStore } from '../../stores/useAnnotationStore';
import { useAnnotationShortcuts } from '../../lib/useAnnotationShortcuts';
import { selectionToAnnotationRects } from '../../lib/annotation-coords';
import { resolveTranslatedPdfUrl, toProgressPercentage } from '../../lib/useTranslationPoller';

import shibaReadingUrl from '../../assets/shiba/shiba-reading.png';
import shibaLoadingUrl from '../../assets/shiba/shiba-loading.png';
import shibaErrorUrl from '../../assets/shiba/shiba-error.png';

// 配置 pdf.js worker，使用 Vite 本地资源导入（避免 CDN 被 Vite ?import 干扰）
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;


/** 缩放范围常量 */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;
const FALLBACK_TRANSLATION_POLL_MS = 5000;
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
  // 划词翻译气泡状态
  const [translationBubble, setTranslationBubble] = useState<{
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
  // 标注: 页面容器元素跟踪（用于 Portal 注入 AnnotationOverlay）
  const [pageElements, setPageElements] = useState<HTMLElement[]>([]);

  // 右键菜单
  const {
    menu: annotationContextMenu,
    openMenu: openAnnotationContextMenu,
    closeMenu: closeAnnotationContextMenu,
  } = useAnnotationContextMenu();

  // 监听全局 store 中的 pdfUrl 变化（来自 Sidebar 文件选择 / Zotero 打开）
  const storePdfUrl = useDocumentStore((s) => s.pdfUrl);
  const translatedPdfUrl = useDocumentStore((s) => s.translatedPdfUrl);
  const bilingualMode = useDocumentStore((s) => s.bilingualMode);
  const ownedObjectUrlRef = useRef<string | null>(null);
  const fontsReadyResolvedRef = useRef(false);
  const latestUsedFamiliesRef = useRef<string[]>([]);

  // ---------------------------------------------------------------------------
  // 自动缩放：用户最后一次手动设置的缩放值和对应的容器宽度作为比例计算基准
  // ---------------------------------------------------------------------------
  const userSetScaleRef = useRef(ZOOM_DEFAULT);
  const referenceWidthRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>(0);
  /** pagesinit 事件中使用的初始缩放值（fit-to-width 计算结果） */
  const initialScaleRef = useRef(ZOOM_DEFAULT);
  const sourcePdfUrl = storePdfUrl ?? initialUrl;
  const activePdfUrl = translatedPdfUrl && !bilingualMode ? translatedPdfUrl : sourcePdfUrl;

  // 当前文档（标注和翻译都需要，提前声明避免引用顺序问题）
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const currentDocumentId = currentDocument?.documentId;

  // 标注快捷键
  useAnnotationShortcuts();

  // 标注 store
  const annotationActiveTool = useAnnotationStore((s) => s.activeTool);
  const annotationActiveColor = useAnnotationStore((s) => s.activeColor);
  const annotationSetActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const annotationCreateAnnotation = useAnnotationStore((s) => s.createAnnotation);
  const annotationLoadAnnotations = useAnnotationStore((s) => s.loadAnnotations);
  const annotationReset = useAnnotationStore((s) => s.reset);

  // 文档切换时加载标注数据
  useEffect(() => {
    if (currentDocument?.documentId) {
      annotationLoadAnnotations(currentDocument.documentId);
    } else {
      annotationReset();
    }
  }, [currentDocument?.documentId, annotationLoadAnnotations, annotationReset]);

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
      setPageElements([]);
      return;
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    // 先清空 pageElements，防止 createPortal 渲染到即将被移除的旧 DOM 节点
    setPageElements([]);
    setPdf(null);
    setTotalPages(0);
    setCurrentPage(1);
    setSelectionPopup(null);
    setIsLoading(true);

    // 文档切换时重置自动缩放基准（fit-to-width 将由 pagesinit 事件计算）
    referenceWidthRef.current = null;

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
      // 1. 先让 pdfjs viewer 放弃旧 document 引用，同步取消 pending RenderTask
      const activeViewer = pdfViewerRef.current;
      const activeLinkService = linkServiceRef.current;
      if (activeViewer && activeLinkService) {
        resetPdfViewerDocument(activeViewer, activeLinkService);
      }
      // 2. 推迟 loadingTask 销毁到下一个宏任务。
      //    setDocument(null) 只能同步取消 RenderTask，但已发出的 page.getXXX() /
      //    getAnnotations() / getTextContent() 等异步调用无法撤回；这些 in-flight
      //    promise 在下一轮事件循环才 settle。若立即 destroy loadingTask，
      //    它们 resolve 时会访问已销毁的 PDFDocumentProxy，抛 "The object can
      //    not be found here."（尤其在侧栏 resize 触发高频 scale 重绘之后复现）。
      const taskToDestroy = loadingTask;
      setTimeout(() => {
        void taskToDestroy?.destroy();
      }, 0);
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
      removePageBorders: true,
      supportsPinchToZoom: false,
    });

    linkService.setViewer(pdfViewer);
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setCurrentPage(pageNumber);
    });
    eventBus.on('pagesloaded', ({ pagesCount }: { pagesCount: number }) => {
      setTotalPages(pagesCount);
      // 收集页面元素用于标注 Portal 注入
      if (viewer) {
        const pages = Array.from(viewer.querySelectorAll<HTMLElement>('.page'));
        setPageElements(pages);
      }
    });
    eventBus.on('pagesinit', () => {
      // 使用 pdfjs 内置 page-width 模式精确适配容器宽度（自动处理内边距、滚动条等）
      (pdfViewer as unknown as { currentScaleValue: string }).currentScaleValue = 'page-width';
      const fitScale = pdfViewer.currentScale;
      initialScaleRef.current = fitScale;
      userSetScaleRef.current = fitScale;
      referenceWidthRef.current = containerRef.current?.clientWidth ?? null;
      setScale(fitScale);
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

  // ---------------------------------------------------------------------------
  // 自动缩放：根据容器宽度变化比例调整缩放值
  // ---------------------------------------------------------------------------

  /** 更新缩放参考基准（手动缩放时调用，确保后续自动缩放以用户意图为基准） */
  const updateZoomReference = useCallback((newScale: number) => {
    userSetScaleRef.current = newScale;
    referenceWidthRef.current = containerRef.current?.clientWidth ?? referenceWidthRef.current;
  }, []);

  /** 根据当前容器宽度按比例计算新缩放值 */
  const applyAutoZoom = useCallback((currentWidth: number) => {
    const refWidth = referenceWidthRef.current;
    if (!refWidth || refWidth <= 0) return;

    const ratio = currentWidth / refWidth;
    const newScale = userSetScaleRef.current * ratio;
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

    setScale((prev) => {
      // 忽略微小浮点变化，避免抖动
      if (Math.abs(clamped - prev) < 0.005) return prev;
      return clamped;
    });
  }, []);

  // 缩放控制（手动缩放时同步更新参考基准）
  const handleZoomIn = useCallback(() => {
    setScale(prev => {
      const next = Math.min(prev + ZOOM_STEP, ZOOM_MAX);
      updateZoomReference(next);
      return next;
    });
  }, [updateZoomReference]);

  const handleZoomOut = useCallback(() => {
    setScale(prev => {
      const next = Math.max(prev - ZOOM_STEP, ZOOM_MIN);
      updateZoomReference(next);
      return next;
    });
  }, [updateZoomReference]);

  const handleZoomReset = useCallback(() => {
    // 重置到 fit-to-width：用 pdfjs 内置 page-width 模式重新计算（适配当前容器宽度）
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) {
      (pdfViewer as unknown as { currentScaleValue: string }).currentScaleValue = 'page-width';
      const fitScale = pdfViewer.currentScale;
      initialScaleRef.current = fitScale;
      updateZoomReference(fitScale);
      setScale(fitScale);
    }
  }, [updateZoomReference]);

  // 监听容器宽度变化，自动按比例调整缩放
  // 策略：rAF 隔帧执行 pdf.js 重绘（跳过 React），动画结束后同步 state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | undefined;
    let skipNext = false;
    let syncTimer: number | undefined;
    let latestWidth: number | null = null;

    const directSetScale = (width: number) => {
      const refWidth = referenceWidthRef.current;
      if (!refWidth || refWidth <= 0 || !pdfViewerRef.current) return;
      const ratio = width / refWidth;
      const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, userSetScaleRef.current * ratio));
      const current = pdfViewerRef.current.currentScale;
      if (Math.abs(clamped - current) >= 0.005) {
        pdfViewerRef.current.currentScale = clamped;
      }
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const currentWidth = entry.contentRect.width;
      if (currentWidth <= 0) return;

      if (referenceWidthRef.current === null) {
        referenceWidthRef.current = currentWidth;
        return;
      }

      latestWidth = currentWidth;

      // rAF 隔帧：精确对齐渲染帧，每 2 帧重绘一次
      if (rafId === undefined) {
        rafId = requestAnimationFrame(() => {
          rafId = undefined;
          if (skipNext) {
            skipNext = false;
            // 跳过这帧，安排下一帧
            rafId = requestAnimationFrame(() => {
              rafId = undefined;
              skipNext = true;
              if (latestWidth !== null) directSetScale(latestWidth);
            });
          } else {
            skipNext = true;
            if (latestWidth !== null) directSetScale(latestWidth);
          }
        });
      }

      // 动画结束后同步 React state
      clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        if (latestWidth !== null) {
          applyAutoZoom(latestWidth);
          latestWidth = null;
        }
      }, 350);
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      clearTimeout(syncTimer);
    };
  }, [applyAutoZoom]);

  // Ctrl+滚轮缩放（同步更新参考基准）
  useEffect(() => {
    const container = viewerContainerRef.current ?? containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale(prev => {
          const next = Math.min(Math.max(prev + delta, ZOOM_MIN), ZOOM_MAX);
          updateZoomReference(next);
          return next;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdf, updateZoomReference]);

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
  const translationJob = useDocumentStore((s) => s.translationJob);
  const translationProgress = useDocumentStore((s) => s.translationProgress);
  const setTranslationJob = useDocumentStore((s) => s.setTranslationJob);
  const setTranslationProgress = useDocumentStore((s) => s.setTranslationProgress);
  const setTranslatedPdfUrl = useDocumentStore((s) => s.setTranslatedPdfUrl);

  // 注意：原先这里有一个"根据 currentDocument.cachedTranslation 自动恢复 translatedPdfUrl"
  // 的 effect，但它会在 Sidebar/ZoteroList 显式清零之后被依赖变化再次触发，
  // 造成"第一次点原文 PDF 却加载翻译件"的 bug。
  // 现已将"打开新文档时默认恢复翻译视图"的职责下沉到 useDocumentStore.setCurrentDocument
  // 的不同文档分支，且翻译任务完成 / 手动触发翻译的路径均已主动 setTranslatedPdfUrl，
  // 这个 effect 已属冗余，删除以消除 race。

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
      if (translationJob.status === 'failed' || translationJob.status === 'cancelled') {
        setTranslationError(translationJob.errorMessage || `翻译任务${translationJob.status === 'failed' ? '失败' : '已取消'}`);
      }
      return;
    }
  }, [currentDocument?.documentId, setTranslatedPdfUrl, translationJob]);

  const activeJobId = translationJob?.jobId;

  useEffect(() => {
    if (!currentDocument || !translationJob) {
      return;
    }

    if (translationJob.documentId !== currentDocument.documentId) {
      return;
    }

    const isActiveJob = translationJob.status === 'queued' || translationJob.status === 'running';
    if (!isActiveJob) {
      return;
    }

    let disposed = false;
    let timerId: number | undefined;

    const pollTranslationJob = async () => {
      const currentStore = useDocumentStore.getState();
      const liveJob = currentStore.translationJob;
      if (!liveJob || liveJob.jobId !== translationJob.jobId) {
        return;
      }
      if (liveJob.status !== 'queued' && liveJob.status !== 'running') {
        return;
      }
      if (currentStore.currentDocument?.documentId !== currentDocument.documentId) {
        return;
      }

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
          }, FALLBACK_TRANSLATION_POLL_MS);
        } else if (latestJob.status === 'failed' || latestJob.status === 'cancelled') {
          setTranslationError(latestJob.errorMessage || `翻译任务${latestJob.status === 'failed' ? '失败' : '已取消'}`);
        }
      } catch (err) {
        if (disposed) {
          return;
        }
        console.error('轮询翻译任务失败:', err);
        timerId = window.setTimeout(() => {
          void pollTranslationJob();
        }, FALLBACK_TRANSLATION_POLL_MS);
      }
    };

    timerId = window.setTimeout(() => {
      void pollTranslationJob();
    }, FALLBACK_TRANSLATION_POLL_MS);

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    currentDocumentId,
    setTranslatedPdfUrl,
    setTranslationJob,
    setTranslationProgress,
    activeJobId,
  ]);

  const isTranslating = translationJob?.status === 'running' || translationJob?.status === 'queued';
  const hasTranslation = !!translatedPdfUrl || !!currentDocument?.cachedTranslation?.available;

  useEffect(() => {
    const scrollContainer = viewerContainerRef.current;
    if (!scrollContainer) return;

    // 记录 mousedown/mouseup 坐标用于修正 textLayer scaleX 导致的选区偏移
    let mousedownX = 0;
    let mousedownY = 0;
    let mouseupX = 0;
    let mouseupY = 0;

    /**
     * 修正 pdf.js textLayer 的选区起始偏移（仅在 mouseup 时调用一次）
     *
     * 根因：textLayer span 使用 CSS transform scaleX() 拉伸宽度以匹配 canvas。
     * 当 scaleX > 1 时，前一个 span 的 bounding box 向右溢出，覆盖下一个 span
     * 的起始区域。WebKit 的 hit-testing 会把 mousedown 位置映射到前一个 span
     * 的末尾字符，导致 selection.toString() 在开头多出不应包含的字符。
     *
     * 策略：对比 mousedown 坐标与 startSpan 后续兄弟 span 的位置，
     * 如果 mousedown 落在后续 span 中，则将 range.start 修正到该 span。
     *
     * 防护措施：
     * - 仅在正向选取（anchor 在 focus 之前）时修正
     * - mousedown 坐标与 startSpan 距离过远时跳过
     * - 只检查紧邻的下一个 span，避免跨行跳转
     */
    const fixTextLayerSelectionStart = (sel: Selection, range: Range): void => {
      if (mousedownX === 0 && mousedownY === 0) return;

      // 仅修正正向选取（anchor 在 focus 之前）：
      // 反向选取时 range.startContainer 是鼠标当前位置，不需要修正
      if (sel.anchorNode && sel.focusNode) {
        const position = sel.anchorNode.compareDocumentPosition(sel.focusNode);
        const isBackward =
          (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ||
          (sel.anchorNode === sel.focusNode && sel.anchorOffset > sel.focusOffset);
        if (isBackward) return;
      }

      const startNode = range.startContainer;
      const startSpan = (startNode.nodeType === Node.TEXT_NODE
        ? startNode.parentElement
        : startNode as HTMLElement
      )?.closest('.textLayer span') as HTMLElement | null;
      if (!startSpan) return;

      // 安全检查：mousedown 坐标应在 startSpan 附近
      // 如果 mousedown 离 startSpan 太远（超出 scaleX 溢出范围），跳过修正
      const startRect = startSpan.getBoundingClientRect();
      if (mousedownX < startRect.left - 20 || mousedownX > startRect.right + startRect.width) return;
      if (mousedownY < startRect.top - 10 || mousedownY > startRect.bottom + 10) return;

      // 遍历 startSpan 之后的兄弟节点（跳过 <br>），查找包含 mousedown 的 span
      let sibling = startSpan.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === 'SPAN' && sibling.closest('.textLayer')) {
          const sibRect = sibling.getBoundingClientRect();
          // 如果 mousedown 的 X 在此 span 的左边界与右边界之间
          // 且 Y 在此 span 的上下边界之间，说明用户实际点击了这个 span
          if (
            mousedownX >= sibRect.left &&
            mousedownX <= sibRect.right &&
            mousedownY >= sibRect.top - 2 &&
            mousedownY <= sibRect.bottom + 2
          ) {
            // 将 range 的起始点修正到此 span 的第一个文本节点
            const textNode = sibling.firstChild;
            if (textNode) {
              range.setStart(textNode, 0);
            }
            return;
          }
          break; // 只检查紧邻的下一个 span
        }
        sibling = sibling.nextElementSibling;
      }
    };

    /**
     * 修正 pdf.js textLayer 的选区结束点偏移（与起始点修正对称）
     *
     * scaleX 变换同样会导致末尾 span 的 bounding box 向右溢出，
     * 使 mouseup 时 hit-testing 跳到下一个 span，选区结束点意外扩大。
     *
     * 策略：如果 mouseup 坐标在 endSpan 前一个 span 的范围内，
     * 将 range.end 收紧到前一个 span 的末尾。
     */
    const fixTextLayerSelectionEnd = (sel: Selection, range: Range): void => {
      if (mouseupX === 0 && mouseupY === 0) return;

      // 仅修正正向选取
      if (sel.anchorNode && sel.focusNode) {
        const position = sel.anchorNode.compareDocumentPosition(sel.focusNode);
        const isBackward =
          (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ||
          (sel.anchorNode === sel.focusNode && sel.anchorOffset > sel.focusOffset);
        if (isBackward) return;
      }

      const endNode = range.endContainer;
      const endSpan = (endNode.nodeType === Node.TEXT_NODE
        ? endNode.parentElement
        : endNode as HTMLElement
      )?.closest('.textLayer span') as HTMLElement | null;
      if (!endSpan) return;

      // 安全检查：mouseup 坐标应在 endSpan 附近
      const endRect = endSpan.getBoundingClientRect();
      if (mouseupX < endRect.left - endRect.width || mouseupX > endRect.right + 20) return;
      if (mouseupY < endRect.top - 10 || mouseupY > endRect.bottom + 10) return;

      // 检查 mouseup 是否实际落在 endSpan 的前一个兄弟 span 中
      let sibling = endSpan.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === 'SPAN' && sibling.closest('.textLayer')) {
          const sibRect = sibling.getBoundingClientRect();
          if (
            mouseupX >= sibRect.left &&
            mouseupX <= sibRect.right &&
            mouseupY >= sibRect.top - 2 &&
            mouseupY <= sibRect.bottom + 2
          ) {
            // 将 range 的结束点收紧到前一个 span 的最后一个文本节点末尾
            const textNode = sibling.lastChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
              range.setEnd(textNode, (textNode as Text).length);
            }
            return;
          }
          break; // 只检查紧邻的前一个 span
        }
        sibling = sibling.previousElementSibling;
      }
    };

    /**
     * 选区合理性校验：如果鼠标拖动距离很短但选区文本异常大，
     * 说明 textLayer 的 scaleX 导致了 hit-testing 跳跃，应清除选区。
     *
     * 每像素拖动距离允许约 3 个字符（适配正常阅读速度的选取密度）。
     * 最低门槛：拖动距离 < 15px 时允许最多 60 字符（刚好双击选词的位置不移动也合理）。
     */
    const isSelectionReasonable = (text: string): boolean => {
      if (!text || mousedownX === 0) return true;
      const dx = mouseupX - mousedownX;
      const dy = mouseupY - mousedownY;
      const dragDistance = Math.sqrt(dx * dx + dy * dy);
      // 双击选词等场景拖动距离为 0 但选区文本很短，合理
      if (dragDistance < 15) return text.length <= 60;
      // 正常拖选：每像素允许约 3 个字符（PDF 行高约 12-20px，每行约 40-80 字符）
      const maxCharsAllowed = Math.max(60, dragDistance * 3);
      return text.length <= maxCharsAllowed;
    };

    const updateSelectionPopup = () => {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

        // 注意：fixTextLayerSelectionStart/End 已移至 handleMouseUp 中调用
        // 不在 selectionchange 高频回调中修改 Range，避免拖选时选区异常扩大

        const selectionText = selection?.toString() ?? '';
        const text = selectionText.trim();
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

        // 优先使用当前 ref（防止 pdf.js 重排后 scrollContainer 闭包引用失效）
        const currentScrollContainer = viewerContainerRef.current ?? scrollContainer;
        const rangeNode = range.commonAncestorContainer as Node;
        // 检查选区是否在可视区内：
        // 1. 优先使用 debug snapshot 的判断（若启用）
        // 2. 检查选区节点是否在当前 scrollContainer 内
        // 3. 回退：检查选区祖先是否在任一 .textLayer 内
        //    （处理 pdf.js 重排后文本层 DOM 被重建的边界情况）
        const isInScrollContainer = currentScrollContainer.contains(rangeNode);
        const isInTextLayer = !isInScrollContainer && !!(
          rangeNode.nodeType === Node.ELEMENT_NODE
            ? (rangeNode as Element).closest('.textLayer')
            : rangeNode.parentElement?.closest('.textLayer')
        );
        const selectionInsideViewer = debugSnapshot?.selectionInsideViewer
          ?? (isInScrollContainer || isInTextLayer);
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
          x: anchorRect.right,
          y: placement === 'above'
            ? anchorRect.top - 8
            : anchorRect.bottom + 8,
          placement,
        });
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      // 记录 mouseup 坐标用于选区合理性校验
      mouseupX = e.clientX;
      mouseupY = e.clientY;

      // 修正 textLayer scaleX 导致的选区起始偏移——仅在 mouseup 时执行一次
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        fixTextLayerSelectionStart(sel, range);
        // 同样修正结束点：scaleX 变换可能让 hit-testing 在末尾也跳到错误的 span
        fixTextLayerSelectionEnd(sel, range);
      }

      // 选区合理性校验：如果拖动距离很短但选区文本异常大，清除异常选区
      const selText = sel?.toString().trim() ?? '';
      if (selText.length > 0 && !isSelectionReasonable(selText)) {
        sel?.removeAllRanges();
        setSelectionPopup(null);
        return;
      }

      // 标注模式: 选中文本后自动创建标注（工具保持激活）
      const { activeTool, activeColor, createAnnotation, startEditingNote } = useAnnotationStore.getState();
      if (activeTool) {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        // 使用当前 ref 而非闭包捕获的 scrollContainer，防止布局切换后 ref 失效
        const currentContainer = viewerContainerRef.current ?? scrollContainer;
        if (text.length >= 2 && currentContainer) {
          const rects = selectionToAnnotationRects(selection!, currentContainer);
          if (rects.length === 0) {
            console.warn('[标注] 无法从当前选区解析出页面矩形，跳过创建', {
              textLength: text.length,
              hasContainer: !!currentContainer,
              pagesInContainer: currentContainer.querySelectorAll('.page').length,
            });
          }
          if (rects.length > 0) {
            // 跨页标注暂不支持
            const pageNumbers = new Set(rects.map((r) => r.pageNumber));
            if (pageNumbers.size > 1) {
              console.warn('暂不支持跨页标注');
              selection?.removeAllRanges();
              setSelectionPopup(null);
              return;
            }
            const doc = useDocumentStore.getState().currentDocument;
            if (doc) {
              void createAnnotation({
                documentId: doc.documentId,
                type: activeTool,
                color: activeColor,
                pageNumber: rects[0].pageNumber,
                text,
                noteContent: activeTool === 'note' ? '' : undefined,
                rects,
              }).then((created) => {
                // 笔记类型创建后自动弹出编辑器
                if (created && activeTool === 'note') {
                  startEditingNote(created.annotationId);
                }
              });
              selection?.removeAllRanges();
              // 工具保持激活（不自动取消）
              setSelectionPopup(null);
              return;
            }
          }
        }
      }
      updateSelectionPopup();
    };

    const handleMouseDown = (e: MouseEvent) => {
      // 记录 mousedown 坐标用于选区修正
      mousedownX = e.clientX;
      mousedownY = e.clientY;
      // 点击浮窗菜单或翻译气泡本身时不清除
      if ((e.target as HTMLElement)?.closest('.selection-popup-menu')) return;
      setSelectionPopup(null);
      setTranslationBubble(null);
      // 点击非 annotation 区域时取消选中
      if (!(e.target as HTMLElement)?.closest('[data-ann-id]')) {
        useAnnotationStore.getState().selectAnnotation(null);
      }
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
    setTranslationBubble(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // 划词翻译回调
  const handleTranslateClick = useCallback((text: string) => {
    if (!selectionPopup) return;
    setTranslationBubble({
      text,
      x: selectionPopup.x,
      y: selectionPopup.placement === 'below'
        ? selectionPopup.y + 40
        : selectionPopup.y - 8,
      placement: selectionPopup.placement,
    });
  }, [selectionPopup]);

  // 标注右键菜单回调
  const handleAnnotationContextMenu = useCallback((annotation: import('../../shared/types').AnnotationDto, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    useAnnotationStore.getState().selectAnnotation(annotation.annotationId);
    openAnnotationContextMenu(annotation, event.clientX, event.clientY);
  }, [openAnnotationContextMenu]);

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
          <img src={shibaErrorUrl} alt="" className="w-5 h-5 shrink-0" />
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
              <img src={shibaLoadingUrl} alt="" className="w-[80px] h-auto opacity-85 animate-pulse" />
              <span className="text-sm">加载中...</span>
            </div>
          </div>
        )}

        <div
          ref={viewerContainerRef}
          className={`absolute inset-0 overflow-auto pdf-scroll-container ${pdf && !isLoading ? '' : 'pointer-events-none opacity-0'}`}
          style={annotationActiveTool ? { cursor: 'text' } : undefined}
        >
          <div
            ref={viewerRef}
            className="pdfViewer"
          />
          {/* 标注渲染层 — Portal 注入每个页面 */}
          {pageElements.map((pageEl) => {
            const pageNum = parseInt(pageEl.dataset.pageNumber || '0', 10);
            if (!pageNum) return null;
            return createPortal(
              <AnnotationOverlay
                key={pageNum}
                pageNumber={pageNum}
                onAnnotationContextMenu={handleAnnotationContextMenu}
              />,
              pageEl,
            );
          })}
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

      {/* 标注右键菜单 */}
      <AnnotationContextMenu
        menu={annotationContextMenu}
        onClose={closeAnnotationContextMenu}
        onQuoteToChat={handleQuoteToChat}
      />

      {/* 笔记编辑弹窗 */}
      <NotePopup />

      {/* 毛玻璃选词菜单 — fixed 定位，与 NotePopup 同级确保毛玻璃效果一致 */}
      <SelectionPopupMenu
        visible={!!selectionPopup}
        x={selectionPopup?.x ?? 0}
        y={selectionPopup?.y ?? 0}
        placement={selectionPopup?.placement ?? 'below'}
        selectedText={selectionPopup?.text ?? ''}
        onQuote={handleQuoteToChat}
        onTranslate={handleTranslateClick}
      />

      {/* 翻译结果气泡 */}
      {translationBubble && (
        <TranslationBubble
          text={translationBubble.text}
          x={translationBubble.x}
          y={translationBubble.y}
          placement={translationBubble.placement}
          onClose={() => setTranslationBubble(null)}
        />
      )}
    </div>
  );
};
