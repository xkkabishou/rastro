"""rastro_notebooklm_engine HTTP 服务。"""

from __future__ import annotations

import json
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import SERVICE_NAME, __version__
from .service import NotebookLMService, ServiceError

_shutdown_event = threading.Event()


def build_handler(service: NotebookLMService):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            try:
                if parsed.path == "/healthz":
                    self._send_json(200, service.healthz())
                elif parsed.path == "/auth/status":
                    self._send_json(200, service.get_auth_status().to_dict())
                elif parsed.path == "/notebooks":
                    notebooks = [notebook.to_dict() for notebook in service.list_notebooks()]
                    self._send_json(200, {"items": notebooks})
                elif parsed.path.startswith("/tasks/"):
                    task_id = parsed.path.split("/tasks/", 1)[1].rstrip("/")
                    self._send_json(200, service.get_task(task_id).to_dict())
                elif parsed.path.startswith("/notebooks/") and parsed.path.endswith("/artifacts"):
                    notebook_id = parsed.path.split("/notebooks/", 1)[1].rsplit("/artifacts", 1)[0]
                    artifacts = [
                        artifact.to_dict() for artifact in service.list_artifacts(notebook_id)
                    ]
                    self._send_json(200, {"items": artifacts})
                else:
                    raise ServiceError("NOT_FOUND", f"未知路径: {parsed.path}", False, 404)
            except ServiceError as error:
                self._send_error_envelope(error)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            try:
                if parsed.path == "/auth/login":
                    self._send_json(200, service.begin_login().to_dict())
                    return
                if parsed.path == "/auth/logout":
                    self._send_json(200, service.logout().to_dict())
                    return
                if parsed.path == "/notebooks":
                    body = self._read_body()
                    notebook = service.create_notebook(
                        title=str(body.get("title", "")).strip(),
                        description=_optional_str(body.get("description")),
                    )
                    self._send_json(200, notebook.to_dict())
                    return
                if parsed.path.startswith("/notebooks/") and parsed.path.endswith("/sources/pdf"):
                    notebook_id = parsed.path.split("/notebooks/", 1)[1].rsplit("/sources/pdf", 1)[0]
                    body = self._read_body()
                    task = service.attach_pdf(
                        notebook_id=notebook_id,
                        pdf_path=str(body.get("pdfPath", "")),
                    )
                    self._send_json(200, task.to_dict())
                    return
                if parsed.path.startswith("/notebooks/") and parsed.path.endswith("/artifacts"):
                    notebook_id = parsed.path.split("/notebooks/", 1)[1].rsplit("/artifacts", 1)[0]
                    body = self._read_body()
                    task = service.generate_artifact(
                        notebook_id=notebook_id,
                        artifact_type=str(body.get("artifactType", "mind-map")),
                    )
                    self._send_json(200, task.to_dict())
                    return
                if parsed.path.startswith("/artifacts/") and parsed.path.endswith("/download"):
                    artifact_id = parsed.path.split("/artifacts/", 1)[1].rsplit("/download", 1)[0]
                    body = self._read_body()
                    artifact = service.download_artifact(
                        artifact_id=artifact_id,
                        artifact_type=str(body.get("artifactType", "mind-map")),
                        destination_path=str(body.get("destinationPath", "")),
                    )
                    self._send_json(200, artifact.to_dict())
                    return
                if parsed.path == "/control/shutdown":
                    self._send_json(
                        200,
                        {
                            "accepted": True,
                            "service": SERVICE_NAME,
                            "engineVersion": __version__,
                        },
                    )
                    threading.Thread(target=_delayed_shutdown, daemon=True).start()
                    return
                raise ServiceError("NOT_FOUND", f"未知路径: {parsed.path}", False, 404)
            except ServiceError as error:
                self._send_error_envelope(error)

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            sys.stderr.write(f"[notebooklm-engine] {args[0]} {args[1]} {args[2]}\n")

        def _read_body(self) -> dict:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as error:
                raise ServiceError(
                    "INVALID_REQUEST",
                    f"无法解析请求体: {error}",
                    retryable=False,
                    status_code=400,
                ) from error

        def _send_error_envelope(self, error: ServiceError) -> None:
            self._send_json(error.status_code, error.to_envelope())

        def _send_json(self, status: int, data: dict) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def run_server(host: str, port: int, data_dir: Path) -> None:
    service = NotebookLMService(data_dir)
    handler = build_handler(service)
    server = ThreadingHTTPServer((host, port), handler)
    server.timeout = 1.0

    def sigterm_handler(signum: int, frame: object) -> None:
        _shutdown_event.set()

    signal.signal(signal.SIGTERM, sigterm_handler)

    print(f"[notebooklm-engine] 服务已启动: http://{host}:{port}", flush=True)
    print(f"[notebooklm-engine] 数据目录: {data_dir}", flush=True)

    while not _shutdown_event.is_set():
        server.handle_request()

    server.server_close()
    print("[notebooklm-engine] 服务已关闭", flush=True)


def _delayed_shutdown() -> None:
    _shutdown_event.set()


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
