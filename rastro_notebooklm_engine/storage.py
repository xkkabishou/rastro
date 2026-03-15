from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from .models import ArtifactSummary, AuthStatus, NotebookTask


class StateStorage:
    """管理 NotebookLM 本地状态文件。"""

    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.auth_dir = root_dir / "auth"
        self.downloads_dir = root_dir / "downloads"
        self.cache_dir = root_dir / "cache"
        self.auth_file = self.cache_dir / "auth_status.json"
        self.tasks_file = self.cache_dir / "tasks.json"
        self.artifacts_file = self.cache_dir / "artifacts.json"
        self.storage_state_path = self.auth_dir / "storage_state.json"
        self._lock = threading.RLock()

        self.auth_dir.mkdir(parents=True, exist_ok=True)
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def load_auth_status(self) -> AuthStatus:
        payload = self._read_json(self.auth_file, default={})
        return AuthStatus(
            authenticated=bool(payload.get("authenticated", False)),
            auth_expired=bool(payload.get("authExpired", False)),
            last_auth_at=payload.get("lastAuthAt"),
            last_error=payload.get("lastError"),
        )

    def save_auth_status(self, status: AuthStatus) -> None:
        self._write_json(self.auth_file, status.to_dict())

    def upsert_task(self, task: NotebookTask) -> NotebookTask:
        payload = self._read_json(self.tasks_file, default={})
        payload[task.id] = task.to_dict()
        self._write_json(self.tasks_file, payload)
        return task

    def get_task(self, task_id: str) -> NotebookTask | None:
        payload = self._read_json(self.tasks_file, default={})
        raw = payload.get(task_id)
        if raw is None:
            return None
        return NotebookTask(
            id=raw["id"],
            kind=raw["kind"],
            artifact_type=raw.get("artifactType"),
            status=raw["status"],
            progress_message=raw.get("progressMessage"),
            error_code=raw.get("errorCode"),
            error_message=raw.get("errorMessage"),
            notebook_id=raw.get("notebookId"),
            created_at=raw["createdAt"],
            updated_at=raw["updatedAt"],
        )

    def list_tasks(self) -> list[NotebookTask]:
        payload = self._read_json(self.tasks_file, default={})
        tasks = [self.get_task(task_id) for task_id in payload]
        return [task for task in tasks if task is not None]

    def upsert_artifact(self, artifact: ArtifactSummary) -> ArtifactSummary:
        payload = self._read_json(self.artifacts_file, default={})
        payload[artifact.id] = artifact.to_dict()
        self._write_json(self.artifacts_file, payload)
        return artifact

    def get_artifact(self, artifact_id: str) -> ArtifactSummary | None:
        payload = self._read_json(self.artifacts_file, default={})
        raw = payload.get(artifact_id)
        if raw is None:
            return None
        return ArtifactSummary(
            id=raw["id"],
            notebook_id=raw["notebookId"],
            type=raw["type"],
            title=raw["title"],
            download_status=raw["downloadStatus"],
            local_path=raw.get("localPath"),
            created_at=raw.get("createdAt"),
        )

    def list_artifacts(self) -> list[ArtifactSummary]:
        payload = self._read_json(self.artifacts_file, default={})
        artifacts = [self.get_artifact(artifact_id) for artifact_id in payload]
        return [artifact for artifact in artifacts if artifact is not None]

    def delete_auth_files(self) -> None:
        with self._lock:
            if self.storage_state_path.exists():
                self.storage_state_path.unlink()

    def _read_json(self, path: Path, default: Any) -> Any:
        with self._lock:
            if not path.exists():
                return default
            return json.loads(path.read_text(encoding="utf-8"))

    def _write_json(self, path: Path, payload: Any) -> None:
        temp_path = path.with_suffix(f"{path.suffix}.tmp")
        with self._lock:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(path)
