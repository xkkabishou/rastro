"""antigravity-translate — 考古学 PDF 翻译后端核心模块。

提供三类功能：
1. bake_rotations()          — 旋转页预处理
2. detect_reference_pages()  — 参考文献 / 致谢页检测
3. translate()               — 一键翻译入口（预处理 + 跳过 + 调用 pdf2zh）
"""

from __future__ import annotations

import csv
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

import fitz  # PyMuPDF

from . import config
from .prompts import ARCHAEOLOGY_PROMPT

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_log_fn: Callable[[str], None] | None = None


def set_logger(fn: Callable[[str], None]) -> None:
    """设置日志回调，桌面端可以接入自己的 UI 日志。"""
    global _log_fn
    _log_fn = fn


def _log(message: str) -> None:
    if _log_fn:
        _log_fn(message)
    else:
        print(message, flush=True)


# ---------------------------------------------------------------------------
# 旋转页预处理
# ---------------------------------------------------------------------------

def bake_rotations(input_pdf: Path, output_pdf: Path) -> list[int]:
    """将 PDF 页面的旋转属性烘焙进 content stream。

    babeldoc 无法处理 rotation!=0 的页面，此函数在翻译前修正。

    Returns:
        修改过的页码列表（1-based）。
    """
    doc = fitz.open(str(input_pdf))
    modified: list[int] = []

    for page in doc:
        rot = page.rotation
        if rot == 0:
            continue

        page.clean_contents()
        mbox = page.mediabox

        if rot == 90:
            cm = f"0 -1 1 0 0 {mbox.width} cm\n"
        elif rot == 270:
            cm = f"0 1 -1 0 {mbox.height} 0 cm\n"
        elif rot == 180:
            cm = f"-1 0 0 -1 {mbox.width} {mbox.height} cm\n"
        else:
            continue

        xref = page.get_contents()[0]
        old_stream = doc.xref_stream(xref)
        doc.update_stream(xref, cm.encode() + old_stream)

        if rot in (90, 270):
            new_mbox = fitz.Rect(0, 0, mbox.height, mbox.width)
            page.set_mediabox(new_mbox)
            page.set_cropbox(new_mbox)

        page.set_rotation(0)
        modified.append(page.number + 1)

    doc.save(str(output_pdf))
    doc.close()
    return modified


# ---------------------------------------------------------------------------
# 参考文献 / 致谢页检测
# ---------------------------------------------------------------------------

_REF_KEYWORDS = {"references", "bibliography", "works cited", "literature cited"}
_ACK_KEYWORDS = {
    "acknowledgement", "acknowledgements",
    "acknowledgment", "acknowledgments",
}
_TAIL_SCAN_PAGE_LIMIT = 12

# 用于去除行首编号前缀的正则，如 "7.", "VII.", "7 ", "VII "
_HEADING_NUM_PREFIX_RE = re.compile(r'^(?:[\dIVXivx]+[\.\)\s]+)')


def _parse_pages(pages_str: str) -> set[int]:
    """解析页码字符串 '1-3,5,7-8' → {1,2,3,5,7,8}"""
    result: set[int] = set()
    for part in pages_str.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            result.update(range(int(start), int(end) + 1))
        else:
            result.add(int(part))
    return result


def _tail_scan_start(total_pages: int) -> int:
    """返回尾部扫描窗口的起始页索引（0-based）。"""
    return max(0, total_pages - _TAIL_SCAN_PAGE_LIMIT)


def _is_ref_heading_line(line_text: str) -> bool:
    """判断一行文本是否是参考文献的节标题。

    满足以下条件视为标题行：
    1. 去除编号前缀后，以关键词开头
    2. 行长度较短（< 60 字符），排除正文段落中的偶然提及
    """
    text = line_text.strip()
    if not text or len(text) > 60:
        return False

    lower = text.lower()
    # 去除编号前缀，如 "7. References" → "references"
    clean = _HEADING_NUM_PREFIX_RE.sub('', lower).strip()
    return any(clean.startswith(kw) for kw in _REF_KEYWORDS)


