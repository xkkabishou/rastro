"""antigravity-translate — 考古学 PDF 翻译后端。

快速上手：

    from antigravity_translate import config, translate

    # 配置（或通过环境变量）
    config.PDF2ZH_EXE = r"D:\\tools\\pdf2zh.exe"
    config.CLAUDE_API_KEY = "your-key"

    # 翻译
    result = translate("paper.pdf", output_dir="output")
    print(result["mono_pdf"])  # 中文 PDF 路径
"""

from .config import *  # noqa: F401,F403 — 让 config 属性可直接访问
from .core import (
    bake_rotations,
    build_glossary_csv,
    detect_acknowledgement_pages,
    detect_reference_pages,
    set_logger,
    translate,
)

__all__ = [
    "translate",
    "set_logger",
    "bake_rotations",
    "detect_reference_pages",
    "detect_acknowledgement_pages",
    "build_glossary_csv",
]

__version__ = "1.0.0"
