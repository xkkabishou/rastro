"""Worker 真实进度映射测试。"""

from __future__ import annotations

import time
import unittest

from rastro_translation_engine.worker import (
    HEARTBEAT_INTERVAL_SECONDS,
    HEARTBEAT_PROGRESS_CAP,
    VISIBLE_START_PROGRESS,
    JobStatus,
    TranslationJob,
    TranslationWorker,
)


class TranslationWorkerProgressTests(unittest.TestCase):
    """验证 _apply_progress_event 正确映射 BabelDOC 进度事件。"""

    def _job(self) -> TranslationJob:
        return TranslationJob(
            job_id="job-1",
            request_id="req-1",
            document_id="doc-1",
            cache_key="cache-1",
            pdf_path="/tmp/paper.pdf",
            output_dir="/tmp/out",
            source_lang="en",
            target_lang="zh",
            provider="claude",
            model="test-model",
            api_key="test-key",
            base_url="https://example.test/v1",
            output_mode="bilingual",
            figure_translation=True,
            skip_reference_pages=False,
            force_refresh=False,
            timeout_seconds=1800,
        )

    def test_translate_stage_maps_to_existing_stage_names(self):
        """translate 阶段应映射为 translating。"""
        job = self._job()
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_update",
                "stage": "translate",
                "overall_progress": 56.0,
                "stage_current": 28,
                "stage_total": 50,
            },
        )

        self.assertEqual(job.stage, "translating")
        self.assertAlmostEqual(job.progress, 0.56)

    def test_extract_stage_never_regresses_progress(self):
        """进度不应回退。"""
        job = self._job()
        job.progress = 0.62
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_update",
                "stage": "extract",
                "overall_progress": 14.0,
            },
        )

        self.assertEqual(job.stage, "extracting")
        self.assertAlmostEqual(job.progress, 0.62)

    def test_postprocessing_stage_mapping(self):
        """write/export/finish 阶段应映射为 postprocessing。"""
        job = self._job()
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_update",
                "stage": "write",
                "overall_progress": 90.0,
            },
        )

        self.assertEqual(job.stage, "postprocessing")
        self.assertAlmostEqual(job.progress, 0.90)

    def test_progress_capped_at_098(self):
        """进度上限为 0.98，留给完成状态。"""
        job = self._job()
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_update",
                "stage": "translate",
                "overall_progress": 100.0,
            },
        )

        self.assertAlmostEqual(job.progress, 0.98)

    def test_babeldoc_long_translate_stage_sets_visible_progress(self):
        """BabelDOC 真实长阶段名应映射为 translating，0 进度也要给 UI 最小可见值。"""
        job = self._job()
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_start",
                "stage": "Translate Paragraphs",
                "overall_progress": 0.0,
                "stage_current": 0,
                "stage_total": 25,
            },
        )

        self.assertEqual(job.stage, "translating")
        self.assertAlmostEqual(job.progress, VISIBLE_START_PROGRESS)

    def test_babeldoc_real_postprocessing_stage_mapping(self):
        """BabelDOC Save PDF 阶段应映射为 postprocessing。"""
        job = self._job()
        worker = TranslationWorker()

        worker._apply_progress_event(
            job,
            {
                "type": "progress_update",
                "stage": "Save PDF",
                "overall_progress": 92.0,
            },
        )

        self.assertEqual(job.stage, "postprocessing")
        self.assertAlmostEqual(job.progress, 0.92)

    def test_heartbeat_moves_preflight_to_visible_micro_progress(self):
        """长时间无回调时 heartbeat 不应只刷新 updated_at。"""
        job = self._job()
        job.status = JobStatus.RUNNING
        job.stage = "preflight"
        job.progress = 0.0
        job._last_progress_monotonic = time.monotonic() - HEARTBEAT_INTERVAL_SECONDS - 1
        worker = TranslationWorker()

        worker._apply_heartbeat_progress(job)

        self.assertEqual(job.stage, "translating")
        self.assertGreater(job.progress, 0.0)
        self.assertLessEqual(job.progress, HEARTBEAT_PROGRESS_CAP)

    def test_terminal_status_ignores_late_progress_event(self):
        """终态任务不应被迟到的 BabelDOC 进度事件改写。"""
        worker = TranslationWorker()
        for status, stage, progress in (
            (JobStatus.COMPLETED, "completed", 1.0),
            (JobStatus.FAILED, "failed", 0.27),
            (JobStatus.CANCELLED, "cancelled", 0.0),
        ):
            with self.subTest(status=status):
                job = self._job()
                job.status = status
                job.stage = stage
                job.progress = progress
                job.updated_at = "terminal-timestamp"

                worker._apply_progress_event(
                    job,
                    {
                        "type": "progress_update",
                        "stage": "Translate Paragraphs",
                        "overall_progress": 56.0,
                    },
                )

                self.assertEqual(job.status, status)
                self.assertEqual(job.stage, stage)
                self.assertAlmostEqual(job.progress, progress)
                self.assertEqual(job.updated_at, "terminal-timestamp")

    def test_terminal_status_ignores_heartbeat_progress(self):
        """终态任务不应被 heartbeat 微进度改写。"""
        worker = TranslationWorker()
        for status, stage, progress in (
            (JobStatus.COMPLETED, "completed", 1.0),
            (JobStatus.FAILED, "failed", 0.27),
            (JobStatus.CANCELLED, "cancelled", 0.0),
        ):
            with self.subTest(status=status):
                job = self._job()
                job.status = status
                job.stage = stage
                job.progress = progress
                job.updated_at = "terminal-timestamp"
                job._last_progress_monotonic = time.monotonic() - HEARTBEAT_INTERVAL_SECONDS - 1

                worker._apply_heartbeat_progress(job)

                self.assertEqual(job.status, status)
                self.assertEqual(job.stage, stage)
                self.assertAlmostEqual(job.progress, progress)
                self.assertEqual(job.updated_at, "terminal-timestamp")


if __name__ == "__main__":
    unittest.main()
