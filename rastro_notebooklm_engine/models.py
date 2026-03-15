from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Literal


NotebookLMArtifactType = Literal[
    "mind-map",
    "slide-deck",
    "quiz",
    "flashcards",
    "audio-overview",
    "report",
]
NotebookLMTaskKind = Literal["upload", "generate", "download"]
NotebookLMTaskStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
DownloadStatus = Literal["not-downloaded", "downloaded", "failed"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class AuthStatus:
    authenticated: bool
    auth_expired: bool
    last_auth_at: str | None
    last_error: str | None

    def to_dict(self) -> dict:
        payload = asdict(self)
        return {
            "authenticated": payload["authenticated"],
            "authExpired": payload["auth_expired"],
            "lastAuthAt": payload["last_auth_at"],
            "lastError": payload["last_error"],
        }


@dataclass(slots=True)
class NotebookSummary:
    id: str
    title: str
    source_count: int
    updated_at: str | None

    def to_dict(self) -> dict:
        payload = asdict(self)
        return {
            "id": payload["id"],
            "title": payload["title"],
            "sourceCount": payload["source_count"],
            "updatedAt": payload["updated_at"],
        }


@dataclass(slots=True)
class NotebookTask:
    id: str
    kind: NotebookLMTaskKind
    artifact_type: NotebookLMArtifactType | None
    status: NotebookLMTaskStatus
    progress_message: str | None
    error_code: str | None
    error_message: str | None
    notebook_id: str | None
    created_at: str
    updated_at: str

    def to_dict(self) -> dict:
        payload = asdict(self)
        return {
            "id": payload["id"],
            "kind": payload["kind"],
            "artifactType": payload["artifact_type"],
            "status": payload["status"],
            "progressMessage": payload["progress_message"],
            "errorCode": payload["error_code"],
            "errorMessage": payload["error_message"],
            "notebookId": payload["notebook_id"],
            "createdAt": payload["created_at"],
            "updatedAt": payload["updated_at"],
        }


@dataclass(slots=True)
class ArtifactSummary:
    id: str
    notebook_id: str
    type: NotebookLMArtifactType
    title: str
    download_status: DownloadStatus
    local_path: str | None
    created_at: str | None

    def to_dict(self) -> dict:
        payload = asdict(self)
        return {
            "id": payload["id"],
            "notebookId": payload["notebook_id"],
            "type": payload["type"],
            "title": payload["title"],
            "downloadStatus": payload["download_status"],
            "localPath": payload["local_path"],
            "createdAt": payload["created_at"],
        }
