---
mode: plan
cwd: /Users/alias/Desktop/work space/antigravity-paper
task: NotebookLM 最终集成方案：基于 notebooklm-py 的本地服务化接入
complexity: complex
planning_method: builtin
created_at: 2026-03-14T00:38:27+08:00
---

# Plan: NotebookLM 最终集成方案

🎯 任务概述

当前仓库里的 NotebookLM 面板并没有真实接入能力，只保留了“在外部浏览器打开 NotebookLM”的诚实降级入口。历史上留下了一些 WebView / DOM 注入脚本草稿，但这条路已经被明确停用，不能再作为最终实现方向。

本方案的目标是在当前 Tauri 桌面应用中，落地一条真实可用、可维护、可回退的 NotebookLM 集成链路。最终形态不是前端浏览器自动化，而是将 NotebookLM 能力做成一个本地后端服务：浏览器只负责首次登录，后续所有业务动作都通过 Python `notebooklm-py` 完成。

## 一、结论与硬约束

**最终推荐架构**：

```text
React UI
  -> Tauri IPC
    -> Rust notebooklm_manager
      -> Python rastro_notebooklm_engine
        -> notebooklm-py
          -> Google NotebookLM
```

**必须遵守的约束**：

1. 不恢复内嵌 WebView + DOM 注入自动化。
2. 不把 Playwright 放到前端层。
3. 浏览器只用于首次 Google 登录获取会话。
4. 业务调用统一走 Python `notebooklm-py`。
5. 前端不得接触 cookie、token、storage state 原文。
6. 保留“在外部浏览器打开 NotebookLM”的兜底入口。
7. 所有状态必须真实，不允许 `setTimeout` 伪成功。

## 二、现状基线

### 现状判断

- 当前 `NotebookLMView` 只是一个静态说明面板，点击按钮时执行 `window.open(NOTEBOOKLM_URL, '_blank')`。
- `src/lib/notebooklm-automation.ts` 里还保留着历史草稿性质的状态类型和注入脚本，但没有真实执行链路。
- `review/fix-plan.md` 已明确要求 NotebookLM 不再伪装为“已可用”。
- 项目中已经存在一条成熟的 `Rust -> Python 本地服务` 架构，即 translation engine；这是 NotebookLM 接入的最佳复用点。

### 相关参考文件

- `src/components/notebooklm/NotebookLMView.tsx`
- `src/lib/notebooklm-automation.ts`
- `review/fix-plan.md`
- `src-tauri/src/translation_manager/engine_supervisor.rs`
- `src-tauri/src/translation_manager/http_client.rs`

## 三、目标能力范围

### MVP 主链路

第一阶段必须先打通这一条最小闭环：

1. 检测 NotebookLM 登录状态
2. 触发首次登录
3. 新建 notebook
4. 上传当前正在阅读的 PDF
5. 生成 `mind map`
6. 下载生成产物到本地
7. 在 UI 中展示真实任务状态与结果

### MVP 之后扩展

- `slide-deck`
- `quiz`
- `flashcards`
- `audio-overview`
- `report`
- notebook 切换与复用
- 历史产物列表与重新下载

### 非目标

- 不在 App 内嵌 NotebookLM 网页
- 不模拟用户点击 NotebookLM 网页元素
- 不在 Rust 中重写 `notebooklm-py` 的 undocumented RPC

## 四、总体模块设计

### 4.1 前端层

新增或改造以下模块：

- `src/components/notebooklm/NotebookLMView.tsx`
- `src/stores/useNotebookLMStore.ts`
- `src/lib/notebooklm-client.ts`
- 如有必要：`src/shared/types.ts` 增补 NotebookLM 契约类型

前端职责：

- 展示认证状态、notebook 状态、当前 PDF 状态
- 触发 IPC 调用
- 轮询或订阅任务状态
- 展示产物列表与错误提示
- 提供兜底的“外部打开 NotebookLM”

前端不负责：

- 登录实现
- cookie 管理
- Google token 管理
- DOM 自动化

### 4.2 Rust 层

新增模块：

