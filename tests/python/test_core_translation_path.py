"""core.translate() 回归测试 — 验证预处理保留 + 适配层委托。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fitz

from antigravity_translate import core
from antigravity_translate import config as ag_config


class CoreTranslateTests(unittest.TestCase):
    """验证 core.translate() 保留旋转烘焙、参考文献跳过，并委托给适配层。"""

    def setUp(self):
        """设置测试用 config 值。"""
        ag_config.CLAUDE_BASE_URL = "https://test.example.com/v1"
        ag_config.CLAUDE_API_KEY = "test-key"
        ag_config.CLAUDE_MODEL = "test-model"

    def _make_pdf(self, path: Path, pages: int, rotate_first: bool = False) -> None:
        """创建测试用 PDF。"""
        doc = fitz.open()
        for index in range(pages):
            page = doc.new_page()
            page.insert_text((72, 72), f"page {index + 1}")
            if rotate_first and index == 0:
                page.set_rotation(90)
        doc.save(str(path))
        doc.close()

    @mock.patch("antigravity_translate.core.translate_pdf_with_babeldoc")
    @mock.patch("antigravity_translate.core.detect_acknowledgement_pages", return_value=[10])
    @mock.patch("antigravity_translate.core.detect_reference_pages", return_value=[8, 9])
    def test_translate_passes_filtered_pages_to_adapter(self, _ref, _ack, adapter):
        """skip_references=True 时应过滤参考文献和致谢页。"""
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "paper.pdf"
            self._make_pdf(pdf_path, pages=10)
            adapter.return_value = {
                "mono_pdf": Path(tmp) / "paper-zh.pdf",
                "dual_pdf": Path(tmp) / "paper-dual.pdf",
                "returncode": 0,
                "stdout": "",
                "stderr": "",
                "cancelled": False,
            }

            result = core.translate(
                input_pdf=pdf_path,
                output_dir=Path(tmp),
                skip_references=True,
            )

        self.assertEqual(adapter.call_args.kwargs["pages"], "1,2,3,4,5,6,7")
        self.assertEqual(result["returncode"], 0)

    @mock.patch("antigravity_translate.core.translate_pdf_with_babeldoc")
    def test_translate_uses_baked_pdf_when_rotations_exist(self, adapter):
        """有旋转页时应使用烘焙后的 PDF。"""
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "paper.pdf"
            self._make_pdf(pdf_path, pages=2, rotate_first=True)
            adapter.return_value = {
                "mono_pdf": Path(tmp) / "paper-zh.pdf",
                "dual_pdf": None,
                "returncode": 0,
                "stdout": "",
                "stderr": "",
                "cancelled": False,
            }

            core.translate(input_pdf=pdf_path, output_dir=Path(tmp))

        baked_input = adapter.call_args.kwargs["input_pdf"]
        self.assertTrue(str(baked_input).endswith("_baked_paper.pdf"))

    @mock.patch("antigravity_translate.core.translate_pdf_with_babeldoc")
    def test_translate_passes_cancel_event_to_adapter(self, adapter):
        """cancel_event 应传递给适配层。"""
        import threading
        cancel = threading.Event()

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "paper.pdf"
            self._make_pdf(pdf_path, pages=2)
            adapter.return_value = {
                "mono_pdf": None,
                "dual_pdf": None,
                "returncode": -1,
                "stdout": "",
                "stderr": "",
                "cancelled": True,
            }

            core.translate(
                input_pdf=pdf_path,
                output_dir=Path(tmp),
                cancel_event=cancel,
            )

        self.assertIs(adapter.call_args.kwargs["cancel_event"], cancel)


if __name__ == "__main__":
    unittest.main()