def _find_heading_y_in_page(page: Any, keywords: set[str]) -> float | None:
    """在页面中查找关键词标题行的 y 坐标。"""
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    for block in blocks:
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            line_text = "".join(span["text"] for span in line["spans"]).strip()
            if _is_ref_heading_line(line_text):
                # 返回该行的 y 坐标（行顶部）
                return line["bbox"][1]
    return None


def detect_reference_pages(pdf_path: Path) -> list[int]:
    """检测参考文献页（1-based）。

    策略：从后往前扫描页面，用 PyMuPDF 文本块/行信息识别参考文献节标题。
    仅当检测到独立的标题行（短行、以关键词开头、可含编号前缀）时才触发跳过，
    排除正文段落中的偶然提及（如 "see references [1,2]"）。

    - 标题在页面前 20%：该页及后续全部跳过
    - 标题在中后部：仅跳过后续页
    """
    doc = fitz.open(str(pdf_path))
    total = len(doc)
    ref_pages: list[int] = []
    ref_heading_page = None
    matched_line_text = None

    scan_start = _tail_scan_start(total)
    _log(
        f"[ref-detect] Scanning tail window pages "
        f"{scan_start + 1}-{total} for reference heading (backward)..."
    )

    # 仅扫描尾部窗口，避免为跳过参考文献额外全文扫描
    for page_idx in range(total - 1, scan_start - 1, -1):
        page = doc[page_idx]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        found = False
        for block in blocks:
            if block.get("type", 0) != 0:  # 只处理文本块
                continue
            for line in block.get("lines", []):
                line_text = "".join(span["text"] for span in line["spans"]).strip()
                if _is_ref_heading_line(line_text):
                    ref_heading_page = page_idx
                    matched_line_text = line_text
                    found = True
                    _log(f"[ref-detect] Found reference heading on page {page_idx + 1}: '{line_text}'")
                    break
            if found:
                break
        if found:
            break

    if ref_heading_page is not None:
        page = doc[ref_heading_page]
        page_height = page.rect.height
        heading_y = _find_heading_y_in_page(page, _REF_KEYWORDS)

        _log(f"[ref-detect] Heading Y={heading_y}, page height={page_height}, threshold={page_height * 0.2}")

        if heading_y is not None and heading_y < page_height * 0.2:
            start = ref_heading_page  # 标题在页面顶部，当前页也跳过
        else:
            start = ref_heading_page + 1  # 标题在中下部，只跳后续页

        for pn in range(start, total):
            ref_pages.append(pn + 1)

        _log(f"[ref-detect] Reference pages to skip: {ref_pages}")
    else:
        _log("[ref-detect] No reference heading found in tail window.")

    doc.close()
    return ref_pages


def _is_ack_heading_line(line_text: str) -> bool:
    """判断一行文本是否是致谢的节标题。"""
    text = line_text.strip()
    if not text or len(text) > 60:
        return False
    lower = text.lower()
    clean = _HEADING_NUM_PREFIX_RE.sub('', lower).strip()
    return any(clean.startswith(kw) for kw in _ACK_KEYWORDS)


def detect_acknowledgement_pages(pdf_path: Path) -> list[int]:
    """检测致谢页（1-based），使用结构化标题检测，只跳包含标题的页。"""
    doc = fitz.open(str(pdf_path))
    total = len(doc)
    scan_start = _tail_scan_start(total)
    ack_pages: list[int] = []

    _log(
        f"[ack-detect] Scanning tail window pages "
        f"{scan_start + 1}-{total} for acknowledgement heading..."
    )

    for page_idx in range(scan_start, total):
        page = doc[page_idx]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if block.get("type", 0) != 0:
                continue
            for line in block.get("lines", []):
                line_text = "".join(span["text"] for span in line["spans"]).strip()
                if _is_ack_heading_line(line_text):
                    ack_pages.append(page.number + 1)
                    _log(f"[ack-detect] Found acknowledgement heading on page {page.number + 1}: '{line_text}'")
                    break
            else:
                continue
            break

    if not ack_pages:
        _log("[ack-detect] No acknowledgement heading found in tail window.")

    doc.close()
    return ack_pages


