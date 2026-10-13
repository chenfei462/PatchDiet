# PatchDiet 竞品定位与商业化 Slide Brief

> Audience: TRAE CN 黑客松评委、企业家、潜在投资人
> Status: positioning / planning draft. This is not a claim of live billing, live Marketplace distribution, customer traction, revenue, or financing.

## Thesis

PatchDiet 的最佳定位不是 **AI reviewer**。

PatchDiet 应该被讲成 **review intake gate / diff compression / cleanup receipt**：

- **review intake gate**：AI-generated PR 进入人工 review 前，先过一道本地优先的瘦身门。
- **diff compression**：目标不是多写评论，而是减少 reviewer 必须看的 surface。
- **cleanup receipt**：每次移除都输出可审计证据，告诉人“删了什么、为什么删、通过了什么检查”。

核心句：

> AI coding agent 让 PR 生成更快；PatchDiet 让 PR 进入 review 前更小、更干净、更可解释。

## Evidence / Inference / Roadmap 标尺

| 标签 | 可以怎么说 | 不可以怎么说 |
| --- | --- | --- |
| Evidence | 本地 fixture、可复现 demo、已存在 proof artifact | 真实客户、收入、线上增长、融资 |
| Inference | 从 AI PR 增长、review bottleneck、团队治理需求推导的机会 | 伪装成调研结论或市场份额 |
| Roadmap | 计划验证 npm、Marketplace、team metrics、beta teams | 说 npm 已发布、Marketplace 已上线、已有付费团队 |

## 竞品定位图

| 工具类别 | 代表产品 / 类别 | 核心价值 | PatchDiet 如何差异化 | 避免正面竞争的说法 |
| --- | --- | --- | --- | --- |
| AI reviewer | GitHub Copilot Code Review、CodeRabbit、PR-Agent / Qodo、Greptile / CodeAnt | 读 PR，生成 review comments、风险提示、修复建议 | PatchDiet 不抢 reviewer 判断权，先把可删 noise 压掉，再给人或 AI reviewer 看更小 diff | “We do not compete to be the smartest reviewer. We reduce the review surface before reviewer judgment starts.” |
| lint / comment automation | reviewdog、Danger、静态检查 comment bot | 把 lint、policy、CI 结果转成 PR comments | PatchDiet 的核心输出不是评论，而是 verified cleanup patch、receipt、candidate list | “They add structured feedback. PatchDiet removes verified noise before feedback volume grows.” |
| PR workflow / stacked PR | Graphite、stacked PR workflow、branch queue 工具 | 拆分 PR、管理 stack、改善 review routing | PatchDiet 不重建 PR 工作流；它嵌入现有 flow，在 intake 阶段压缩 diff | “Keep your PR workflow. Put PatchDiet before review as a cleanup gate.” |
| merge / CI platform | GitHub Actions、GitLab CI、Buildkite / CircleCI、Mergify、gitStream | 跑检查、合并策略、自动化 gate | PatchDiet 使用用户已有 test / CI command 作为验证边界，并输出 cleanup receipt | “CI decides whether code passes checks. PatchDiet asks what can be removed while checks still pass.” |

定位边界：

- 不说“我们比 AI reviewer 更懂代码”。
- 不说“我们替代 CI / merge queue”。
- 不说“我们自动证明 PR 正确”。
- 说“我们把进入 review 的 diff 先压小，并把 cleanup 证据留给人”。

## 2x2 定位矩阵

横轴：**更多 review comments** -> **更小 review surface**
纵轴：**LLM judgment** -> **user-test verified cleanup**

| 象限 | 代表类别 | 评委可理解的解释 |
| --- | --- | --- |
| 更多 review comments + LLM judgment | AI reviewer | 用模型读 PR，再输出更多 comments 和建议。 |
| 更多 review comments + user-test verified cleanup | lint / CI comment bot | 检查结果可信，但仍主要增加 reviewer 需要处理的 comment stream。 |
| 更小 review surface + LLM judgment | AI-assisted refactor / summarizer | 可能帮人理解 diff，但核心仍依赖模型判断。 |
| **更小 review surface + user-test verified cleanup** | **PatchDiet** | **在本地或用户控制的环境里尝试移除候选，用户测试通过后才给 cleanup receipt。** |

一句话解释：

> PatchDiet 选择右下角：不是让 reviewer 面对更多智能评论，而是让 reviewer 面对更小 diff，并看到测试验证过的 cleanup 收据。

## 投资人 Slide 草案

### Problem

