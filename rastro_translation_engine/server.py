"""rastro_translation_engine HTTP 服务。

实现 Rust 端 TranslationHttpClient 期望的 REST API 契约：
  GET  /healthz           — 健康检查
  POST /v1/jobs           — 创建翻译任务
  GET  /v1/jobs/{job_id}  — 查询任务状态
  DELETE /v1/jobs/{job_id} — 取消任务
  POST /control/shutdown  — 优雅关闭
"""

from __future__ import annotations

import os
import platform
import signal
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

from . import __version__, SERVICE_NAME
from .worker import TranslationWorker


# 全局 Worker 实例
_worker = TranslationWorker()
_start_time = time.time()
_shutdown_event = threading.Event()


class EngineHandler(BaseHTTPRequestHandler):
    """轻量级 HTTP handler，无外部依赖。"""

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._handle_healthz()
        elif self.path.startswith("/v1/jobs/"):
            job_id = self.path.split("/v1/jobs/", 1)[1].rstrip("/")
            self._handle_get_job(job_id)
        else:
            self._send_json(404, {"error": {"code": "NOT_FOUND", "message": f"未知路径: {self.path}"}})

    def do_POST(self) -> None:
        if self.path == "/v1/jobs":
            self._handle_create_job()
        elif self.path == "/control/shutdown":
            self._handle_shutdown()
        else:
            self._send_json(404, {"error": {"code": "NOT_FOUND", "message": f"未知路径: {self.path}"}})

    def do_DELETE(self) -> None:
        if self.path.startswith("/v1/jobs/"):
            job_id = self.path.split("/v1/jobs/", 1)[1].rstrip("/")
            self._handle_cancel_job(job_id)
        else:
            self._send_json(404, {"error": {"code": "NOT_FOUND", "message": f"未知路径: {self.path}"}})

    # ── Handlers ──────────────────────────────────────────────────

    def _handle_healthz(self) -> None:
        """健康检查端点。service 字段必须为 'translation-engine-system'，
        engine_version 必须非空，否则 Rust 端的 valid_health_signature 会拒绝。
        """
        self._send_json(200, {
            "status": "ok",
            "service": SERVICE_NAME,
            "engineVersion": __version__,
            "pythonVersion": platform.python_version(),
            "uptimeSeconds": int(time.time() - _start_time),
            "queueDepth": _worker.queue_depth,
            "activeJobId": _worker.active_job_id,
        })

    def _handle_create_job(self) -> None:
        """创建翻译任务。映射 Rust 端 CreateJobRequest。"""
        body = self._read_body()
        if body is None:
            return

        try:
            job = _worker.create_job(body)
            self._send_json(200, {
                "jobId": job.job_id,
                "status": job.status.value,
                "queuePosition": _worker.queue_depth,
                "cacheHit": False,
                "pollAfterMs": 1000,
            })
        except Exception as exc:
            self._send_json(500, {
                "error": {
                    "code": "ENGINE_ERROR",
                    "message": f"创建翻译任务失败: {exc}",
                    "retryable": True,
                }
            })

    def _handle_get_job(self, job_id: str) -> None:
        """查询任务状态。映射 Rust 端 GetJobResponse。"""
        job = _worker.get_job(job_id)
        if not job:
            self._send_json(404, {
                "error": {
                    "code": "JOB_NOT_FOUND",
                    "message": f"未找到任务: {job_id}",
                    "retryable": False,
                }
            })
            return
        self._send_json(200, job.to_dict())

    def _handle_cancel_job(self, job_id: str) -> None:
        """取消任务。映射 Rust 端 CancelJobResponse。"""
        cancelled = _worker.cancel_job(job_id)
        self._send_json(200, {
            "jobId": job_id,
            "cancelled": cancelled,
        })

    def _handle_shutdown(self) -> None:
        """优雅关闭。映射 Rust 端 ShutdownResponse。"""
        self._send_json(200, {
            "accepted": True,
            "activeJobId": _worker.active_job_id,
        })
        # 在响应发送后安排关闭
        threading.Thread(target=_delayed_shutdown, daemon=True).start()

    # ── 工具方法 ──────────────────────────────────────────────────

    def _read_body(self) -> dict | None:
        """读取并解析 JSON 请求体。"""
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            return json.loads(raw) if raw else {}
        except (json.JSONDecodeError, ValueError) as exc:
            self._send_json(400, {
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": f"无法解析请求体: {exc}",
                    "retryable": False,
                }
            })
            return None

    def _send_json(self, status: int, data: dict) -> None:
        """发送 JSON 响应。"""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        """覆盖默认日志，使用标准格式。"""
        sys.stderr.write(f"[translation-engine] {args[0]} {args[1]} {args[2]}\n")


def _delayed_shutdown() -> None:
    """延迟 500ms 后设置关闭事件。"""
    time.sleep(0.5)
    _shutdown_event.set()


def run_server(host: str = "127.0.0.1", port: int = 8890) -> None:
    """启动翻译引擎 HTTP 服务。"""
    server = HTTPServer((host, port), EngineHandler)
    server.timeout = 1.0  # 让 handle_request 每秒检查一次关闭事件

    # 注册 SIGTERM 优雅关闭
    def sigterm_handler(signum: int, frame: object) -> None:
        _shutdown_event.set()

    signal.signal(signal.SIGTERM, sigterm_handler)

    print(f"[translation-engine] 服务已启动: http://{host}:{port}", flush=True)
    print(f"[translation-engine] 版本: {__version__}", flush=True)

    while not _shutdown_event.is_set():
        server.handle_request()

    server.server_close()
    print("[translation-engine] 服务已关闭", flush=True)
