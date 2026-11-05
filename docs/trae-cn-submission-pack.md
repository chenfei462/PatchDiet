# PatchDiet TRAE CN 提交包

一句话价值主张：PatchDiet 是 AI 生成 PR 进入人工 review 前的本地优先瘦身层, 用可验证 cleanup receipt 帮团队先压小 review surface, 再让人判断剩下的代码。

适用读者：TRAE CN 黑客松评委、创业者、潜在投资人、正在把 AI coding agent 接入团队流程的工程负责人。

核心边界：PatchDiet 不是 AI reviewer, 不是代码质量裁判, 不是语义等价证明, 也不替代人工 review。它做的是 `review intake gate / diff compression / cleanup receipt`。

## TRAE 作品帖草稿

以下内容可复制到 TRAE 作品帖。提交前请把占位符、截图、Session ID 和实际链接检查一遍。

### 项目名称

PatchDiet - AI PR 进入人工 review 前, 先本地瘦身

### Demo 简介

AI coding agent 让 PR 生成更快, 但 reviewer 的注意力没有变多。PatchDiet 站在 review 前, 读取 git diff, 找出疑似 review noise 的候选改动, 在本地临时 worktree 中尝试移除, 并用用户配置的测试命令验证。通过后, 它输出更小的 review surface、cleanup patch、candidate list、report 和 Diet Card。

最重要的一句：`Browser previews likely noise; CLI verifies removals by rerunning tests.`

### 创作思路

我们没有把 PatchDiet 做成另一个 AI reviewer。AI reviewer 往往会增加更多 comments, 但 AI PR 的第一层痛点常常是 diff 太大、混入无关文件、生成物、草稿和顺手改动。PatchDiet 的思路是先做 review intake gate：把可疑噪音拆成候选, 在本地验证能否删除, 再把 cleanup receipt 交给人审。

这让 PatchDiet 的价值更窄也更清楚：不争夺最终判断权, 只减少 reviewer 必须看的 surface, 并留下“删了什么、为什么删、通过了什么检查”的证据。

### 体验地址 / 本地运行方式

- GitHub repo: `https://github.com/chenfei462/PatchDiet`
- 本地 demo: `http://127.0.0.1:4173/demo/`
- 本地准备:

```bash
npm ci
npm run build
npm run demo
```

- CLI proof 路径:

```bash
node dist/packages/cli/src/index.js shrink --test "npm test"
```

- 主 proof artifacts:
  - `.patchdiet/example-benchmarks/agent-large-pr/report.md`
  - `.patchdiet/example-benchmarks/agent-large-pr/run.json`
  - `.patchdiet/diet-card.svg`

说明：npm publishing、Marketplace、hosted App、billing / checkout、真实客户 traction、financing / 融资仍是 external pending。未外部验证前, 不把它们写成已上线事实。

### TRAE 实践过程

1. 用 TRAE / AI coding workflow 整理 PatchDiet 的黑客松材料、投资人表达和截图清单。
2. 用 browser preview 展示 30 秒理解路径：让评委看到 before / after、候选删除项和 review attention savings。
3. 用 CLI verified proof 展示真实边界：PatchDiet 在本地临时 worktree 中尝试移除候选, 并重新运行测试。
4. 用 artifacts 交付 reviewer 能看的证据：report、run json、removal patch、candidate list、Diet Card。
5. 所有对外表述都区分 local fixture proof、browser preview 和 external pending, 不把 preview 说成 verified cleanup。

### 核心证明数字

- Primary verified proof: `agent-large-pr`
- 结果：`4 files / 128 changed lines -> 2 files / 32 changed lines`
- 效果：`75% changed-line reduction`
- 验证：`node --test` passing
- Preview/browser sample: `5 files / 33 lines -> 2 files / 14 lines`
- Preview 效果：`58% review noise removed`, `4m estimated attention saved`