- AI coding agent 正在扩大 PR 产能，但 review bandwidth 没有同步扩大。
- AI PR 常见问题不是“没人评论”，而是“太多无关 diff、生成物、草稿文件、顺手改动混进 review”。
- 企业采用 AI coding 后，需要一个 intake gate 来控制进入人工 review 的噪音。

### Why Now

- Agentic coding 从个人实验走向团队流程，review 成为新的瓶颈。
- 企业不会只问“AI 写了多少代码”，还会问“这些代码如何被治理、审计、接受”。
- LLM reviewer 越多，comment volume 可能越大；团队反而更需要 diff compression。

### Product Wedge

- 从 AI-generated PR 的 review 前处理切入。
- 输入：现有 git diff、用户配置的 test command、团队 cleanup policy。
- 输出：更小 review surface、removal patch、candidate list、cleanup receipt、GitHub-ready summary。
- Wedge message: **review intake gate before human review**。

### Evidence / Proof Board

| 类型 | 当前可讲内容 | 边界 |
| --- | --- | --- |
| Evidence | 本地 fixture proof：用可复现 fixture 展示 changed-line reduction 和 test pass | fixture 不是市场 traction |
| Evidence | Browser preview / demo activation 可展示候选、before / after、receipt 形态 | preview 不是 verified cleanup |
| Evidence | CLI path 可展示在用户环境跑测试后才生成 verified cleanup | 只证明配置检查通过，不证明语义等价 |
| Inference | AI PR 数量增长会推高 review intake 成本 | 需要 beta teams 验证真实 workflow |
| Roadmap | npm downloads、Marketplace installs、waitlist conversion、team metrics | 未有真实数据前只能写 planning / pending |

### Moat / Differentiation

- **Workflow position**：站在 review 前，不站在 reviewer 席位上。
- **Trust boundary**：默认 local-first，不默认上传源码。
- **Proof artifact**：输出 receipt，让 reviewer 和 manager 都能审计。
- **Data advantage roadmap**：长期积累 cleanup acceptance、false positive reports、team policy outcomes，而不是只积累 comments。

### Business Model

- Free：个人开发者和开源维护者，用本地 CLI / demo 看到价值。
- Team：团队策略、共享配置、PR comment、历史指标、私有 repo workflow。
- Business：SSO、审计、保留策略、私有部署、集中治理指标。

This is a planning draft. Billing, checkout, legal terms, hosted retention, npm publishing, and Marketplace listing must be externally verified before being presented as live.

### Next Milestones

- 黑客松前：把 positioning、demo script、proof board、risk boundary 打磨一致。
- 黑客松后：招募 beta teams，收集 cleanup acceptance 和 false positive reports。
- 融资前：证明 PatchDiet 能在真实团队 PR intake 中稳定减少 review surface。

### Ask / CTA

- 对评委：看 90 秒 demo，判断是否解决 AI PR review 噪音。
- 对创业者 / 投资人：介绍正在导入 AI coding agent 的工程团队。
- 对 beta teams：提供一个真实 PR workflow，让 PatchDiet 在不上传源码的前提下做 preview / local proof。
- 对开源维护者：提交 public PR diff 做 review noise preview，不承诺自动删改。

## 商业模式草案

说明：以下是 **planning draft**，不是已上线 billing，不代表已经有付费客户、收入、合同或 checkout。

| Tier | 目标用户 | 可能包含 | 价值锚点 | 当前状态 |
| --- | --- | --- | --- | --- |
| Free | 个人开发者、开源维护者、黑客松评委 | Local CLI、browser preview、基础 report、cleanup receipt | 快速理解“PR before / after” | Product planning / local proof |
| Team | 小团队、tech lead、研发效能团队 | 私有 repo workflow、共享 policy、PR comment、team metrics、历史 receipt | 降低团队 review intake 成本 | Roadmap / beta validation needed |
| Business | 企业研发平台、安全与合规团队 | SSO / SAML、审计日志、保留策略、self-hosted runner、集中指标、采购支持 | AI coding governance 和审计 | Roadmap / enterprise discovery needed |

定价口径建议：

- 按 verified cleanup runs、private repo coverage、团队 seats、managed runner minutes 或 retention 能力定价。
- 不按 AI review comments 定价，因为 PatchDiet 不是 AI reviewer。
- Free 到 Team 的升级触发：从“个人本地证明”变成“团队需要共享 policy、历史指标、PR 集成”。
- Team 到 Business 的升级触发：合规、SSO、审计、源码边界、私有部署。

## 融资前指标面板

