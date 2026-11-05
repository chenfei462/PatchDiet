# PatchDiet 中文 Investor / Judge Brief

一句话定位：PatchDiet 是 AI 生成 PR 进入人工 review 前的本地优先瘦身层，也是一个 review intake gate。

PatchDiet 不替开发者写代码，不替 reviewer 下结论。它先把疑似 review noise 的改动挑出来，在本地验证后给出更小的 review surface 和可审计收据。

## 为什么现在

- AI coding agent 让写代码更快，但 review 成本没有同步下降。
- 大 PR、AI PR、顺手改动、生成文件和草稿文档，会把维护者的注意力切碎。
- 团队真正缺的不是更多 AI 评论，而是进入人工 review 前的 intake gate。
- PatchDiet 的切入点：先减少 reviewer 必须看的 diff，再保留证据给人判断。

## Proof Board

| 证据类型 | 当前状态 | 可展示数字 | 可信边界 |
| --- | --- | --- | --- |
| Primary verified proof | Local fixture：`agent-large-pr` | `4 files / 128 changed lines -> 2 files / 32 changed lines`；`75% changed-line reduction`；`node --test` passing | 本地 fixture，可复现；不是线上客户案例 |
| 30-second preview sample | Browser sample | `5 files / 33 lines -> 2 files / 14 lines`；`58% review noise removed`；`4m estimated attention saved` | 预览体验，用于 30 秒理解价值；不是 verified cleanup 证明 |
| Verification gates | Browser preview vs CLI verified proof | Browser preview 展示候选和 before/after；CLI verified proof 运行测试后才把移除计入 proof | Browser 是 preview；CLI 才是 verification path |
| Artifacts | Local proof artifacts | `report.github.md`、`report.html`、`removal.patch`、`candidates.json`、`diet-card.svg` | artifacts 来自本地运行；外部发布状态另算 |

### Proof 解释口径

- Primary verified proof：用 `agent-large-pr` 作为评委和投资人的主证据。
- Browser preview：适合开场演示，让观众在 30 秒内看懂 PatchDiet 在删什么。
- CLI verified proof：适合证明边界，展示 PatchDiet 在临时 git worktree 中尝试移除候选，并用用户配置的测试命令验证。
- 结论边界：PatchDiet 只证明 cleanup 后仍通过配置检查，不证明语义等价。

## 90 秒 Pitch Demo 结构

| 时间 | 段落 | 讲法 |
| --- | --- | --- |
| 0-15s | Result first | 直接展示 `agent-large-pr`：`4 files / 128 changed lines -> 2 files / 32 changed lines`，`75%` changed-line reduction，`node --test` passing。 |
| 15-35s | Browser preview | 展示 browser sample：`5 files / 33 lines -> 2 files / 14 lines`，`58%` review noise removed，`4m` estimated attention saved。明确它是 preview。 |
| 35-60s | CLI verified proof | 切到 CLI verified proof：PatchDiet 本地运行、临时 worktree、移除候选、重跑测试，通过后生成 artifacts。 |
| 60-75s | Reviewer artifact | 展示 `report.github.md`、`report.html`、`removal.patch`、`candidates.json`、`diet-card.svg`。 |
| 75-90s | Commercial close | 收束到团队价值：减少 review intake 噪音，不上传源码，适合 AI PR 规模化进入团队前的第一道门。 |

## 投资人视角

### Product wedge

- 起点：AI PR 进入人工 review 前的本地瘦身层。
- 第一用户：维护者、tech lead、开源项目 owner、企业研发平台团队。
- 使用时机：Claude Code、Codex、Cursor、Aider、OpenHands 等 agent 生成 diff 后，review 前。
- 核心价值：用可验证收据减少 review surface，而不是再生成一堆 AI review comments。

### 差异化

- Local-first：默认不上传源码。
- Test-verified cleanup：只把通过配置检查的移除作为 verified proof。
- Reviewer artifact：输出给人看的报告、patch、候选列表和 Diet Card。
- Intake gate，不是 AI reviewer：定位更窄，也更容易进入现有 review 流程。

### 商业模式草案

| 版本 | 面向用户 | 可能能力 | 状态 |
| --- | --- | --- | --- |
| Free | 个人开发者、开源维护者 | 本地 CLI、browser preview、基础 artifacts | Local proof / product surface |
| Team | 小团队、研发效能团队 | 团队策略、PR comment、共享配置、CI 集成 | Roadmap / external pending |
| Business | 企业研发平台 | SSO、审计、保留策略、私有部署、集中指标 | Roadmap / external pending |

