"""BabelDOC 适配层单元测试。"""

from __future__ import annotations

import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from antigravity_translate.babeldoc_adapter import translate_pdf_with_babeldoc


class BabeldocAdapterTests(unittest.TestCase):
    """验证适配层契约：取消、进度转发、输出路径标准化。"""

    def test_cancelled_job_short_circuits_before_translation_starts(self):
        """已取消的任务不应启动翻译。"""
        cancel_event = threading.Event()
        cancel_event.set()

        result = translate_pdf_with_babeldoc(
            input_pdf=Path("/tmp/paper.pdf"),
            output_dir=Path("/tmp/out"),
            lang_in="en",
            lang_out="zh",
            base_url="https://example.test/v1",
            api_key="test-key",
            model="test-model",
            pages="1-3",
            no_dual=False,
            no_mono=False,
            qps=10,
            pool_max_workers=8,
            glossary_csv=None,
            prompt_text="translate this PDF",
            cancel_event=cancel_event,
            translator_factory=lambda **_: MagicMock(),
            progress_monitor_factory=lambda **_: MagicMock(),
            run_translation=lambda _: self.fail("translation should not start"),
        )

        self.assertTrue(result["cancelled"])
        self.assertEqual(result["returncode"], -1)
        self.assertIsNone(result["mono_pdf"])
        self.assertIsNone(result["dual_pdf"])

    def test_progress_and_output_paths_match_existing_contract(self):
        """进度事件和输出路径应符合现有契约。"""
        events: list[dict] = []

        def fake_progress_monitor_factory(*, stages, progress_change_callback, cancel_event):
            monitor = MagicMock()
            monitor._test_callback = progress_change_callback
            return monitor

        def fake_run_translation(config):
            cb = config.progress_monitor._test_callback
            cb(
                type="progress_update",
                stage="translate",
                overall_progress=56.0,
                stage_progress=56.0,
                stage_current=28,
                stage_total=50,
            )
            return {
                "mono_pdf_path": "/tmp/out/paper-zh.pdf",
                "dual_pdf_path": "/tmp/out/paper-dual.pdf",
            }

        result = translate_pdf_with_babeldoc(
            input_pdf=Path("/tmp/paper.pdf"),
            output_dir=Path("/tmp/out"),
            lang_in="en",
            lang_out="zh",
            base_url="https://example.test/v1",
            api_key="test-key",
            model="test-model",
            pages=None,
            no_dual=False,
            no_mono=False,
            qps=10,
            pool_max_workers=8,
            glossary_csv=None,
            prompt_text="translate this PDF",
            on_progress=events.append,
            cancel_event=threading.Event(),
            translator_factory=lambda **_: MagicMock(),
            progress_monitor_factory=fake_progress_monitor_factory,
            run_translation=fake_run_translation,
        )

        self.assertEqual(result["mono_pdf"], Path("/tmp/out/paper-zh.pdf"))
        self.assertEqual(result["dual_pdf"], Path("/tmp/out/paper-dual.pdf"))
        self.assertEqual(result["returncode"], 0)
        self.assertFalse(result["cancelled"])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["overall_progress"], 56.0)
        self.assertEqual(events[0]["stage"], "translate")

    def test_none_output_paths_handled_gracefully(self):
        """输出路径为 None 时应正确处理。"""
        def fake_run(config):
            return {"mono_pdf_path": None, "dual_pdf_path": None}

        result = translate_pdf_with_babeldoc(
            input_pdf=Path("/tmp/paper.pdf"),
            output_dir=Path("/tmp/out"),
            lang_in="en",
            lang_out="zh",
            base_url="https://example.test/v1",
            api_key="test-key",
            model="test-model",
            pages=None,
            no_dual=True,
            no_mono=True,
            qps=10,
            pool_max_workers=None,
            glossary_csv=None,
            prompt_text="translate",
            cancel_event=threading.Event(),
            translator_factory=lambda **_: MagicMock(),
            progress_monitor_factory=lambda **_: MagicMock(),
            run_translation=fake_run,
        )

        self.assertIsNone(result["mono_pdf"])
        self.assertIsNone(result["dual_pdf"])
        self.assertEqual(result["returncode"], 0)
        self.assertFalse(result["cancelled"])


if __name__ == "__main__":
    unittest.main()