| 指标 | 定义 | 当前数据状态 | 用途 |
| --- | --- | --- | --- |
| demo activation | 用户打开 demo 并完成一次 sample / pasted diff preview | 目前没有真实外部数据；可先记录本地 demo 事件 | 衡量 30 秒理解路径 |
| CLI first success | 用户首次在本地 repo 跑通 `patchdiet shrink` 或等价 CLI proof | 目前只有 local fixture / internal proof，不是 cohort 数据 | 衡量 developer activation |
| cleanup acceptance | 用户接受 removal patch 或按 receipt 删除候选 | 目前没有真实团队数据 | 证明输出不仅能看，还能进入 workflow |
| false positive reports | 用户报告 PatchDiet 建议删除了重要改动 | 目前没有真实数据；必须作为安全指标 | 控制信任风险 |
| beta teams | 有真实 repo workflow 的试用团队数 | 目前不应声称已有真实 beta traction，除非另有验证 | 融资前核心 traction 指标 |
| waitlist conversion | waitlist / demo interest 到 beta activation 的转化 | 目前没有真实数据 | 验证需求强度 |
| npm downloads | npm package 发布后的下载数据 | 当前不要声称；发布并验证后再接入 | 衡量分发 |
| Marketplace installs | GitHub Marketplace listing 后的安装数 | 当前不要声称；Marketplace 上线并验证后再接入 | 衡量 GitHub workflow adoption |
| fixture proof runs | 可复现 fixture 的 shrink 结果与测试通过次数 | 有本地 proof 价值，但不是市场 traction | 黑客松和技术可信度证明 |

融资前最重要的三条：

1. **CLI first success**：开发者能在自己的 repo 跑起来。
2. **cleanup acceptance**：团队愿意接受 PatchDiet 的 cleanup。
3. **false positive reports**：风险可控，边界可信。

## 30/60/90 天行动路线

### 0-30 天：黑客松前

- 固定 thesis：PatchDiet = review intake gate / diff compression / cleanup receipt。
- 统一所有材料的证据边界：fixture 是 Evidence，preview 是 demo，npm / Marketplace 是 Roadmap。
- 准备 90 秒 demo：先展示 review surface 变小，再展示 cleanup receipt，再讲 local-first。
- 输出 investor one-pager、judge script、risk boundary slide。

### 31-60 天：黑客松后、融资前

- 招募 3-5 个 beta teams 或开源维护者，用真实 PR workflow 跑 preview / local proof。
- 建立指标埋点草案：demo activation、CLI first success、cleanup acceptance、false positive reports。
- 验证最小 Team plan：共享 config、PR comment、receipt history 是否足够触发付费意愿。
- 整理 case study，但明确区分 public fixture 和真实 beta evidence。

### 61-90 天：融资前验证

- 形成 Proof Board：真实 beta usage、accepted cleanups、false positive rate、repeat usage。
- 决定分发优先级：npm、GitHub Action、Marketplace、self-hosted runner 哪个先进入可验证状态。
- 验证 Business discovery：SSO、audit log、retention、source upload boundary、procurement blockers。
- 准备融资叙事：不是 AI reviewer 红海，而是 AI coding governance 的 review intake layer。

## 风险边界

- 不做 AI reviewer 红海：不承诺替代 reviewer，也不以“更聪明的评论”作为主价值。
- 不默认上传源码：默认 local-first；任何 hosted processing、remote cache、LLM call 都必须显式授权。
- 不承诺语义等价：PatchDiet 只证明用户配置的检查通过，不证明业务语义完全等价。
- 不把 fixture 当 market traction：fixture 是技术 proof，不是客户、收入、增长或留存。
- 不把 preview 当 verified cleanup：browser preview 是理解路径，CLI / user-test path 才是 verification path。
- 不声称 npm / Marketplace 已上线：除非发布、安装、权限和运行路径都已外部验证。
- 不虚构客户、收入、融资、stars、release、download、install、enterprise pipeline。

## Slide Order 建议

1. Title: PatchDiet - review intake gate for AI-generated PRs.
2. Thesis: not AI reviewer; diff compression + cleanup receipt.
3. Problem: AI code expands PR volume; review becomes bottleneck.
4. Competitive map: comments / workflow / CI vs PatchDiet.
5. 2x2: more comments vs smaller surface; LLM judgment vs user-test verified cleanup.
6. Product wedge: local-first shrink before review.
7. Proof Board: Evidence / Inference / Roadmap clearly separated.
8. Business model: Free / Team / Business planning draft.
9. Metrics: activation, acceptance, false positives, beta teams.
10. 30/60/90 roadmap.
11. Risk boundary.
12. Ask / CTA.
