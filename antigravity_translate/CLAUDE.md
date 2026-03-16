[根目录](../CLAUDE.md) > **antigravity_translate (翻译核心)**

# antigravity_translate - PDF 翻译核心模块

## 模块职责

考古学 PDF 翻译后端核心库，提供三大功能：
1. **旋转页预处理** (`bake_rotations`) -- 修正旋转属性使 pdf2zh 能正确处理
2. **参考文献/致谢页检测** (`detect_reference_pages`, `detect_acknowledgement_pages`) -- 使用结构化标题检测自动跳过无需翻译的尾页
3. **一键翻译入口** (`translate`) -- 串联预处理 + 跳过 + 调用 pdf2zh 外部工具

## 入口与启动

作为 Python 库被 `rastro_translation_engine` 导入使用，不直接运行。

```python
from antigravity_translate import translate as ag_translate
result = ag_translate(input_pdf=Path("paper.pdf"), output_dir=Path("output/"))
```

也可通过 CLI：`python -m antigravity_translate`（`__main__.py`）

## 对外接口

### `translate()` (`core.py`)

主入口函数，参数：

| 参数 | 类型 | 描述 |
|------|------|------|
| `input_pdf` | Path | 输入 PDF 路径 |
| `output_dir` | Path | 输出目录 |
| `glossary_csv` | Path | 术语表 CSV |
| `pages` | str | 页码范围 "1-3,5" |
| `no_dual` | bool | 不生成双语 PDF |
| `no_mono` | bool | 不生成纯中文 PDF |
| `skip_references` | bool | 自动跳过参考文献页 |
| `custom_prompt` | str | 自定义翻译 prompt |
| `on_progress` | Callable | 进度回调 |

返回：

```python
{
    "mono_pdf": Path | None,    # 纯中文 PDF
    "dual_pdf": Path | None,    # 双语 PDF
    "returncode": int,          # pdf2zh 退出码
    "stdout": str,
    "stderr": str,
}
```

### `bake_rotations(input_pdf, output_pdf)` (`core.py`)

修正旋转页面，返回修改过的页码列表。

### `detect_reference_pages(pdf_path)` (`core.py`)

检测参考文献页（1-based）。策略：从后往前扫描，用 PyMuPDF 文本块/行信息识别结构化标题行（短行、以关键词开头、可含编号前缀如 "7." "VII."），排除正文段落中的偶然提及（如 "see references [1,2]"）。标题在页面前 20% 则该页及后续跳过，否则仅跳后续页。

### `detect_acknowledgement_pages(pdf_path)` (`core.py`)

检测致谢页（1-based）。同样使用结构化标题检测，只跳包含致谢标题的页（不跳后续页）。

### `build_glossary_csv(entries, output_path)` (`core.py`)

将术语表写成 babeldoc 兼容的 CSV 格式。

## 关键依赖与配置

| 依赖 | 版本 | 用途 |
|------|------|------|
| PyMuPDF (fitz) | >= 1.24.0 | PDF 解析与预处理 |
| pdf2zh | 外部可执行文件 | 实际翻译工具（通过 subprocess 调用） |

### 配置 (`config.py`)

模块级变量，可通过赋值或环境变量配置：

| 变量 | 环境变量 | 默认值 | 描述 |
|------|---------|-------|------|
| `PDF2ZH_EXE` | `AG_PDF2ZH_EXE` | Windows 默认路径 | pdf2zh 可执行文件路径 |
| `CLAUDE_BASE_URL` | `AG_CLAUDE_BASE_URL` | 预设代理 URL | LLM API 基础地址 |
| `CLAUDE_API_KEY` | `AG_CLAUDE_API_KEY` | 预设值 | LLM API Key |
| `CLAUDE_MODEL` | `AG_CLAUDE_MODEL` | `Claude Sonnet 4.6` | LLM 模型名称 |
| `DEFAULT_QPS` | -- | 2 | QPS 限制 |
| `DEFAULT_LANG_IN` | -- | `en` | 源语言 |
| `DEFAULT_LANG_OUT` | -- | `zh` | 目标语言 |

## 数据模型

### 翻译 Prompt (`prompts.py`)

内置考古学论文翻译 prompt（v8），特点：
- 口语化风格，面向考古学研一新生
- 意译优先，英文长句拆短句
- 地名和分析方法首次出现时括注英文
- 保留化学符号、样品编号、引用标记

### 翻译流水线

```
输入 PDF
  --> 旋转页检测与预处理 (bake_rotations)
  --> 参考文献/致谢页检测 (detect_reference_pages + detect_acknowledgement_pages)
  --> 计算实际翻译页码范围
  --> 构建 pdf2zh 命令行参数
  --> subprocess.run() 调用 pdf2zh
  --> 收集输出文件 (mono_pdf / dual_pdf)
  --> 清理临时文件
```

### pdf2zh 调用参数

关键参数：`--openaicompatible`、`--watermark-output-mode no_watermark`、`--skip-scanned-detection`、`--primary-font-family serif`、`--split-short-lines`、`--short-line-split-factor 0.8`

## 测试与质量

- 目前无测试
- 缺口：无单元测试（`bake_rotations`、`detect_reference_pages` 可独立测试）

## 常见问题 (FAQ)

**Q: 为什么翻译参数中有 "CLAUDE" 字样但实际支持多个 Provider？**
A: 历史命名问题。`config.py` 中的 `CLAUDE_*` 变量实际用于配置任何 OpenAI-compatible API（通过 `--openaicompatible` 参数），不局限于 Claude。

**Q: pdf2zh 是什么？**
A: 基于 babeldoc 的 PDF 翻译工具，通过 `--openaicompatible` 参数支持任意 OpenAI-compatible LLM API。

## 相关文件清单

- `antigravity_translate/__init__.py` -- 包初始化，导出 `translate`
- `antigravity_translate/__main__.py` -- CLI 入口
- `antigravity_translate/core.py` -- 核心翻译逻辑（542 行）
- `antigravity_translate/config.py` -- 配置变量（35 行）
- `antigravity_translate/prompts.py` -- 考古学翻译 prompt（39 行）
- `requirements.txt` -- Python 依赖

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-03-12 | 初始化 | 首次扫描生成 |
| 2026-03-16 | Bug 修复 | `detect_reference_pages` 从简单关键词匹配改为结构化标题检测，修复全文翻译只翻前几页的问题；`detect_acknowledgement_pages` 同步改进；添加 `[ref-detect]`/`[ack-detect]`/`[preprocess]` 诊断日志 |
