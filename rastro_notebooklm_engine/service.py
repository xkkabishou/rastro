from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json
import plistlib
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import SERVICE_NAME, __version__
from .models import ArtifactSummary, AuthStatus, NotebookSummary, NotebookTask, utc_now_iso
from .storage import StateStorage

SUPPORTED_ARTIFACTS = {"mind-map"}
LOGIN_TIMEOUT_SECONDS = 300
LOGIN_POLL_INTERVAL_SECONDS = 2


@dataclass(frozen=True)
class BrowserLoginSource:
    key: str
    label: str
    loader_name: str
    macos_app_name: str | None = None
    bundle_ids: tuple[str, ...] = ()


class ServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        retryable: bool,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status_code = status_code
        self.details = details or {}

    def to_envelope(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            payload["details"] = self.details
        return {"error": payload}


class NotebookLMService:
    """封装 notebooklm-py 的本地服务能力。"""

    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.storage = StateStorage(root_dir)

    def healthz(self) -> dict[str, Any]:
        auth_status = self.storage.load_auth_status()
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "engineVersion": __version__,
            "pythonVersion": sys.version.split()[0],
            "moduleAvailable": importlib.util.find_spec("notebooklm") is not None,
            "authenticated": auth_status.authenticated,
            "downloadRoot": str(self.storage.downloads_dir),
        }

    def get_auth_status(self) -> AuthStatus:
        if not self.storage.storage_state_path.exists():
            status = self.storage.load_auth_status()
            status.authenticated = False
            status.auth_expired = False
            status.last_error = None
            self.storage.save_auth_status(status)
            return status

        try:
            self._run_async(self._list_notebooks_async)
        except ServiceError as error:
            if error.code in {"NOTEBOOKLM_AUTH_REQUIRED", "NOTEBOOKLM_AUTH_EXPIRED"}:
                status = self.storage.load_auth_status()
                status.authenticated = False
                status.auth_expired = error.code == "NOTEBOOKLM_AUTH_EXPIRED"
                status.last_error = error.message
                self.storage.save_auth_status(status)
                return status
            raise

        status = self.storage.load_auth_status()
        status.authenticated = True
        status.auth_expired = False
        status.last_error = None
        if status.last_auth_at is None:
            status.last_auth_at = utc_now_iso()
        self.storage.save_auth_status(status)
        return status

    def begin_login(self) -> AuthStatus:
        self._ensure_notebooklm_available()
        self.storage.auth_dir.mkdir(parents=True, exist_ok=True)
        self._wait_for_browser_session()

        status = self.storage.load_auth_status()
        status.authenticated = True
        status.auth_expired = False
        status.last_auth_at = utc_now_iso()
        status.last_error = None
        self.storage.save_auth_status(status)
        return self.get_auth_status()

    def logout(self) -> AuthStatus:
        self.storage.delete_auth_files()
        browser_profile = self._browser_profile_dir()
        if browser_profile.exists():
            shutil.rmtree(browser_profile, ignore_errors=True)
        status = AuthStatus(
            authenticated=False,
            auth_expired=False,
            last_auth_at=None,
            last_error=None,
        )
        self.storage.save_auth_status(status)
        return status

    def list_notebooks(self) -> list[NotebookSummary]:
        return self._run_async(self._list_notebooks_async)

    def create_notebook(self, title: str, description: str | None = None) -> NotebookSummary:
        if not title.strip():
            raise ServiceError(
                "NOTEBOOKLM_UNKNOWN",
                "Notebook 标题不能为空。",
                retryable=False,
                status_code=400,
            )
        return self._run_async(
            lambda: self._create_notebook_async(title.strip(), description or "")
        )

    def attach_pdf(self, notebook_id: str, pdf_path: str) -> NotebookTask:
        path = Path(pdf_path)
        if not path.exists():
            raise ServiceError(
                "NOTEBOOKLM_UPLOAD_FAILED",
                "待上传的 PDF 文件不存在。",
                retryable=False,
                status_code=404,
                details={"pdfPath": pdf_path},
            )
        if path.suffix.lower() != ".pdf":
            raise ServiceError(
                "NOTEBOOKLM_UPLOAD_FAILED",
                "NotebookLM 目前只接受 PDF 文件。",
                retryable=False,
                status_code=400,
                details={"pdfPath": pdf_path},
            )

        task = self._new_task("upload", notebook_id, None, "正在上传 PDF…")
        self._spawn_background_task(
            task_id=task.id,
            operation=lambda: self._run_async(lambda: self._attach_pdf_async(notebook_id, path)),
            success_message="PDF 上传完成。",
            failure_code="NOTEBOOKLM_UPLOAD_FAILED",
        )
        return task

    def generate_artifact(self, notebook_id: str, artifact_type: str) -> NotebookTask:
        normalized_type = _normalize_artifact_type(artifact_type)
        if normalized_type not in SUPPORTED_ARTIFACTS:
            raise ServiceError(
                "NOTEBOOKLM_GENERATION_FAILED",
                "当前版本仅打通 Mind Map 生成链路。",
                retryable=False,
                status_code=400,
                details={"artifactType": normalized_type},
            )

        task = self._new_task("generate", notebook_id, normalized_type, "正在生成思维导图…")
        self._spawn_background_task(
            task_id=task.id,
            operation=lambda: self._run_async(
                lambda: self._generate_artifact_async(notebook_id, normalized_type)
            ),
            success_message="思维导图生成完成。",
            failure_code="NOTEBOOKLM_GENERATION_FAILED",
        )
        return task

    def get_task(self, task_id: str) -> NotebookTask:
        task = self.storage.get_task(task_id)
        if task is None:
            raise ServiceError(
                "NOTEBOOKLM_UNKNOWN",
                "未找到 NotebookLM 任务。",
                retryable=False,
                status_code=404,
                details={"taskId": task_id},
            )
        return task

    def list_artifacts(self, notebook_id: str) -> list[ArtifactSummary]:
        remote_artifacts = self._run_async(lambda: self._list_artifacts_async(notebook_id))
        local_by_id = {
            artifact.id: artifact
            for artifact in self.storage.list_artifacts()
            if artifact.notebook_id == notebook_id
        }
        merged: list[ArtifactSummary] = []
        for artifact in remote_artifacts:
            local = local_by_id.get(artifact.id)
            if local is not None:
                artifact.download_status = local.download_status
                artifact.local_path = local.local_path
            self.storage.upsert_artifact(artifact)
            merged.append(artifact)
        return merged

    def download_artifact(
        self,
        artifact_id: str,
        artifact_type: str,
        destination_path: str,
    ) -> ArtifactSummary:
        normalized_type = _normalize_artifact_type(artifact_type)
        if normalized_type not in SUPPORTED_ARTIFACTS:
            raise ServiceError(
                "NOTEBOOKLM_DOWNLOAD_FAILED",
                "当前版本仅支持下载 Mind Map 产物。",
                retryable=False,
                status_code=400,
                details={"artifactType": normalized_type},
            )

        task = self._new_task("download", None, normalized_type, "正在下载产物…")
        destination = Path(destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)

        try:
            artifact = self._run_async(
                lambda: self._download_artifact_async(artifact_id, normalized_type, destination)
            )
        except ServiceError as error:
            self._write_task(
                NotebookTask(
                    id=task.id,
                    kind=task.kind,
                    artifact_type=task.artifact_type,
                    status="failed",
                    progress_message=None,
                    error_code=error.code,
                    error_message=error.message,
                    notebook_id=task.notebook_id,
                    created_at=task.created_at,
                    updated_at=utc_now_iso(),
                )
            )
            raise

        self._write_task(
            NotebookTask(
                id=task.id,
                kind=task.kind,
                artifact_type=task.artifact_type,
                status="completed",
                progress_message="产物下载完成。",
                error_code=None,
                error_message=None,
                notebook_id=artifact.notebook_id,
                created_at=task.created_at,
                updated_at=utc_now_iso(),
            )
        )
        self.storage.upsert_artifact(artifact)
        return artifact

    def _new_task(
        self,
        kind: str,
        notebook_id: str | None,
        artifact_type: str | None,
        message: str,
    ) -> NotebookTask:
        now = utc_now_iso()
        task = NotebookTask(
            id=str(uuid.uuid4()),
            kind=kind,
            artifact_type=artifact_type,
            status="running",
            progress_message=message,
            error_code=None,
            error_message=None,
            notebook_id=notebook_id,
            created_at=now,
            updated_at=now,
        )
        return self._write_task(task)

    def _write_task(self, task: NotebookTask) -> NotebookTask:
        return self.storage.upsert_task(task)

    def _spawn_background_task(
        self,
        task_id: str,
        operation: Callable[[], None],
        success_message: str,
        failure_code: str,
    ) -> None:
        def runner() -> None:
            task = self.storage.get_task(task_id)
            if task is None:
                return
            try:
                operation()
                updated = NotebookTask(
                    id=task.id,
                    kind=task.kind,
                    artifact_type=task.artifact_type,
                    status="completed",
                    progress_message=success_message,
                    error_code=None,
                    error_message=None,
                    notebook_id=task.notebook_id,
                    created_at=task.created_at,
                    updated_at=utc_now_iso(),
                )
            except ServiceError as error:
                updated = NotebookTask(
                    id=task.id,
                    kind=task.kind,
                    artifact_type=task.artifact_type,
                    status="failed",
                    progress_message=None,
                    error_code=error.code or failure_code,
                    error_message=error.message,
                    notebook_id=task.notebook_id,
                    created_at=task.created_at,
                    updated_at=utc_now_iso(),
                )
            except Exception as error:  # pragma: no cover
                updated = NotebookTask(
                    id=task.id,
                    kind=task.kind,
                    artifact_type=task.artifact_type,
                    status="failed",
                    progress_message=None,
                    error_code=failure_code,
                    error_message=str(error),
                    notebook_id=task.notebook_id,
                    created_at=task.created_at,
                    updated_at=utc_now_iso(),
                )
            self._write_task(updated)

        threading.Thread(target=runner, daemon=True).start()

    async def _list_notebooks_async(self) -> list[NotebookSummary]:
        client = await self._create_client()
        summaries: list[NotebookSummary] = []
        async with client:
            notebooks = await client.notebooks.list()
            for notebook in notebooks:
                try:
                    sources = await client.sources.list(_get_required_id(notebook))
                    source_count = len(sources)
                except Exception:
                    source_count = int(_get_attr(notebook, "sources_count", default=0) or 0)
                summaries.append(
                    NotebookSummary(
                        id=_get_required_id(notebook),
                        title=str(_get_attr(notebook, "title", default="Untitled Notebook")),
                        source_count=source_count,
                        updated_at=_coerce_optional_str(
                            _get_attr(notebook, "updated_at", "updatedAt", "created_at")
                        ),
                    )
                )
        return summaries

    async def _create_notebook_async(
        self,
        title: str,
        description: str,
    ) -> NotebookSummary:
        client = await self._create_client()
        async with client:
            notebook = await client.notebooks.create(title)
        return NotebookSummary(
            id=_get_required_id(notebook),
            title=str(_get_attr(notebook, "title", default=title)),
            source_count=int(_get_attr(notebook, "sources_count", default=0) or 0),
            updated_at=_coerce_optional_str(
                _get_attr(notebook, "updated_at", "updatedAt", "created_at")
            ),
        )

    async def _attach_pdf_async(self, notebook_id: str, pdf_path: Path) -> None:
        client = await self._create_client()
        async with client:
            await client.sources.add_file(notebook_id, str(pdf_path), wait=True)

    async def _generate_artifact_async(self, notebook_id: str, artifact_type: str) -> None:
        if artifact_type != "mind-map":
            raise ServiceError(
                "NOTEBOOKLM_GENERATION_FAILED",
                "当前版本仅支持思维导图。",
                retryable=False,
                status_code=400,
            )

        client = await self._create_client()
        async with client:
            artifact = await client.artifacts.generate_mind_map(notebook_id)
            artifact_id = _coerce_optional_str(_get_attr(artifact, "note_id", "id", "artifact_id"))
            if artifact_id is None:
                raise ServiceError(
                    "NOTEBOOKLM_GENERATION_FAILED",
                    "Mind Map 已生成，但返回结果里缺少可持久化的 note id。",
                    retryable=True,
                    status_code=502,
                    details={"artifact": artifact},
                )

            title = "Mind Map"
            generated_mind_map = _get_attr(artifact, "mind_map")
            if isinstance(generated_mind_map, dict):
                title = str(generated_mind_map.get("name") or title)

            for candidate in await client.artifacts.list(notebook_id):
                if _get_required_id(candidate) == artifact_id:
                    title = str(_get_attr(candidate, "title", default=title))
                    break
        summary = ArtifactSummary(
            id=artifact_id,
            notebook_id=notebook_id,
            type="mind-map",
            title=title,
            download_status="not-downloaded",
            local_path=None,
            created_at=utc_now_iso(),
        )
        self.storage.upsert_artifact(summary)

    async def _list_artifacts_async(self, notebook_id: str) -> list[ArtifactSummary]:
        client = await self._create_client()
        summaries: list[ArtifactSummary] = []
        async with client:
            artifacts = await client.artifacts.list(notebook_id)
            for artifact in artifacts:
                summaries.append(
                    ArtifactSummary(
                        id=_get_required_id(artifact),
                        notebook_id=notebook_id,
                        type=_normalize_artifact_type(
                            str(_get_attr(artifact, "kind", default="mind-map"))
                        ),
                        title=str(_get_attr(artifact, "title", default="NotebookLM Artifact")),
                        download_status="not-downloaded",
                        local_path=None,
                        created_at=_coerce_optional_str(
                            _get_attr(artifact, "created_at", "createdAt")
                        ),
                    )
                )
        return summaries

    async def _download_artifact_async(
        self,
        artifact_id: str,
        artifact_type: str,
        destination: Path,
    ) -> ArtifactSummary:
        local_record = self.storage.get_artifact(artifact_id)
        if artifact_type != "mind-map":
            raise ServiceError(
                "NOTEBOOKLM_DOWNLOAD_FAILED",
                "当前版本仅支持思维导图下载。",
                retryable=False,
                status_code=400,
            )

        if local_record is None or not local_record.notebook_id:
            raise ServiceError(
                "NOTEBOOKLM_DOWNLOAD_FAILED",
                "缺少 artifact 对应的 notebook 信息，请先刷新产物列表。",
                retryable=False,
                status_code=400,
            )

        client = await self._create_client()
        async with client:
            await client.artifacts.download_mind_map(
                local_record.notebook_id,
                str(destination),
                artifact_id=artifact_id,
            )
        return ArtifactSummary(
            id=artifact_id,
            notebook_id=local_record.notebook_id,
            type=artifact_type,
            title=local_record.title,
            download_status="downloaded",
            local_path=str(destination),
            created_at=local_record.created_at,
        )

    async def _create_client(self) -> Any:
        self._ensure_notebooklm_available()
        if not self.storage.storage_state_path.exists():
            raise ServiceError(
                "NOTEBOOKLM_AUTH_REQUIRED",
                "尚未完成 NotebookLM 登录。",
                retryable=True,
                status_code=401,
            )
        try:
            module = importlib.import_module("notebooklm")
            client_cls = getattr(module, "NotebookLMClient")
            return await client_cls.from_storage(str(self.storage.storage_state_path))
        except FileNotFoundError as error:
            raise ServiceError(
                "NOTEBOOKLM_AUTH_REQUIRED",
                "NotebookLM 登录态文件不存在，请重新登录。",
                retryable=True,
                status_code=401,
                details={"storageStatePath": str(self.storage.storage_state_path)},
            ) from error
        except Exception as error:
            message = str(error)
            code = (
                "NOTEBOOKLM_AUTH_EXPIRED"
                if _looks_like_auth_error(message)
                else "NOTEBOOKLM_ENGINE_UNAVAILABLE"
            )
            raise ServiceError(
                code,
                "无法初始化 NotebookLM 客户端，请重新登录或检查本地依赖。",
                retryable=True,
                status_code=401 if code == "NOTEBOOKLM_AUTH_EXPIRED" else 500,
                details={"cause": message},
            ) from error

    def _ensure_notebooklm_available(self) -> None:
        if importlib.util.find_spec("notebooklm") is None:
            raise ServiceError(
                "NOTEBOOKLM_ENGINE_UNAVAILABLE",
                "未检测到 notebooklm-py，请先执行 `pip install -r requirements.txt`。",
                retryable=False,
                status_code=500,
            )

    def _wait_for_browser_session(self) -> None:
        try:
            import browser_cookie3
        except ImportError as error:
            raise ServiceError(
                "NOTEBOOKLM_ENGINE_UNAVAILABLE",
                "缺少系统浏览器 cookie 读取依赖，请重新执行 `pip install -r requirements.txt`。",
                retryable=False,
                status_code=500,
            ) from error

        login_source, default_browser_label = self._select_login_source(browser_cookie3)
        self._open_login_browser(login_source)

        deadline = time.monotonic() + LOGIN_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self._try_capture_browser_session(browser_cookie3, login_source):
                return
            time.sleep(LOGIN_POLL_INTERVAL_SECONDS)

        raise ServiceError(
            "NOTEBOOKLM_AUTH_REQUIRED",
            f"在限定时间内仍未检测到可用登录态。请在 {login_source.label} 完成 Google 登录后重试。",
            retryable=True,
            status_code=408,
            details={
                "loginBrowser": login_source.label,
                "defaultBrowser": default_browser_label,
            },
        )

    def _try_capture_browser_session(
        self,
        browser_cookie3: Any,
        login_source: BrowserLoginSource,
    ) -> bool:
        storage_state = self._build_storage_state_from_browser(browser_cookie3, login_source)
        if not storage_state["cookies"]:
            return False

        self._write_storage_state(storage_state)
        try:
            self._run_async(self._list_notebooks_async)
        except ServiceError as error:
            if error.code in {"NOTEBOOKLM_AUTH_REQUIRED", "NOTEBOOKLM_AUTH_EXPIRED"}:
                self.storage.delete_auth_files()
                return False
            raise
        return True

    def _build_storage_state_from_browser(
        self,
        browser_cookie3: Any,
        login_source: BrowserLoginSource,
    ) -> dict[str, Any]:
        cookie_loader = getattr(browser_cookie3, login_source.loader_name)
        cookie_jar = cookie_loader(domain_name="google")
        cookies: dict[tuple[str, str, str], dict[str, Any]] = {}
        now = int(time.time())

        for cookie in cookie_jar:
            domain = str(getattr(cookie, "domain", "") or "")
            if not _is_google_cookie_domain(domain):
                continue
            expires = getattr(cookie, "expires", None)
            if expires is not None and expires <= now:
                continue

            normalized_path = str(getattr(cookie, "path", "/") or "/")
            key = (str(cookie.name), domain, normalized_path)
            cookies[key] = {
                "name": str(cookie.name),
                "value": str(cookie.value),
                "domain": domain,
                "path": normalized_path,
                "expires": int(expires) if expires is not None else -1,
                "httpOnly": False,
                "secure": bool(getattr(cookie, "secure", False)),
                "sameSite": "Lax",
            }

        return {
            "cookies": list(cookies.values()),
            "origins": [],
        }

    def _write_storage_state(self, storage_state: dict[str, Any]) -> None:
        self.storage.storage_state_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.storage.storage_state_path.with_suffix(".json.tmp")
        temp_path.write_text(
            json.dumps(storage_state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(self.storage.storage_state_path)
        self.storage.storage_state_path.chmod(0o600)

    def _select_login_source(self, browser_cookie3: Any) -> tuple[BrowserLoginSource, str]:
        default_browser = self._detect_default_browser()
        sources = _browser_login_sources()
        by_bundle_id = {
            bundle_id: source
            for source in sources
            for bundle_id in source.bundle_ids
        }

        default_source = by_bundle_id.get(default_browser["bundle_id"]) if default_browser else None
        if default_source is not None:
            readable, _ = self._probe_browser_source(browser_cookie3, default_source)
            if readable:
                return default_source, default_browser["label"]

        safari_source = next((source for source in sources if source.key == "safari"), None)
        if safari_source is not None:
            readable, _ = self._probe_browser_source(browser_cookie3, safari_source)
            if readable:
                return safari_source, default_browser["label"] if default_browser else "系统默认浏览器"

        if default_source is not None:
            _, reason = self._probe_browser_source(browser_cookie3, default_source)
            raise ServiceError(
                "NOTEBOOKLM_AUTH_REQUIRED",
                f"检测到系统默认浏览器为 {default_browser['label']}，但当前环境无法读取其 Google 登录态。请改用 Safari 完成登录，或手动切换系统默认浏览器后重试。",
                retryable=True,
                status_code=400,
                details={
                    "defaultBrowser": default_browser["label"],
                    "reason": reason,
                },
            )

        raise ServiceError(
            "NOTEBOOKLM_AUTH_REQUIRED",
            "未检测到可用于 NotebookLM 登录的本地浏览器 cookie。请先在 Safari 或受支持浏览器中登录 Google 账号后重试。",
            retryable=True,
            status_code=400,
        )

    def _probe_browser_source(
        self,
        browser_cookie3: Any,
        login_source: BrowserLoginSource,
    ) -> tuple[bool, str | None]:
        try:
            storage_state = self._build_storage_state_from_browser(browser_cookie3, login_source)
            return bool(storage_state["cookies"]), None
        except Exception as error:
            return False, str(error)

    def _open_login_browser(self, login_source: BrowserLoginSource) -> None:
        url = "https://notebooklm.google.com/"
        if sys.platform == "darwin":
            command = ["open"]
            if login_source.macos_app_name:
                command.extend(["-a", login_source.macos_app_name])
            command.append(url)
        elif sys.platform.startswith("linux"):
            command = ["xdg-open", url]
        elif sys.platform == "win32":
            command = ["cmd", "/C", "start", "", url]
        else:
            raise ServiceError(
                "NOTEBOOKLM_ENGINE_UNAVAILABLE",
                f"当前平台 {sys.platform} 暂未实现浏览器拉起逻辑。",
                retryable=False,
                status_code=500,
            )

        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise ServiceError(
                "NOTEBOOKLM_AUTH_REQUIRED",
                f"无法打开 {login_source.label} 进行登录。",
                retryable=True,
                status_code=500,
                details={"stderr": result.stderr.strip(), "browser": login_source.label},
            )

    def _detect_default_browser(self) -> dict[str, str] | None:
        if sys.platform != "darwin":
            return None

        plist_path = Path.home() / "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
        if not plist_path.exists():
            return None

        try:
            payload = plistlib.loads(plist_path.read_bytes())
        except Exception:
            return None

        preferred_bundle_id: str | None = None
        for item in payload.get("LSHandlers", []):
            if item.get("LSHandlerURLScheme") == "https":
                preferred_bundle_id = item.get("LSHandlerRoleAll")
                break

        if not preferred_bundle_id:
            return None

        labels = {
            "com.apple.Safari": "Safari",
            "com.google.Chrome": "Google Chrome",
            "com.brave.Browser": "Brave",
            "org.chromium.Chromium": "Chromium",
            "com.microsoft.edgemac": "Microsoft Edge",
        }
        return {
            "bundle_id": preferred_bundle_id,
            "label": labels.get(preferred_bundle_id, preferred_bundle_id),
        }

    def _browser_profile_dir(self) -> Path:
        return self.storage.auth_dir / "browser-profile"

    def _run_async(self, factory: Callable[[], Any]) -> Any:
        try:
            return asyncio.run(factory())
        except ServiceError:
            raise
        except Exception as error:
            if _looks_like_auth_error(str(error)):
                raise ServiceError(
                    "NOTEBOOKLM_AUTH_EXPIRED",
                    "NotebookLM 登录态已失效，请重新登录。",
                    retryable=True,
                    status_code=401,
                    details={"cause": str(error)},
                ) from error
            raise ServiceError(
                "NOTEBOOKLM_UNKNOWN",
                f"NotebookLM 请求失败: {error}",
                retryable=True,
                status_code=500,
            ) from error


def _normalize_artifact_type(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    aliases = {
        "mindmap": "mind-map",
        "mind-map": "mind-map",
        "mind_map": "mind-map",
        "slides": "slide-deck",
        "slide-deck": "slide-deck",
        "slide_deck": "slide-deck",
        "audiooverview": "audio-overview",
        "audio-overview": "audio-overview",
    }
    return aliases.get(normalized, normalized)


def _get_required_id(value: Any) -> str:
    identifier = _get_attr(value, "id", "note_id", "notebook_id", "artifact_id")
    if identifier is None:
        raise ServiceError(
            "NOTEBOOKLM_UNKNOWN",
            "NotebookLM 返回对象缺少可识别的 id 字段。",
            retryable=False,
            status_code=500,
        )
    return str(identifier)


def _get_attr(value: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if isinstance(value, dict) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    return default


def _coerce_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _looks_like_auth_error(message: str) -> bool:
    lowered = message.lower()
    return any(token in lowered for token in ["401", "auth", "login", "expired", "unauthorized"])


def _is_google_cookie_domain(domain: str) -> bool:
    normalized = domain.lstrip(".").lower()
    return (
        normalized == "notebooklm.google.com"
        or normalized == "google.com"
        or normalized.startswith("google.")
        or ".google." in normalized
        or normalized.endswith("googleusercontent.com")
    )


def _browser_login_sources() -> tuple[BrowserLoginSource, ...]:
    return (
        BrowserLoginSource(
            key="safari",
            label="Safari",
            loader_name="safari",
            macos_app_name="Safari",
            bundle_ids=("com.apple.Safari",),
        ),
        BrowserLoginSource(
            key="chrome",
            label="Google Chrome",
            loader_name="chrome",
            macos_app_name="Google Chrome",
            bundle_ids=("com.google.Chrome",),
        ),
        BrowserLoginSource(
            key="brave",
            label="Brave",
            loader_name="brave",
            macos_app_name="Brave Browser",
            bundle_ids=("com.brave.Browser",),
        ),
        BrowserLoginSource(
            key="chromium",
            label="Chromium",
            loader_name="chromium",
            macos_app_name="Chromium",
            bundle_ids=("org.chromium.Chromium",),
        ),
        BrowserLoginSource(
            key="edge",
            label="Microsoft Edge",
            loader_name="edge",
            macos_app_name="Microsoft Edge",
            bundle_ids=("com.microsoft.edgemac",),
        ),
    )
