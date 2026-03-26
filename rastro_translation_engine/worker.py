"""翻译任务 Worker — 桥接 Rust 端 HTTP 请求和 antigravity_translate 翻译核心。"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable





class JobStatus(str, Enum):
    """任务状态枚举，与 Rust 端 http_client 的契约一致。"""
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class JobResult:
    """翻译产物路径，映射 Rust 端 EngineJobResult。"""
    translated_pdf_path: str | None = None
    bilingual_pdf_path: str | None = None
    figure_report_path: str | None = None
    manifest_path: str | None = None

    def to_dict(self) -> dict:
        return {
            "translatedPdfPath": self.translated_pdf_path,
            "bilingualPdfPath": self.bilingual_pdf_path,
            "figureReportPath": self.figure_report_path,
            "manifestPath": self.manifest_path,
        }


@dataclass
class JobError:
    """错误信息，映射 Rust 端 EngineJobError。"""
    code: str = "UPSTREAM_TRANSLATOR_ERROR"
    message: str = ""
    retryable: bool = False
    details: dict | None = None

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
        }


@dataclass
class TranslationJob:
    """单个翻译任务的内存表示。"""
    job_id: str
    request_id: str
    document_id: str
    cache_key: str
    pdf_path: str
    output_dir: str
    source_lang: str
    target_lang: str
    provider: str
    model: str
    api_key: str
    base_url: str | None
    output_mode: str
    figure_translation: bool
    skip_reference_pages: bool
    force_refresh: bool
    timeout_seconds: int
    custom_prompt: str | None = None

    status: JobStatus = JobStatus.QUEUED
    stage: str = "queued"
    progress: float = 0.0
    started_at: str | None = None
    updated_at: str | None = None
    result: JobResult | None = None
    error: JobError | None = None
    _cancel_event: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict:
        """序列化为 Rust 端 GetJobResponse 兼容的 JSON。"""
        data: dict[str, Any] = {
            "jobId": self.job_id,
            "documentId": self.document_id,
            "status": self.status.value,
            "stage": self.stage,
            "progress": self.progress,
            "provider": self.provider,
            "model": self.model,
            "startedAt": self.started_at,
            "updatedAt": self.updated_at,
        }
        if self.result:
            data["result"] = self.result.to_dict()
        if self.error:
            data["error"] = self.error.to_dict()
        return data


class TranslationWorker:
    """单线程翻译工作器，管理任务队列并驱动 antigravity_translate。"""

    def __init__(self) -> None:
        self._jobs: dict[str, TranslationJob] = {}
        self._lock = threading.Lock()
        self._active_job_id: str | None = None
        self._worker_thread: threading.Thread | None = None
        self._queue: list[str] = []

    @property
    def active_job_id(self) -> str | None:
        return self._active_job_id

    @property
    def queue_depth(self) -> int:
        with self._lock:
            return len(self._queue)

    def create_job(self, params: dict) -> TranslationJob:
        """创建翻译任务并加入队列。"""
        job_id = str(uuid.uuid4())

        job = TranslationJob(
            job_id=job_id,
            request_id=params.get("requestId", ""),
            document_id=params.get("documentId", ""),
            cache_key=params.get("cacheKey", ""),
            pdf_path=params.get("pdfPath", ""),
            output_dir=params.get("outputDir", ""),
            source_lang=params.get("sourceLang", "en"),
            target_lang=params.get("targetLang", "zh"),
            provider=params.get("provider", ""),
            model=params.get("model", ""),
            api_key=params.get("providerAuth", {}).get("apiKey", ""),
            base_url=params.get("providerAuth", {}).get("baseUrl"),
            output_mode=params.get("outputMode", "bilingual"),
            figure_translation=params.get("figureTranslation", True),
            skip_reference_pages=params.get("skipReferencePages", False),
            force_refresh=params.get("forceRefresh", False),
            timeout_seconds=params.get("timeoutSeconds", 1800),
            custom_prompt=params.get("customPrompt"),
        )

        with self._lock:
            self._jobs[job_id] = job
            self._queue.append(job_id)

        self._ensure_worker_running()
        return job

    def get_job(self, job_id: str) -> TranslationJob | None:
        """获取任务信息。"""
        with self._lock:
            return self._jobs.get(job_id)

    def cancel_job(self, job_id: str) -> bool:
        """取消任务。"""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                return False
            # 如果还在队列中直接移除
            if job_id in self._queue:
                self._queue.remove(job_id)
                job.status = JobStatus.CANCELLED
                job.stage = "cancelled"
                job.updated_at = _now_iso()
                return True
            # 如果正在运行，设置取消标志
            job._cancel_event.set()
            return True

    def _ensure_worker_running(self) -> None:
        """确保后台工作线程在运行。"""
        if self._worker_thread and self._worker_thread.is_alive():
            return
        self._worker_thread = threading.Thread(
            target=self._worker_loop, daemon=True, name="translation-worker"
        )
        self._worker_thread.start()

    def _worker_loop(self) -> None:
        """后台工作循环，逐个处理队列中的任务。"""
        while True:
            with self._lock:
                if not self._queue:
                    self._active_job_id = None
                    return
                job_id = self._queue.pop(0)
                self._active_job_id = job_id

            self._execute_job(job_id)

    def _execute_job(self, job_id: str) -> None:
        """执行单个翻译任务。"""
        job = self._jobs.get(job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.stage = "preflight"
        job.progress = 0.0
        job.started_at = _now_iso()
        job.updated_at = _now_iso()

        try:
            # 延迟导入 antigravity_translate，避免服务启动时加载 PyMuPDF
            from antigravity_translate import translate as ag_translate
            from antigravity_translate import config as ag_config

            # 配置 antigravity_translate（使用前端传来的 API 设置）
            # 各 provider 的默认 OpenAI 兼容端点
            _DEFAULT_BASE_URLS: dict[str, str] = {
                "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
                "openai": "https://api.openai.com/v1",
            }
            base_url = job.base_url or _DEFAULT_BASE_URLS.get(job.provider, "")
            if base_url:
                ag_config.CLAUDE_BASE_URL = base_url
            ag_config.CLAUDE_API_KEY = job.api_key
            ag_config.CLAUDE_MODEL = job.model

            # 确定翻译参数
            no_dual = job.output_mode == "translated_only"
            no_mono = False

            # ── 进度估算器 ──────────────────────────────────────────
            # Rich Progress 在非 TTY 环境下不输出中间进度，无法从 stderr
            # 解析实时百分比。改用基于总页数的时间估算线性推进进度条。
            _est_seconds_per_page = 12  # QPS=10, workers=8 下的粗略估计
            _progress_timer: threading.Timer | None = None
            _total_pages: int = 0
            _translate_started = threading.Event()

            def _tick_progress() -> None:
                """后台定时器：每 3 秒匀速推进，上限 0.95。"""
                if job.status != JobStatus.RUNNING:
                    return
                if job.progress < 0.95:
                    job.progress = min(job.progress + 0.005, 0.95)
                    job.updated_at = _now_iso()
                nonlocal _progress_timer
                _progress_timer = threading.Timer(3.0, _tick_progress)
                _progress_timer.daemon = True
                _progress_timer.start()

            def progress_callback(msg: str) -> None:
                """进度回调，更新任务状态。"""
                nonlocal _total_pages, _progress_timer
                job.updated_at = _now_iso()
                if "[preprocess]" in msg:
                    job.stage = "extracting"
                    job.progress = 0.15
                elif "[pdf2zh] Starting" in msg:
                    job.stage = "translating"
                    job.progress = 0.35
                elif "[pdf2zh] Translation complete" in msg:
                    # 翻译结束，停止计时器
                    if _progress_timer:
                        _progress_timer.cancel()
                    job.stage = "postprocessing"
                    job.progress = 0.9
                elif "[pdf2zh] Model:" in msg:
                    job.stage = "translating"
                    job.progress = max(job.progress, 0.40)
                    # 收到 Model 信息说明 pdf2zh 开始工作，启动计时器
                    if not _translate_started.is_set():
                        _translate_started.set()
                        _tick_progress()
                elif "[pdf2zh:total_pages]" in msg:
                    try:
                        _total_pages = int(
                            msg.split("[pdf2zh:total_pages]")[1].strip()
                        )
                    except (ValueError, IndexError):
                        pass

            # 调用翻译核心
            result = ag_translate(
                input_pdf=Path(job.pdf_path),
                output_dir=Path(job.output_dir),
                pages=None,
                no_dual=no_dual,
                no_mono=no_mono,
                debug=False,
                skip_references=job.skip_reference_pages,
                custom_prompt=job.custom_prompt,
                on_progress=progress_callback,
                cancel_event=job._cancel_event,
            )

            # 确保计时器停止
            if _progress_timer:
                _progress_timer.cancel()

            if result.get("cancelled") or job._cancel_event.is_set():
                job.status = JobStatus.CANCELLED
                job.stage = "cancelled"
                job.progress = 0.0
                job.error = JobError(
                    code="JOB_CANCELLED",
                    message="翻译任务已取消",
                    retryable=False,
                )
            elif result["returncode"] == 0:
                job.status = JobStatus.COMPLETED
                job.stage = "completed"
                job.progress = 1.0
                job.result = JobResult(
                    translated_pdf_path=str(result["mono_pdf"]) if result.get("mono_pdf") else None,
                    bilingual_pdf_path=str(result["dual_pdf"]) if result.get("dual_pdf") else None,
                )
            else:
                job.status = JobStatus.FAILED
                job.stage = "failed"
                stderr = result.get("stderr", "")
                job.error = JobError(
                    code="UPSTREAM_TRANSLATOR_ERROR",
                    message=f"pdf2zh 翻译失败 (code={result['returncode']}): {stderr[-500:]}",
                    retryable=True,
                )

        except FileNotFoundError as exc:
            job.status = JobStatus.FAILED
            job.stage = "failed"
            job.error = JobError(
                code="FILE_NOT_FOUND",
                message=str(exc),
                retryable=False,
            )
        except Exception as exc:
            job.status = JobStatus.FAILED
            job.stage = "failed"
            job.error = JobError(
                code="UPSTREAM_TRANSLATOR_ERROR",
                message=f"翻译异常: {exc}",
                retryable=True,
            )
        finally:
            job.updated_at = _now_iso()
            with self._lock:
                if self._active_job_id == job_id:
                    self._active_job_id = None


def _now_iso() -> str:
    """返回 ISO 8601 时间戳。"""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
