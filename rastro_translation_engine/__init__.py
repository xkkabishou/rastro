"""rastro_translation_engine — Rastro 翻译引擎 HTTP 服务。

通过 python -m rastro_translation_engine 启动，
提供 /healthz、/v1/jobs、/control/shutdown 等 REST API，
底层调用 antigravity_translate 执行 PDF 翻译。
"""

__version__ = "1.0.0"
SERVICE_NAME = "translation-engine-system"
