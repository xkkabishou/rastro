import { convertFileSrc } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

  try {
    // 使用 ArrayBuffer 加载 PDF，绕过 Tauri WebView 中 ReadableStream 不兼容的问题
    const pdfUrl = convertFileSrc(filePath);
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
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
  }
}
