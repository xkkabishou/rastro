"""翻译后端配置。

桌面端集成时，在调用翻译前设置这些值：

    from antigravity_translate import config
    config.PDF2ZH_EXE = r"D:\\tools\\pdf2zh.exe"
    config.CLAUDE_BASE_URL = "https://..."
    config.CLAUDE_API_KEY = "sk-..."

也可以通过环境变量配置（优先级低于直接赋值）：
    AG_PDF2ZH_EXE, AG_CLAUDE_BASE_URL, AG_CLAUDE_API_KEY, AG_CLAUDE_MODEL
"""

from __future__ import annotations

import os
from pathlib import Path

# ── pdf2zh 可执行文件路径 ──────────────────────────────────────────
PDF2ZH_EXE: str | Path = os.environ.get(
    "AG_PDF2ZH_EXE", r"C:\软件\pdf2zh\pdf2zh\pdf2zh.exe"
)

# ── LLM API ───────────────────────────────────────────────────────
CLAUDE_BASE_URL: str = os.environ.get(
    "AG_CLAUDE_BASE_URL", "https://cpa.wushangzhizunmolongdadijiayuqi.xyz/v1"
)
CLAUDE_API_KEY: str = os.environ.get("AG_CLAUDE_API_KEY", "200521")
CLAUDE_MODEL: str = os.environ.get("AG_CLAUDE_MODEL", "Claude Sonnet 4.6")

# ── 翻译参数默认值 ────────────────────────────────────────────────
DEFAULT_QPS: int = 2
DEFAULT_LANG_IN: str = "en"
DEFAULT_LANG_OUT: str = "zh"
