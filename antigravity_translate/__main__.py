"""CLI 入口：python -m antigravity_translate paper.pdf -o output/"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import config  # noqa: F401
from .core import translate


def main() -> None:
    parser = argparse.ArgumentParser(
        description="antigravity-translate: 考古学 PDF 英译中（保留原版排版）"
    )
    parser.add_argument("pdf", help="输入 PDF 路径")
    parser.add_argument("-o", "--output", help="输出目录")
    parser.add_argument("--glossary", help="术语表 CSV 路径")
    parser.add_argument("--pages", "-p", help="页码范围，如 1-3,5")
    parser.add_argument("--no-dual", action="store_true", help="不生成双语 PDF")
    parser.add_argument("--no-mono", action="store_true", help="不生成纯中文 PDF")
    parser.add_argument("--no-skip-refs", action="store_true",
                        help="不自动跳过参考文献和致谢页")
    parser.add_argument("--debug", action="store_true", help="开启 debug 模式")
    parser.add_argument("--qps", type=int, default=None, help="QPS 限制（默认 2）")
    parser.add_argument("--pdf2zh-exe", help="pdf2zh.exe 路径")
    parser.add_argument("--api-base-url", help="LLM API base URL")
    parser.add_argument("--api-key", help="LLM API key")
    parser.add_argument("--model", help="LLM 模型名")
    args = parser.parse_args()

    # 命令行参数覆盖配置
    if args.pdf2zh_exe:
        config.PDF2ZH_EXE = args.pdf2zh_exe
    if args.api_base_url:
        config.CLAUDE_BASE_URL = args.api_base_url
    if args.api_key:
        config.CLAUDE_API_KEY = args.api_key
    if args.model:
        config.CLAUDE_MODEL = args.model

    result = translate(
        input_pdf=Path(args.pdf),
        output_dir=Path(args.output) if args.output else None,
        glossary_csv=Path(args.glossary) if args.glossary else None,
        pages=args.pages,
        no_dual=args.no_dual,
        no_mono=args.no_mono,
        debug=args.debug,
        qps=args.qps,
        skip_references=not args.no_skip_refs,
    )

    sys.exit(result["returncode"])


if __name__ == "__main__":
    main()