# ---------------------------------------------------------------------------
# 术语表
# ---------------------------------------------------------------------------

def build_glossary_csv(
    glossary_entries: list[dict[str, str]], output_path: Path
) -> Path:
    """将术语表写成 babeldoc 兼容的 CSV。"""
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["en", "zh"])
        for entry in glossary_entries:
            en, zh = entry.get("en", ""), entry.get("zh", "")
            if en and zh:
                writer.writerow([en, zh])
    return output_path


def _cleanup_translation_outputs(output_dir: Path, stem: str) -> None:
    """清理当前任务可能产生的中间或最终 PDF 产物。"""
    patterns = (
        f"{stem}*mono*.*pdf",
        f"{stem}*translated*.*pdf",
        f"{stem}*dual*.*pdf",
    )
    for pattern in patterns:
        for candidate in output_dir.glob(pattern):
            candidate.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 核心翻译入口
# ---------------------------------------------------------------------------

def translate(
    input_pdf: str | Path,
    output_dir: str | Path | None = None,
    glossary_csv: str | Path | None = None,
    pages: str | None = None,
    no_dual: bool = False,
    no_mono: bool = False,
    debug: bool = False,
    qps: int | None = None,
    pool_max_workers: int | None = None,
    skip_references: bool = False,
    custom_prompt: str | None = None,
    extra_args: list[str] | None = None,
    on_progress: Callable[[str], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """一键翻译 PDF。

    自动执行：旋转页预处理 → 参考文献跳过 → 调用 pdf2zh.exe。

    Args:
        input_pdf:      输入 PDF 路径。
        output_dir:     输出目录，默认与输入同目录。
        glossary_csv:   术语表 CSV 路径。
        pages:          页码范围，如 "1-3,5"。
        no_dual:        不生成双语 PDF。
        no_mono:        不生成纯中文 PDF。
        debug:          开启 pdf2zh debug 模式。
        qps:            QPS 限制，默认取 config.DEFAULT_QPS。
        pool_max_workers: 翻译线程池工人数，默认取 config.DEFAULT_POOL_MAX_WORKERS。
        skip_references: 自动跳过参考文献和致谢页。
        custom_prompt:  自定义翻译 prompt，默认用考古学 prompt。
        extra_args:     传给 pdf2zh.exe 的额外参数。
        on_progress:    进度回调（日志字符串）。
        cancel_event:   外部取消信号，触发后会终止底层翻译子进程并清理产物。

    Returns:
        {
            "mono_pdf": Path | None,
            "dual_pdf": Path | None,
            "returncode": int,
            "stdout": str,
            "stderr": str,
            "cancelled": bool,
        }
    """
    input_pdf = Path(input_pdf)
    if qps is None:
        qps = config.DEFAULT_QPS
    if pool_max_workers is None:
        pool_max_workers = config.DEFAULT_POOL_MAX_WORKERS
    if on_progress:
        set_logger(on_progress)

    pdf2zh_exe_raw = str(config.PDF2ZH_EXE).strip()
    if not pdf2zh_exe_raw:
        raise FileNotFoundError(
            "pdf2zh.exe path is not configured. Please set AG_PDF2ZH_EXE or config.PDF2ZH_EXE."
        )

    if not config.CLAUDE_BASE_URL.strip():
        raise ValueError(
            "CLAUDE_BASE_URL is not configured. Please set AG_CLAUDE_BASE_URL or config.CLAUDE_BASE_URL."
        )
    if not config.CLAUDE_API_KEY.strip():
        raise ValueError(
            "CLAUDE_API_KEY is not configured. Please set AG_CLAUDE_API_KEY or config.CLAUDE_API_KEY."
        )
    if not config.CLAUDE_MODEL.strip():
        raise ValueError(
            "CLAUDE_MODEL is not configured. Please set AG_CLAUDE_MODEL or config.CLAUDE_MODEL."
        )

    pdf2zh_exe = Path(pdf2zh_exe_raw)
    if not pdf2zh_exe.exists():
        raise FileNotFoundError(f"pdf2zh.exe not found: {pdf2zh_exe}")
    if not input_pdf.exists():
        raise FileNotFoundError(f"Input PDF not found: {input_pdf}")

    if output_dir is None:
        output_dir = input_pdf.parent
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if glossary_csv is not None:
        glossary_csv = Path(glossary_csv)

    # ── 旋转页预处理 ──────────────────────────────────────────────
    doc_check = fitz.open(str(input_pdf))
    has_rotated = any(p.rotation != 0 for p in doc_check)
    total_pages = len(doc_check)
    doc_check.close()

    baked_pdf = None
    if has_rotated:
        baked_pdf = output_dir / f"_baked_{input_pdf.name}"
        modified = bake_rotations(input_pdf, baked_pdf)
        _log(f"[preprocess] Baked rotations for pages: {modified}")
        working_pdf = baked_pdf
    else:
        working_pdf = input_pdf

    # ── 参考文献 / 致谢页检测 ─────────────────────────────────────
    _log(f"[preprocess] skip_references={skip_references}, total_pages={total_pages}, pages={pages}")
    if skip_references:
        ref_pages = detect_reference_pages(working_pdf)
        ack_pages = detect_acknowledgement_pages(working_pdf)
        skip_pages = set(ref_pages) | set(ack_pages)
        _log(f"[preprocess] ref_pages={ref_pages}, ack_pages={ack_pages}, skip_pages={sorted(skip_pages)}")
        if skip_pages:
            if pages is None:
                candidate_pages = set(range(1, total_pages + 1))
            else:
                candidate_pages = _parse_pages(pages)
            translate_pages = sorted(candidate_pages - skip_pages)
            pages = ",".join(str(p) for p in translate_pages)
            _log(f"[preprocess] candidate_pages={sorted(candidate_pages)}")
            _log(f"[preprocess] Skipping pages: {sorted(skip_pages)}")
            _log(f"[preprocess] Translating pages: {pages}")
        else:
            _log("[preprocess] No pages to skip, translating all pages.")
    else:
        _log("[preprocess] Reference skipping disabled.")

    # ── 构建命令 ──────────────────────────────────────────────────
    prompt_text = custom_prompt or ARCHAEOLOGY_PROMPT

    prompt_file = tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    )
    prompt_file.write(prompt_text)
    prompt_file.close()
    prompt_path = Path(prompt_file.name)

    try:
        command = [
            str(pdf2zh_exe),
            str(working_pdf),
            "--openaicompatible",
            "--openai-compatible-base-url", config.CLAUDE_BASE_URL,
            "--openai-compatible-api-key", config.CLAUDE_API_KEY,
            "--openai-compatible-model", config.CLAUDE_MODEL,
            "--lang-in", config.DEFAULT_LANG_IN,
            "--lang-out", config.DEFAULT_LANG_OUT,
            "--output", str(output_dir),
            "--qps", str(qps),
            "--custom-system-prompt", prompt_text,
            "--watermark-output-mode", "no_watermark",
            "--skip-scanned-detection",
            "--primary-font-family", "serif",
            "--split-short-lines",
            "--short-line-split-factor", "0.8",
            "--no-auto-extract-glossary",
        ]

        if pool_max_workers is not None:
            command.extend(["--pool-max-workers", str(pool_max_workers)])

        if glossary_csv and glossary_csv.exists():
            command.extend(["--glossaries", str(glossary_csv)])
        if pages:
            command.extend(["--pages", pages])
        if no_dual:
            command.append("--no-dual")
        if no_mono:
            command.append("--no-mono")
        if debug:
            command.append("--debug")
        if extra_args:
            command.extend(extra_args)

        _log(f"[pdf2zh] Starting translation: {input_pdf.name}")
        _log(f"[pdf2zh] Model: {config.CLAUDE_MODEL}")
        _log(f"[pdf2zh] Output directory: {output_dir}")
        _log(f"[pdf2zh:total_pages] {total_pages}")

        if cancel_event and cancel_event.is_set():
            _cleanup_translation_outputs(output_dir, working_pdf.stem)
            if baked_pdf and baked_pdf.exists():
                baked_pdf.unlink(missing_ok=True)
            return {
                "mono_pdf": None,
                "dual_pdf": None,
                "returncode": -1,
                "stdout": "",
                "stderr": "",
                "cancelled": True,
            }

        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        # 实时读取 stderr（pdf2zh/babeldoc 的 tqdm 进度写在 stderr）
        stderr_lines: list[str] = []
        _PROGRESS_RE = re.compile(r'(\d+)%')

        def _drain_stderr() -> None:
            """在后台线程中逐行读取 stderr，解析 tqdm 进度并回调。"""
            assert process.stderr is not None
            for raw_line in process.stderr:
                line = raw_line.rstrip('\n\r')
                stderr_lines.append(line)
                # tqdm 非 TTY 模式输出形如：
                #   translate:  45%|████▌     | 45/100 [01:23<01:34, ...]
                m = _PROGRESS_RE.search(line)
                if m:
                    pct = int(m.group(1))
                    _log(f"[pdf2zh:progress] {pct}%")

        stderr_thread = threading.Thread(
            target=_drain_stderr, daemon=True, name="pdf2zh-stderr"
        )
        stderr_thread.start()

        # 主线程轮询：等待进程结束或取消
        while process.poll() is None:
            if cancel_event and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                stderr_thread.join(timeout=2)

                _log("[pdf2zh] Translation cancelled")
                _cleanup_translation_outputs(output_dir, working_pdf.stem)
                if baked_pdf and baked_pdf.exists():
                    baked_pdf.unlink(missing_ok=True)
                return {
                    "mono_pdf": None,
                    "dual_pdf": None,
                    "returncode": -1,
                    "stdout": "",
                    "stderr": "\n".join(stderr_lines),
                    "cancelled": True,
                }
            time.sleep(0.3)

        # 进程已退出，等待 stderr 线程读完尾部数据
        stderr_thread.join(timeout=5)
        stdout_text = ""
        stderr_text = "\n".join(stderr_lines)

        returncode = process.returncode if process.returncode is not None else -1

        stem = working_pdf.stem
        mono_candidates = (
            list(output_dir.glob(f"{stem}*mono*.*pdf"))
            + list(output_dir.glob(f"{stem}*translated*.*pdf"))
        )
        dual_candidates = list(output_dir.glob(f"{stem}*dual*.*pdf"))

        mono_pdf = mono_candidates[0] if mono_candidates else None
        dual_pdf = dual_candidates[0] if dual_candidates else None

        if returncode == 0:
            _log("[pdf2zh] Translation complete!")
            if mono_pdf:
                _log(f"  Chinese PDF: {mono_pdf}")
            if dual_pdf:
                _log(f"  Dual PDF:    {dual_pdf}")
        else:
            _log(f"[pdf2zh] Translation failed (code={returncode})")
            if stderr_text:
                for line in stderr_text.strip().splitlines()[-30:]:
                    _log(f"  {line}")

        # 清理临时文件
        if baked_pdf and baked_pdf.exists():
            baked_pdf.unlink(missing_ok=True)

        return {
            "mono_pdf": mono_pdf,
            "dual_pdf": dual_pdf,
            "returncode": returncode,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "cancelled": False,
        }
    finally:
        prompt_path.unlink(missing_ok=True)