- `src-tauri/src/notebooklm_manager/mod.rs`
- `src-tauri/src/notebooklm_manager/engine_supervisor.rs`
- `src-tauri/src/notebooklm_manager/http_client.rs`
- `src-tauri/src/ipc/notebooklm.rs`

Rust 职责：

- 预检 Python 解释器与依赖
- 启动 / 停止 Python notebooklm engine
- 管理本地日志与运行目录
- 将前端 IPC 转换为对 Python engine 的本地 HTTP 调用
- 统一错误模型与重试语义
- 控制敏感文件路径和存储目录

Rust 复用模式：

- 尽量对齐 translation engine 的 supervisor、healthz、HTTP client、错误封装方式
- NotebookLM manager 的结构和调用体验尽量与 translation manager 保持一致

### 4.3 Python 层

新增包：

- `rastro_notebooklm_engine/__init__.py`
- `rastro_notebooklm_engine/__main__.py`
- `rastro_notebooklm_engine/server.py`
- `rastro_notebooklm_engine/service.py`
- `rastro_notebooklm_engine/models.py`
- `rastro_notebooklm_engine/storage.py`

Python 职责：

- 封装 `notebooklm-py`
- 处理登录状态检查
- 调用 `notebooklm-py` 创建 notebook、上传 PDF、生成产物、下载产物
- 维护本地任务表
- 以稳定的本地 HTTP API 向 Rust 暴露能力

Python 原则：

- 不把 `notebooklm-py` 的原始返回结构直接暴露给 Rust
- 所有外部库异常都转换为本地服务自己的错误码和消息
- 所有写路径由 Rust 传入，不在 Python 层随意扩散

## 五、认证与会话方案

### 5.1 登录原则

- 首次登录允许使用浏览器，这是正确边界
- 业务调用不再依赖浏览器或页面 DOM
- 登录状态落地到 app data 目录，而不是仓库目录

### 5.2 登录流程

1. 前端点击“连接 NotebookLM”
2. 前端调用 `notebooklm_begin_login`
3. Rust 确保 Python engine 已启动
4. Python 调 `notebooklm-py` 的登录流程
5. 外部浏览器打开 Google 登录页
6. 用户完成登录
7. Python 保存 storage state
8. Python 刷新 auth token 并返回 `authenticated=true`
9. 前端进入已登录状态

### 5.3 存储位置

建议统一使用 Tauri app data 目录，例如：

```text
<app-data>/
  notebooklm/
    auth/
      storage_state.json
    downloads/
    cache/
    notebooklm-engine.log
```

### 5.4 安全边界

- 前端只拿到认证状态，不拿到 cookie/token
- Rust 只传递文件路径和状态，不打印敏感 cookie
- Python 日志中禁止输出会话信息
- `logout` 需要删除或失效化本地认证文件

## 六、统一 API 设计

### 6.1 前端 IPC 设计

建议暴露以下 IPC：

1. `notebooklm_get_status`
2. `notebooklm_begin_login`
3. `notebooklm_logout`
4. `notebooklm_list_notebooks`
5. `notebooklm_create_notebook`
6. `notebooklm_attach_current_pdf`
7. `notebooklm_generate_artifact`
8. `notebooklm_get_task`
9. `notebooklm_list_artifacts`
10. `notebooklm_download_artifact`
11. `notebooklm_open_external`

### 6.2 Python 本地 HTTP API

建议暴露以下端点：

1. `GET /healthz`
2. `GET /auth/status`
3. `POST /auth/login`
4. `POST /auth/logout`
5. `GET /notebooks`
6. `POST /notebooks`
7. `POST /notebooks/{id}/sources/pdf`
8. `POST /notebooks/{id}/artifacts`
9. `GET /tasks/{id}`
10. `GET /notebooks/{id}/artifacts`
11. `POST /artifacts/{id}/download`

### 6.3 统一类型

#### AuthStatus

```ts
type AuthStatus = {
  authenticated: boolean;
  authExpired: boolean;
  lastAuthAt: string | null;
  lastError: string | null;
};
```

#### NotebookSummary

