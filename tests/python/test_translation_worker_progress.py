"""Worker 真实进度映射测试。"""

from __future__ import annotations

import unittest

from rastro_translation_engine.worker import TranslationJob, TranslationWorker


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


if __name__ == "__main__":
    unittest.main()
