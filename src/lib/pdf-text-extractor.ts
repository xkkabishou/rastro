/**
 * PDF 文本提取工具 — 用于 AI 总结的文本采集
 *
 * 核心修复：Tauri WebView 的 ReadableStream 支持不完整，
 * pdfjs worker 的 getTextContent() 在 worker↔主线程通过
 * ReadableStream 传输文本内容时会崩溃（"undefined is not a function"）。
 *
 * 解决方案：创建独立的 PDFWorker 实例（不传 port），触发 pdfjs 内部
 * 的 fake worker 初始化，使 getTextContent() 完全在主线程执行。
 * 不修改 GlobalWorkerOptions.workerSrc，不影响 PdfViewer 的正常渲染。
 * 对于 ≤20 页的摘要提取，主线程执行的性能完全可接受。
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

// PDFWorker 类型在 pdfjs-dist v5 中需要从主入口获取
const { PDFWorker } = pdfjsLib;

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
  const maxPages = options.maxPages ?? DEFAULT_SUMMARY_SOURCE_PAGES;
  const maxChars = options.maxChars ?? DEFAULT_SUMMARY_SOURCE_CHARS;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  // 创建独立的 fake worker（不传 port → 主线程执行，绕过 ReadableStream）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 类型定义将 name 错误标注为 null|undefined
  const fakeWorker = new PDFWorker({ name: 'rastro-text-extractor' } as any);

  try {
    // 先 fetch 为 ArrayBuffer，绕过 pdfjs 内部 fetch/stream 路径
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
      const textContent = await page.getTextContent();
      const pageText = sanitizePageText(
        textContent.items
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