```ts
type NotebookSummary = {
  id: string;
  title: string;
  sourceCount: number;
  updatedAt: string | null;
};
```

#### NotebookLMTask

```ts
type NotebookLMTask = {
  id: string;
  kind: 'upload' | 'generate' | 'download';
  artifactType: 'mind-map' | 'slide-deck' | 'quiz' | 'flashcards' | 'audio-overview' | 'report' | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progressMessage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  notebookId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

#### ArtifactSummary

```ts
type ArtifactSummary = {
  id: string;
  notebookId: string;
  type: 'mind-map' | 'slide-deck' | 'quiz' | 'flashcards' | 'audio-overview' | 'report';
  title: string;
  downloadStatus: 'not-downloaded' | 'downloaded' | 'failed';
  localPath: string | null;
  createdAt: string | null;
};
```

## 七、UI 方案

`NotebookLMView` 最终应改造成“作业控制台”，不是网页容器。

### 7.1 顶部区域

- NotebookLM 标题
- 认证状态 badge
- “重新登录”
- “外部打开 NotebookLM”

### 7.2 当前文档区域

- 当前 PDF 标题
- 当前 PDF 路径
- “附加到 NotebookLM”按钮
- 上传状态提示

### 7.3 Notebook 区域

- 当前 notebook 名称
- 下拉切换已有 notebook
- “新建 notebook”按钮

### 7.4 生成器区域

优先提供 6 个按钮：

- Mind Map
- Slide Deck
- Quiz
- Flashcards
- Audio Overview
- Report

MVP 只要求 `Mind Map` 先可用，但 UI 可以先预留其余按钮并做明确状态控制。

### 7.5 任务与产物区域

- 最近任务列表
- 当前运行中任务
- 已生成产物列表
- “下载”
- “打开文件”
- “打开所在目录”

## 八、分阶段实施计划

### Phase 1: Python Engine 骨架

目标：建立可启动、可健康检查的 NotebookLM 本地服务。

实施内容：

1. 新建 `rastro_notebooklm_engine/`
2. 提供 `python -m rastro_notebooklm_engine`
3. 实现 `/healthz`
4. 实现配置与日志目录
5. 在本地服务中封装 `notebooklm-py` 初始化

完成信号：

- `python3 -m compileall rastro_notebooklm_engine` 通过
- 本地服务可以启动并返回健康状态

### Phase 2: 认证闭环

目标：打通“登录状态检测 + 首次登录 + 退出登录”。

实施内容：

1. 实现 `/auth/status`
2. 实现 `/auth/login`
3. 实现 `/auth/logout`
4. 将 storage state 落到 app data
5. 处理登录过期与重新登录

完成信号：

- 前端能看到真实登录状态
- 用户首次登录成功后状态可持久化

### Phase 3: Rust Manager 接入

目标：让 Tauri 真正接管 Python engine 生命周期。

实施内容：

1. 新增 `src-tauri/src/notebooklm_manager/`
2. 实现 supervisor
3. 实现 HTTP client
4. 实现 IPC 命令
5. 在 app state 中注册 manager

完成信号：

- 前端调用 IPC 能拿到 auth 状态
- Python engine 挂掉后 Rust 能识别并报错

### Phase 4: Notebook 与 PDF 上传闭环

目标：打通 notebook 创建/选择与当前 PDF 上传。

实施内容：

1. 实现 `GET /notebooks`
2. 实现 `POST /notebooks`
3. 实现 `POST /notebooks/{id}/sources/pdf`
4. 从当前文档 store 拿到 `filePath`
5. 前端可执行“附加当前 PDF”

完成信号：

- 当前打开的 PDF 能成功上传到目标 notebook

### Phase 5: Artifact 生成闭环

目标：优先打通 `mind map` 生成与下载。

实施内容：

1. 实现 `POST /notebooks/{id}/artifacts`
2. 实现任务轮询 `GET /tasks/{id}`
3. 实现 `POST /artifacts/{id}/download`
4. 先支持 `mind-map`
5. 补 UI 中的任务与结果展示

完成信号：

- 用户可从 App 内完成：
  - 登录
  - 选择 / 新建 notebook
  - 上传当前 PDF
  - 生成 `mind map`
  - 下载产物

### Phase 6: 扩展更多产物

目标：将生成能力扩展到常见 NotebookLM 产物。

实施内容：

1. `slide-deck`
2. `quiz`
3. `flashcards`
4. `audio-overview`
5. `report`

完成信号：

- 所有新增按钮都有真实能力或明确禁用说明

### Phase 7: 回退、日志与稳定性

目标：让功能在不稳定上游前提下可维护、可诊断。

实施内容：

1. 加强错误码映射
2. 加强 auth 失效提示
3. 保留“外部打开 NotebookLM”兜底
4. 完善日志输出
5. 锁定 `notebooklm-py` 版本

完成信号：

- 当上游接口异常时，用户收到明确可操作提示

## 九、依赖与版本策略

### 推荐依赖策略

- Python 解释器：沿用项目既有要求，优先 Python 3.12+
- 新增 Python 依赖：
  - `notebooklm-py==<锁定版本>`
  - 如登录流程需要：对应的 browser extra
- 版本锁定原则：
  - 不直接依赖 `main` 分支
  - 先固定一个验证通过的发布版本

### 建议的依赖落点

可选做法：

1. 扩展现有 `requirements.txt`
2. 新增 `requirements-notebooklm.txt`

推荐做法：

- 保持 `requirements.txt` 为统一安装入口
- 但在文件中明确区分 translation engine 依赖与 notebooklm engine 依赖

## 十、错误模型与回退策略

### 统一错误码

- `NOTEBOOKLM_AUTH_REQUIRED`
- `NOTEBOOKLM_AUTH_EXPIRED`
- `NOTEBOOKLM_ENGINE_UNAVAILABLE`
- `NOTEBOOKLM_UPLOAD_FAILED`
- `NOTEBOOKLM_GENERATION_FAILED`
- `NOTEBOOKLM_DOWNLOAD_FAILED`
- `NOTEBOOKLM_RATE_LIMITED`
- `NOTEBOOKLM_UNKNOWN`

### 回退策略

1. Auth 失效：提示重新登录
2. Python engine 启动失败：提示检查 Python 和依赖安装
3. `notebooklm-py` 调用失败：展示明确错误并允许外部打开
4. 生成失败：保留 notebook 与上传状态，不强制用户从头开始

## 十一、验证与验收

### 必跑验证

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml`
3. `python3 -m compileall rastro_notebooklm_engine`

