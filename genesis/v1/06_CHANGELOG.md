# 变更日志 - Genesis v1

> 此文件记录本版本迭代过程中的微调变更（由 /change 处理）。新增功能/任务需创建新版本（由 /genesis 处理）。

## 格式说明
- **[CHANGE]** 微调已有任务（由 /change 处理）
- **[FIX]** 修复问题
- **[REMOVE]** 移除内容

---

## 2026-03-11 - Step 5 架构决策补充
- [ADD] 生成 ADR-002 多模型协作开发策略 (Claude/Gemini/Codex 分工 + 5 波次执行计划)

## 2026-03-11 - Step 4 系统架构拆解
- [ADD] 生成 02_ARCHITECTURE_OVERVIEW.md (3 个系统：frontend / rust-backend / translation-engine)

## 2026-03-11 - Step 3 技术选型
- [ADD] 生成 ADR-001 技术栈决策记录 (Tauri 2.0 + React + PDFMathTranslate)
- [ADD] 安装 frontend-design + ui-ux-pro-max Agent Skills

## 2026-03-11 - Step 2 PRD 修订
- [CHANGE] 项目名从 PaperAI 改为 Rastro
- [CHANGE] US-002 从「隐式双语翻译」重构为「PDF 全文翻译（含图表）」
- [CHANGE] 集成 PDFMathTranslate 作为翻译引擎（方案 A）
- [REMOVE] 删除独立的 US-005 图表翻译，合并至 US-002
- [CHANGE] User Story 从 10 个精简为 9 个

## 2026-03-11 - 初始化
- [ADD] 创建 Genesis v1 版本