### 近期里程碑

- 强化 `agent-large-pr` 作为主 proof，确保评委有清晰的本地复现路径。
- 补齐更多 fixture，覆盖 monorepo、Python、binary diff、弱测试边界。
- 把 browser preview 和 CLI verified proof 的边界写进所有对外材料。
- 发布前验证 npm、Marketplace、hosted App。未外部确认前只说 release checklist / external pending。

## TRAE CN 作品帖素材清单

### Demo 简介

- 标题：PatchDiet：AI PR 进入人工 review 前，先本地瘦身。
- 一句话：AI 写得越快，review 越需要 intake gate。
- 主数字：`agent-large-pr` 从 `4 files / 128 changed lines` 缩到 `2 files / 32 changed lines`，`75%` changed-line reduction，`node --test` passing。
- 预览数字：browser sample 从 `5 files / 33 lines` 到 `2 files / 14 lines`，`58%` review noise removed。

### 创作思路

- 问题：AI 让 PR 更快出现，也更容易夹带无关 diff。
- 方案：把可疑改动拆成候选，在本地验证后生成 cleanup receipt。
- 边界：PatchDiet 不是 AI reviewer，不证明语义等价，不替代人工 review。
- 价值：让 reviewer 先看必要 diff，再看收据。

### 体验地址 / 本地运行方式

| 项目 | 当前写法 |
| --- | --- |
| Hosted App | External pending；未作为线上发布事实宣传 |
| npm | External pending；未验证前不写 `npm exec -- patchdiet` 作为正式体验入口 |
| Marketplace | External pending；未 install-tested 前不写已上线 |
| GitHub 仓库 | `https://github.com/chenfei462/PatchDiet` |
| 本地 demo | `npm ci`；`npm run build`；`npm run demo`；打开 `http://127.0.0.1:4173/demo/` |
| CLI proof | `node dist/packages/cli/src/index.js shrink --test "npm test"` 或项目文档中的本地 proof 命令 |
| 本地 artifacts | `.patchdiet/example-benchmarks/agent-large-pr/report.md`；`.patchdiet/example-benchmarks/agent-large-pr/run.json`；`.patchdiet/diet-card.svg` |

### TRAE 实践过程

- 用 TRAE / AI coding workflow 生成或整理产品材料。
- 用 PatchDiet 的本地 fixture 验证关键数字，不把 preview 写成 verified proof。
- 用 browser sample 做 30 秒理解路径。
- 用 CLI verified proof 展示真正的 verification gate。
- 最终材料只声明 local fixture、local proof、external pending 三类事实。

### 关键截图清单

- Browser preview before/after。
- Candidate list / receipt。
- CLI 运行通过 `node --test` 的输出。
- `report.github.md` 或 GitHub comment 形态。
- `report.html` 页面。
- `removal.patch` 片段。
- `diet-card.svg` 分享卡。
- npm / Marketplace / hosted App 若未外部验证，只放 release checklist 截图，不放上线截图。

### Session ID 提交前必填清单

这些 ID 需要从 TRAE 工作区或作品帖流程中复制，不能用占位符直接提交。

- TRAE 项目构建 Session ID：提交前填入实际 ID。
- Demo 录屏 Session ID：提交前填入实际 ID。
- CLI proof Session ID：提交前填入实际 ID。
- 作品帖提交 Session ID：提交前填入实际 ID。

## 现场 CTA

| CTA | 现场说法 |
| --- | --- |
| GitHub star | 如果你也被 AI PR 噪音困扰，先 star，后续看 fixture 和 release 进展。 |
| 申请 beta | 留下团队规模、代码托管方式、主要测试命令。 |
| 提交一个 public PR URL | 让 PatchDiet 先做 preview，不承诺自动删改。 |
| 预约企业试用 | 适合正在把 AI coding agent 接入研发流程的团队。 |

## 风险边界

- PatchDiet 不是 AI reviewer。
- PatchDiet 不证明语义等价。
- PatchDiet 不替代人工 review。
- PatchDiet 不保证弱测试能覆盖真实业务行为。
- PatchDiet 默认 local-first；源码上传、托管服务、远程缓存都必须单独说明和授权。
- npm、Marketplace、hosted App 都是 release checklist / external pending，除非外部服务已发布并 install-tested。
- 真实客户、收入、融资、线上发布、npm 已发布、Marketplace 已上线都不能凭空写入。