### 手动验收

1. 打开任意 PDF
2. 进入 NotebookLM 面板
3. 完成首次登录
4. 新建 notebook
5. 上传当前 PDF
6. 生成 `mind map`
7. 下载产物
8. 重新打开应用后状态仍可恢复
9. 登录过期后可正确提示并重新登录

## 十二、Definition of Done

以下条件全部满足才算完成：

1. NotebookLM 面板不再是静态说明页
2. 不存在 WebView DOM 注入自动化主链路
3. 主链路 `登录 -> 新建 notebook -> 上传 PDF -> 生成 mind map -> 下载` 可用
4. 所有 UI 状态均为真实状态
5. 敏感认证信息不暴露给前端
6. 失败时有可理解错误信息与兜底入口
7. 构建和基础测试通过

## 十三、执行提示

新对话执行时，应按以下顺序推进，而不是先大面积改 UI：

1. 先搭 Python engine 骨架
2. 再接 Rust supervisor 与 HTTP client
3. 再接最小 IPC
4. 再改前端状态面板
5. 最后扩展更多产物类型

禁止事项：

- 不要先恢复历史注入脚本
- 不要把 Playwright 塞到前端
- 不要直接在 Rust 里重写 NotebookLM undocumented RPC
- 不要为了演示效果引入伪成功状态

## 十四、参考

- `src/components/notebooklm/NotebookLMView.tsx`
- `src/lib/notebooklm-automation.ts`
- `review/fix-plan.md`
- `src-tauri/src/translation_manager/engine_supervisor.rs`
- `https://github.com/teng-lin/notebooklm-py`
