/**
 * PDF 文本提取工具 — 用于 AI 总结的文本采集
 *
 * 核心问题：Tauri WebView 的 ReadableStream 实现不完整，
 * pdfjs v5 的 getTextContent() 内部使用 for await...of ReadableStream
 * 迭代文本块，而 WKWebView 的 ReadableStream 缺少 Symbol.asyncIterator，
 * 导致 "undefined is not a function" 崩溃。
 *
 * 解决方案（三层修复）：
 *   1. ensureReadableStream() — 检测并修补 ReadableStream
 *   2. streamTextContent() + reader.read() — 手动聚合文本块，
 *      完全绕开 for await...of 路径（与 pdfjs 官方 viewer 消费方式一致）
 *   3. ArrayBuffer 预加载 — 绕过 pdfjs 内部 fetch/stream 路径
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

// PDFWorker 类型在 pdfjs-dist v5 中需要从主入口获取
const { PDFWorker } = pdfjsLib;

// ---------------------------------------------------------------------------
// ReadableStream 最小化 Polyfill
// pdfjs 的 streamTextContent() / sendWithStream 仅使用以下特性：
//   - new ReadableStream({ start(controller), pull(controller), cancel(reason) })
//   - controller.enqueue(chunk) / controller.close() / controller.error(e)
//   - stream.getReader() → { read(), cancel() }
// ---------------------------------------------------------------------------

/**
 * 检测 ReadableStream 是否可用且功能正常。
 * Tauri WebView 中 ReadableStream 可能存在但 getReader().read() 会崩溃。
 */
function isReadableStreamWorking(): boolean {
  try {
    if (typeof ReadableStream === 'undefined') return false;
    // 尝试实际创建并读取一次，确保不是"存在但残缺"的实现
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('test');
        controller.close();
      },
    });
    const reader = stream.getReader();
    // 如果 read() 存在且可调用，认为基本可用
    if (typeof reader.read !== 'function') return false;
    reader.releaseLock();
    return true;
  } catch {
    return false;
  }
}

/**
 * 最小化 ReadableStream polyfill — 仅覆盖 pdfjs 所需的子集
 */
function createMinimalReadableStream() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return class MinimalReadableStream {
    private _queue: unknown[] = [];
    private _closed = false;
    private _errored: unknown = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _waitResolve: ((result: any) => void) | null = null;

    constructor(underlyingSource?: {
      start?: (controller: unknown) => void;
      pull?: (controller: unknown) => void;
      cancel?: (reason?: unknown) => void;
    }) {
      const self = this;
      const controller = {
        enqueue(chunk: unknown) {
          if (self._waitResolve) {
            const resolve = self._waitResolve;
            self._waitResolve = null;
            resolve({ value: chunk, done: false });
          } else {
            self._queue.push(chunk);
          }
        },
        close() {
          self._closed = true;
          if (self._waitResolve) {
            const resolve = self._waitResolve;
            self._waitResolve = null;
            resolve({ value: undefined, done: true });
          }
        },
        error(e: unknown) {
          self._errored = e;
          if (self._waitResolve) {
            const resolve = self._waitResolve;
            self._waitResolve = null;
            resolve(Promise.reject(e));
          }
        },
        desiredSize: 1,
      };

      if (underlyingSource?.start) {
        underlyingSource.start(controller);
      }
    }

    getReader() {
      const self = this;
      return {
        read() {
          if (self._errored) return Promise.reject(self._errored);
          if (self._queue.length > 0) {
            return Promise.resolve({ value: self._queue.shift(), done: false });
          }
          if (self._closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          // 等待 enqueue 或 close
          return new Promise((resolve) => {
            self._waitResolve = resolve;
          });
        },
        releaseLock() {
          // noop — 单一 reader 场景
        },
        cancel() {
          self._closed = true;
          self._queue.length = 0;
          return Promise.resolve();
        },
      };
    }

    cancel() {
      this._closed = true;
      this._queue.length = 0;
      return Promise.resolve();
    }
  };
}

/**
 * 确保 ReadableStream 在当前环境中可用。
 * 如果原生实现残缺（Tauri WebView），替换为 polyfill。
 */
function ensureReadableStream(): void {
  if (!isReadableStreamWorking()) {
    console.warn(
      '[pdf-text-extractor] ReadableStream 不可用或残缺，注入最小化 polyfill',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ReadableStream = createMinimalReadableStream();
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export const DEFAULT_SUMMARY_SOURCE_PAGES = 20;
export const DEFAULT_SUMMARY_SOURCE_CHARS = 40_000;

interface ExtractPdfTextOptions {
  maxPages?: number;
  maxChars?: number;
}

export interface ExtractPdfTextResult {
  text: string;
  scannedPages: number;
  totalPages: number;
  truncated: boolean;
}

const sanitizePageText = (value: string) => value.replace(/\s+/g, ' ').trim();

export async function extractPdfText(
  filePath: string,
  options: ExtractPdfTextOptions = {},
): Promise<ExtractPdfTextResult> {
  // ① 修补 ReadableStream（仅在残缺时注入 polyfill）
  ensureReadableStream();

  const maxPages = options.maxPages ?? DEFAULT_SUMMARY_SOURCE_PAGES;
  const maxChars = options.maxChars ?? DEFAULT_SUMMARY_SOURCE_CHARS;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  // ② 创建独立的 fake worker（不传 port → 主线程执行）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 类型定义将 name 错误标注为 null|undefined
  const fakeWorker = new PDFWorker({ name: 'rastro-text-extractor' } as any);

  try {
    // ③ 先 fetch 为 ArrayBuffer，绕过 pdfjs 内部 fetch/stream 路径
    const pdfUrl = convertFileSrc(filePath);
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();

    // 使用 fake worker 加载 PDF，不影响全局 workerSrc 配置
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      worker: fakeWorker,
    });
    const pdfDocument = await loadingTask.promise;
    const pageLimit = Math.min(pdfDocument.numPages, maxPages);
    const pageTexts: string[] = [];
    let scannedPages = 0;
    let collectedChars = 0;

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      // 使用 streamTextContent() + reader.read() 手动聚合，
      // 避免 getTextContent() 内部 for await...of ReadableStream 在 Tauri WebView 崩溃
      const items: Array<{ str?: string }> = [];
      const stream = page.streamTextContent();
      const reader = stream.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.items) {
          items.push(...value.items);
        }
      }
      const pageText = sanitizePageText(
        items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      );

      scannedPages = pageNumber;
      if (!pageText) {
        continue;
      }

      const remainingChars = maxChars - collectedChars;
      if (remainingChars <= 0) {
        break;
      }

      const clippedText = pageText.slice(0, remainingChars).trim();
      if (!clippedText) {
        continue;
      }

      pageTexts.push(clippedText);
      collectedChars += clippedText.length;

      if (clippedText.length < pageText.length) {
        break;
      }
    }

    return {
      text: pageTexts.join('\n\n').trim(),
      scannedPages,
      totalPages: pdfDocument.numPages,
      truncated: collectedChars >= maxChars,
    };
  } finally {
    try {
      await loadingTask?.destroy();
    } catch (error) {
      console.warn('释放 PDF 文本提取任务失败:', error);
    }
    // 销毁 fake worker 释放资源
    fakeWorker.destroy();
  }
}
