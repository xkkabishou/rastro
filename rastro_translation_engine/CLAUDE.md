[根目录](../CLAUDE.md) > **rastro_translation_engine (翻译服务)**

# rastro_translation_engine - Python 翻译引擎 HTTP 服务

## 模块职责

轻量级 Python HTTP 服务，实现 Rust 端 `TranslationHttpClient` 期望的 REST API 契约。接收 Rust 后端的翻译请求，管理任务队列，驱动 `antigravity_translate` 核心执行实际翻译工作。

## 入口与启动

```bash
python -m rastro_translation_engine --host 127.0.0.1 --port 8890
```

- **入口文件**：`rastro_translation_engine/__main__.py`
- **服务实现**：`rastro_translation_engine/server.py` -- 基于 `http.server.HTTPServer` 的纯标准库 HTTP 服务
- **版本/标识**：`rastro_translation_engine/__init__.py` 定义 `__version__` 和 `SERVICE_NAME = "translation-engine-system"`

## 对外接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/healthz` | 健康检查（返回 service/engineVersion/pythonVersion/uptimeSeconds/queueDepth） |
| POST | `/v1/jobs` | 创建翻译任务（接收 Rust 端 `CreateJobRequest`） |
| GET | `/v1/jobs/{job_id}` | 查询任务状态（返回 `GetJobResponse` 兼容 JSON） |
| DELETE | `/v1/jobs/{job_id}` | 取消任务 |
| POST | `/control/shutdown` | 优雅关闭服务 |

### 健康检查响应签名

Rust 端 `valid_health_signature` 要求：
- `service` 字段必须为 `"translation-engine-system"`
- `engineVersion` 必须非空

## 关键依赖与配置

- **无外部 Python 依赖**：HTTP 服务使用 Python 标准库 `http.server`
- **运行时依赖**：`antigravity_translate`（延迟导入，执行翻译时才加载 PyMuPDF）
- 默认端口：`8890`
- 默认地址：`127.0.0.1`

## 数据模型

### `TranslationJob` (`worker.py`)

内存中的翻译任务表示，包含：
- 任务标识：`job_id`, `request_id`, `document_id`, `cache_key`
- 翻译参数：`pdf_path`, `output_dir`, `source_lang`, `target_lang`, `provider`, `model`, `api_key`, `output_mode`
- 状态：`status`（JobStatus 枚举）、`stage`、`progress`（0.0-1.0）
- 结果：`result`（JobResult）或 `error`（JobError）

### `JobStatus` 枚举

`queued` -> `running` -> `completed` / `failed` / `cancelled`

### 与 Rust 端的映射

| Python 类 | Rust 端对应 |
|-----------|------------|
| `JobResult` | `EngineJobResult` |
| `JobError` | `EngineJobError` |
| `TranslationJob.to_dict()` | `GetJobResponse` |

## 架构要点

### TranslationWorker (`worker.py`)

- 单线程工作模型：一个后台 daemon 线程逐个执行队列中的任务
- 任务队列：内存 list，通过 threading.Lock 保护
- 取消机制：队列中的任务直接移除；运行中的任务通过 `threading.Event` 设置取消标志
- 执行流程：`_execute_job` 延迟导入 `antigravity_translate`，配置 API 参数后调用 `translate()`

### 优雅关闭

- 接收 `POST /control/shutdown` 后延迟 500ms 设置关闭事件
- 注册 `SIGTERM` 信号处理
- `HTTPServer.timeout = 1.0` 确保每秒检查关闭事件

## 测试与质量

- 目前无测试
- 缺口：无单元测试、无集成测试

## 常见问题 (FAQ)

**Q: 为什么使用标准库 http.server 而不是 Flask/FastAPI？**
A: 避免额外依赖，翻译引擎作为子进程运行，需要尽量轻量。

**Q: 翻译进度如何上报？**
A: `antigravity_translate.translate()` 接受 `on_progress` 回调，Worker 在回调中更新 `TranslationJob` 的 `stage` 和 `progress` 字段，Rust 端通过轮询 `GET /v1/jobs/{id}` 获取。

## 相关文件清单

- `rastro_translation_engine/__init__.py` -- 版本和服务名定义
- `rastro_translation_engine/__main__.py` -- CLI 入口
- `rastro_translation_engine/server.py` -- HTTP 服务实现（187 行）
- `rastro_translation_engine/worker.py` -- 翻译任务 Worker（304 行）

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-03-12 | 初始化 | 首次扫描生成 |