解释口径：`agent-large-pr` 是主 proof；browser sample 是 30 秒理解路径；CLI proof 才是 verification path。PatchDiet 证明的是 cleanup 后仍通过配置检查, 不证明业务语义完全等价。

### 风险边界 / 未上线项

- PatchDiet 不是 AI reviewer, 不替 reviewer 下结论。
- PatchDiet 不是 code-quality judge, 不声称自动判断代码优劣。
- PatchDiet 不证明 semantic equivalence, 只证明用户配置的检查通过。
- Browser preview 只展示 likely noise, 不是 verified removal。
- CLI verified proof 依赖用户测试命令；弱测试无法覆盖的业务风险仍需人工 review。
- npm publishing、GitHub Marketplace、hosted App、billing / checkout、真实客户、收入、ARR、financing / 融资、线上增长都未作为 live claim。
- 如果展示 release checklist, 必须标成 checklist / external pending, 不能当上线截图。

### Call to Action

如果你是正在导入 AI coding agent 的创业者、投资人或工程负责人, 欢迎看 90 秒 demo, 再给我们一个真实 PR workflow 做 beta 验证。PatchDiet 想证明的不是“AI 比 reviewer 更聪明”, 而是“AI PR 进入 review 前可以更小、更干净、更可审计”。

## 提交前流程 Checklist

- [ ] 确认作品帖开头先讲 PatchDiet 定位：`review intake gate / diff compression / cleanup receipt`。
- [ ] 核对主 proof 数字：`4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing。
- [ ] 核对 preview 数字：`5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`。
- [ ] 明确写出：`Browser previews likely noise; CLI verifies removals by rerunning tests.`
- [ ] 确认 npm、Marketplace、hosted App、billing、客户、收入、ARR、financing / 融资没有被写成 live status。
- [ ] 替换所有 TRAE Session ID 占位符；`提交前填入实际 ID` 不能原样提交。
- [ ] 确认截图 captions 与正文数字一致。
- [ ] 确认本地 demo URL、GitHub repo、artifact paths 可访问或可解释。
- [ ] 最后通读风险边界, 确保没有暗示 PatchDiet 替代人工 review 或证明语义等价。

## 截图 Checklist

### 必需截图 1: Demo receipt / browser preview

- 建议 caption: `Browser preview: 5 files / 33 lines -> 2 files / 14 lines, 58% review noise removed`
- 截图应证明：
  - 本地 demo 页面或 receipt 显示 before / after。
  - 画面包含 `58% review noise removed` 或等价指标。
  - 画面包含候选删除项或 receipt 形态。
  - 讲解时必须说明这是 preview, 不是 verified cleanup。

### 必需截图 2: CLI verified proof / artifacts

- 建议 caption: `CLI verified proof: agent-large-pr, 75% changed-line reduction, node --test passing`
- 截图应证明：
  - `agent-large-pr` 的主数字：`4 files / 128 changed lines -> 2 files / 32 changed lines`。
  - `75% changed-line reduction`。
  - `node --test` passing 或 `run.json` / `report.md` 中的通过状态。
  - artifact 路径可见, 优先展示 `.patchdiet/example-benchmarks/agent-large-pr/report.md` 或 `.patchdiet/example-benchmarks/agent-large-pr/run.json`。

### 必需截图 3: Investor proof board / positioning material

- 建议 caption: `Positioning: not an AI reviewer; review intake gate + diff compression + cleanup receipt`
- 截图应证明：
  - PatchDiet 的定位不是 AI reviewer。
  - 画面包含 `review intake gate`, `diff compression`, `cleanup receipt` 三个关键词或中文等价表达。
  - 画面区分 Evidence / Inference / Roadmap, 或明确 local fixture proof 与 external pending。
  - 可使用 `docs/trae-cn-investor-brief.md` 或 `docs/investor-positioning-and-business.md` 的 proof board / positioning slide material。

### 可选截图

- README evidence order: 证明主 proof、browser preview、CLI proof 的演示顺序。
- Diet Card: 展示 `.patchdiet/diet-card.svg` 作为可分享 cleanup receipt。
- Release checklist: 只用于说明 npm / Marketplace / hosted App 是 external pending, 不得当成已上线截图。
- GitHub repo 页面: 展示 `https://github.com/chenfei462/PatchDiet` 和项目名称。

