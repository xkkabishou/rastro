"""antigravity-translate — 考古学 PDF 翻译后端核心模块。

提供三类功能：
1. bake_rotations()          — 旋转页预处理
2. detect_reference_pages()  — 参考文献 / 致谢页检测
3. translate()               — 一键翻译入口（预处理 + 跳过 + 调用 pdf2zh）
"""

from __future__ import annotations

import csv
import subprocess
import tempfile
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


def detect_reference_pages(pdf_path: Path) -> list[int]:
    """检测参考文献页（1-based）。

    策略：找到 references/bibliography 标题后——
    - 标题在页面前 20%：该页及后续全部跳过
    - 标题在中后部：仅跳过后续页
    """
    doc = fitz.open(str(pdf_path))
    ref_pages: list[int] = []
    ref_heading_page = None

    for page in doc:
        text = page.get_text().lower()
        if any(kw in text for kw in _REF_KEYWORDS):
            cutoff = max(500, len(text) // 5)
            head = text[:cutoff]
            if any(kw in head for kw in _REF_KEYWORDS):
                ref_heading_page = page.number
            else:
                ref_heading_page = page.number + 1
            break

    if ref_heading_page is not None:
        for pn in range(ref_heading_page, len(doc)):
            ref_pages.append(pn + 1)

    doc.close()
    return ref_pages


def detect_acknowledgement_pages(pdf_path: Path) -> list[int]:
    """检测致谢页（1-based），只跳包含关键词的页。"""
    doc = fitz.open(str(pdf_path))
    ack_pages: list[int] = []

    for page in doc:
        text = page.get_text().lower()
        if any(kw in text for kw in _ACK_KEYWORDS):
            ack_pages.append(page.number + 1)

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
    skip_references: bool = True,
    custom_prompt: str | None = None,
    extra_args: list[str] | None = None,
    on_progress: Callable[[str], None] | None = None,
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
        skip_references: 自动跳过参考文献和致谢页。
        custom_prompt:  自定义翻译 prompt，默认用考古学 prompt。
        extra_args:     传给 pdf2zh.exe 的额外参数。
        on_progress:    进度回调（日志字符串）。

    Returns:
        {
            "mono_pdf": Path | None,
            "dual_pdf": Path | None,
            "returncode": int,
            "stdout": str,
            "stderr": str,
        }
    """
    input_pdf = Path(input_pdf)
    if qps is None:
        qps = config.DEFAULT_QPS
    if on_progress:
        set_logger(on_progress)

    pdf2zh_exe = Path(config.PDF2ZH_EXE)
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
    if skip_references:
        ref_pages = detect_reference_pages(working_pdf)
        ack_pages = detect_acknowledgement_pages(working_pdf)
        skip_pages = set(ref_pages) | set(ack_pages)
        if skip_pages:
            if pages is None:
                candidate_pages = set(range(1, total_pages + 1))
            else:
                candidate_pages = _parse_pages(pages)
            translate_pages = sorted(candidate_pages - skip_pages)
            pages = ",".join(str(p) for p in translate_pages)
            _log(f"[preprocess] Skipping reference pages: {sorted(skip_pages)}")
            _log(f"[preprocess] Translating pages: {pages}")

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
        ]

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

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=1800,
        )

        stem = working_pdf.stem
        mono_candidates = (
            list(output_dir.glob(f"{stem}*mono*.*pdf"))
            + list(output_dir.glob(f"{stem}*translated*.*pdf"))
        )
        dual_candidates = list(output_dir.glob(f"{stem}*dual*.*pdf"))

        mono_pdf = mono_candidates[0] if mono_candidates else None
        dual_pdf = dual_candidates[0] if dual_candidates else None

        if result.returncode == 0:
            _log("[pdf2zh] Translation complete!")
            if mono_pdf:
                _log(f"  Chinese PDF: {mono_pdf}")
            if dual_pdf:
                _log(f"  Dual PDF:    {dual_pdf}")
        else:
            _log(f"[pdf2zh] Translation failed (code={result.returncode})")
            if result.stderr:
                for line in result.stderr.strip().splitlines()[-30:]:
                    _log(f"  {line}")

        # 清理临时文件
        if baked_pdf and baked_pdf.exists():
            baked_pdf.unlink(missing_ok=True)

        return {
            "mono_pdf": mono_pdf,
            "dual_pdf": dual_pdf,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    finally:
        prompt_path.unlink(missing_ok=True)
