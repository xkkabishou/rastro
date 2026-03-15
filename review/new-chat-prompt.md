# 新对话修复 Prompt

你现在在仓库 `/Users/alias/Desktop/work space/antigravity-paper` 中工作。  
不要重新做全面审查，直接基于下面两个文件执行修复：

- `review/fix-plan.md`
- `review/fix-backlog.csv`

工作要求：

1. 先完整阅读这两个文件，并把它们当作当前修复工作的唯一任务清单。
2. 按 `fix-plan.md` 里的批次顺序执行，不要跳过 `Batch A`。
3. 每次只处理一个 issue，除非文档中明确写了依赖需要一起改。
4. 每完成一个 issue：
   - 修改代码
   - 跑最小相关验证
   - 更新 `review/fix-backlog.csv` 对应行的 `status`
   - 如有必要，在 `review/fix-plan.md` 补一小段进度记录或实现备注
5. 不要做与 issue 无关的大重构，不要重做视觉设计，不要删除功能来“掩盖”问题。
6. 若某条修复在实现时发现文档中的技术路径不可行，先基于本地代码验证，再在 `review/fix-plan.md` 中写明原因和替代方案，然后继续推进，不要停在分析阶段。

执行顺序要求：

- 先从 `AG-005` 开始。
- 完成 `Batch A` 后，重新跑：
  - `cargo test --manifest-path src-tauri/Cargo.toml`
- 完成 `AG-001` 后，跑：
  - `npm run build`
- 完成 `Batch C` 后，跑：
  - `npm run build`
  - `python3 -m compileall antigravity_translate rastro_translation_engine`

输出要求：

- 优先直接实现，不要只给计划。
- 每次汇报先说当前正在修哪个 issue。
- 最终答复必须说明：
  - 已完成的 issue
  - 更新了哪些文件
  - 跑了哪些验证
  - `review/fix-backlog.csv` 里还有哪些 issue 未完成