## Session ID Checklist

不要编造 TRAE Session ID。以下占位符必须在提交前替换成 TRAE 工作区或作品流程中的真实 ID；`提交前填入实际 ID` 不可原样提交。

| 项目 | Session ID | 提交前检查 |
| --- | --- | --- |
| TRAE 项目构建 | `提交前填入实际 ID` | 证明项目搭建、材料整理或关键实现过程来自实际 TRAE session |
| Demo 录屏 | `提交前填入实际 ID` | 对应 browser preview / demo receipt 的录制过程 |
| CLI proof | `提交前填入实际 ID` | 对应 `agent-large-pr` 或本地 CLI verified proof |
| 作品帖提交 | `提交前填入实际 ID` | 对应最终 TRAE works post 编辑和提交过程 |

建议在最终帖里写成：

```text
TRAE 项目构建 Session ID: <实际 ID>
Demo 录屏 Session ID: <实际 ID>
CLI proof Session ID: <实际 ID>
作品帖提交 Session ID: <实际 ID>
```

## Local Proof Boundary

- Fixture/local proof: 当前最强证据来自本地 fixture `agent-large-pr`, 可展示 `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing。
- Browser preview vs CLI verification: browser preview 用来帮助评委快速理解 likely noise；CLI verification 才会在本地尝试移除候选并 rerun tests。
- Verification boundary: PatchDiet 验证“配置检查仍通过”, 不验证完整业务语义, 不替代人工判断。
- External pending: npm publishing、Marketplace、hosted App、billing / checkout、真实客户 traction、收入、ARR、financing / 融资都不能写成已经发生。
- Source boundary: 默认 local-first, 不默认上传源码；任何 hosted processing、remote cache、LLM call 都需要单独说明和授权。

## 90 秒中文口播 Pitch

大家好, 我们做的是 PatchDiet。它不是另一个 AI reviewer, 而是 AI 生成 PR 进入人工 review 前的一道本地优先瘦身层。

AI coding agent 让 PR 生成越来越快, 但 reviewer 的注意力没有同步变多。很多 AI PR 不是完全错, 而是夹带了无关文件、生成物、草稿和顺手改动, 让 reviewer 先被噪音消耗。PatchDiet 的做法是读取 diff, 找出疑似 review noise, 在本地临时 worktree 里尝试移除, 然后重新跑用户配置的测试。通过以后, 它输出 cleanup patch、report、candidate list 和 Diet Card, 作为 reviewer 能审计的收据。

我们的主 proof 是 `agent-large-pr`: 从 `4 files / 128 changed lines` 缩到 `2 files / 32 changed lines`, `75% changed-line reduction`, 并且 `node --test` passing。浏览器 demo 用 30 秒展示理解路径: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, 预计节省 `4m` reviewer attention。但边界很明确：`Browser previews likely noise; CLI verifies removals by rerunning tests.`

PatchDiet 不证明语义等价, 不替代人工 review, 也不声称 npm、Marketplace、hosted App、客户收入或融资已经上线。我们现在展示的是本地 fixture proof 和可复现产品路径。对正在导入 AI coding agent 的团队来说, PatchDiet 的机会是成为 review intake gate：让 AI PR 进入 review 前更小、更干净、更可解释。

## References

- TRAE CN investor / judge brief: `docs/trae-cn-investor-brief.md`
- Investor positioning and business brief: `docs/investor-positioning-and-business.md`
- GitHub repo: `https://github.com/chenfei462/PatchDiet`
- Local demo: `http://127.0.0.1:4173/demo/`

