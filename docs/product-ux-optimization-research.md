# PatchDiet 内容与使用体验优化研究

> 调研日期：2026-06-24  
> 目标：结合 PatchDiet 当前项目形态，调研同类知名项目，整理出能提升内容质量、用户信任、上手体验和大众接受度的优化方向。  
> 范围：产品定位、README/文档、Web Demo、CLI、GitHub Action/App、VS Code、报告体验、安全信任、增长传播与路线图。

## 一句话结论

PatchDiet 不应该把自己做成“又一个 AI 代码审查机器人”。GitHub Copilot Code Review、CodeRabbit、Qodo/PR-Agent、Graphite 等已经把“AI 帮你 review PR”这个赛道打得很热。PatchDiet 更有机会成为 **AI 写完代码之后、人工 review 之前的 PR 瘦身层**：用本地 git worktree 和用户自己的测试命令，找出可以移除的噪音改动，生成可审计、可复现、可回滚的 cleanup patch。

这条定位更窄，但更清晰：  

- AI reviewer 的核心价值是“发现问题、提出建议”。
- Linter/CI 的核心价值是“检查规则、证明测试通过”。
- Merge queue/stacked PR 工具的核心价值是“让 PR 流程更快更稳”。
- PatchDiet 的核心价值应该是“在 review 前把已经存在的 PR 变小”。

## 当前项目诊断

基于仓库当前 `README.md`、`package.json`、`demo/` 和 `docs/productization-status.md`，PatchDiet 已经具备不错的产品雏形：

- 定位已经转向 “Verified cleanup for AI-generated PRs”：`agent-large-pr` 证明 4 files / 128 changed lines -> 2 files / 32 changed lines，75% changed-line reduction；Browser previews likely noise; CLI verifies removals by rerunning tests。
- CLI 已有 `doctor`、`check`、`shrink`、`report`、`card` 等命令。
- 核心安全叙事明确：默认不上传源码、不依赖 LLM、本地 worktree、测试通过才移除。
- GitHub Action、GitHub App skeleton、VS Code extension scaffold、Web Demo、Diet Card、Pro readiness 文档都已经存在。
- Demo 支持 sample diff、粘贴 unified diff、PR URL、本地 before/after 指标和候选删除项。

主要问题不在“有没有功能”，而在“陌生用户是否会立即相信、理解并愿意试用”：

| 模块 | 当前状态 | 关键缺口 |
| --- | --- | --- |
| 首屏定位 | slogan 清楚，但仍偏开发者内部表达 | 需要更强的 30 秒价值证明和真实案例入口 |
| Web Demo | 能跑 sample 和 diff 分析 | 需要明确 preview-only、不误导为 test-verified，增加下一步行动 |
| CLI | 命令完整 | 需要更强的 `doctor` 引导、错误恢复和“复制即可运行”路径 |
| GitHub Action | 示例完整 | 需要把权限、fork PR、artifact、失败降级讲得更像产品而不是脚本 |
| GitHub App | skeleton 较完整 | 需要生产部署、最小权限、队列、幂等、真实安装体验 |
| VS Code | 有本地预览方向 | 需要让 AI agent 用户在提交前自然使用，而不是另一个可选工具 |
| 报告 | Markdown/HTML/GitHub comment/Diet Card 已有 | 需要把“为什么能删、为什么不能删、如何复现、如何应用”讲到 reviewer 能信 |
| 信任 | 有 safety/docs 基础 | 需要把数据边界、权限矩阵、威胁模型、LLM opt-in 说得非常直白 |

## 外部知名项目对标

| 项目 | 类别 | 它做得好的地方 | PatchDiet 可借鉴 | PatchDiet 应该避开的误区 |
| --- | --- | --- | --- | --- |
| [GitHub Copilot Code Review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review?tool=webui) | 官方 AI PR review | 直接嵌入 GitHub PR reviewer 流程，可给评论和 suggested changes；官方文档说明 review 通常很快，且不会作为 required approval 阻塞合并 | PatchDiet 的 GitHub App 评论也要像“普通 reviewer 评论”一样自然，短、可折叠、可反馈、可重新运行 | 不要宣称能替代人工 approval，也不要把自己包装成泛 AI reviewer |
| [CodeRabbit](https://www.coderabbit.ai/) | 商业 AI code review | 首屏价值非常直接：减少 review 时间和 bug；强调 2-click install、PR/IDE/CLI 多入口、上下文、可配置、安全与信任中心 | 学习它的清晰首屏、客户证明、样例 review、Trust Center、IDE/CLI/PR 全链路入口 | 不要照搬“发现 bug”叙事；PatchDiet 应突出 cleanup patch 和 no source upload default |
| [Qodo/PR-Agent](https://github.com/The-PR-Agent/pr-agent) | 开源 AI PR reviewer | GitHub 上已有广泛认知；README 突出 `/describe`、`/review`、`/improve` 等 PR 内命令；页面显示 2026-06-24 检索时约 11.8k stars | 借鉴 PR 内命令式交互，例如 `/patchdiet rerun`、`/patchdiet explain`、`/patchdiet apply-guide` | PR-Agent 已覆盖 AI review/describe/improve，PatchDiet 不应和它争同一心智 |
| [reviewdog](https://github.com/reviewdog/reviewdog) | Linter 到 PR 评论的桥 | 支持把任意 linter 输出映射到 code hosting review comments，并能按 diff 过滤；GitHub 页面检索时约 9.4k stars | PatchDiet 的报告数据格式也应稳定，方便 Action/App/IDE/Dashboard 复用；只在相关 diff 上发声 | 不要让评论刷屏；PR comment 必须短，长报告放 artifact 或 HTML |
| [Danger JS](https://danger.systems/js/) | PR 规范自动化 | 把团队规范写进 CI，自动提醒 changelog、测试、PR 过大等；强调“让人类处理更难的问题” | PatchDiet 可以把“PR 过大、范围漂移、AI 噪音”变成可解释规则和团队配置 | 不要只警告“PR 太大”，要进一步给出可验证的缩减路径 |
| [Super-Linter](https://github.com/super-linter/super-linter) | 多语言 lint 套件 | 开箱即用、多语言覆盖、GitHub Action 安装简单、并行运行、可配置、支持 status check 和 PR summary | PatchDiet 要学习“复制 YAML 就能跑”和“并行/缓存/超时预算”的产品化表达 | 不要让用户先理解复杂算法；先给可运行路径，再给高级配置 |
| [Graphite](https://graphite.com/) | PR 工作流/stacked PR/AI review | 把 stacked PR、PR inbox、merge queue、AI review、CLI、VS Code 组成端到端 review 工作流；强调更小 PR 和更快 review cycle | PatchDiet 应和“把大 PR 变小”心智绑定，可把 Graphite/stacked PR 作为后续互补方向 | 不要做完整 PR 平台；先成为能插入现有流程的瘦身层 |
| [gitStream](https://docs.gitstream.cm/) | PR 自动化规则 | 用 YAML 自动化 code review 流程：打标签、估算 review 时间、分配 reviewer、自动合并安全 PR、AI PR description/review | 学习它的配置式工作流、review-time labels 和“先减少 reviewer 心智负担”的叙事 | 不要默认自动合并或自动改分支；PatchDiet 的自动写入必须 opt-in |
| [Mergify](https://mergify.com/) | Merge queue/CI 稳定性 | 清楚描述 AI 让 PR 更快产生、CI 和合并路径成为瓶颈；提供 merge queue、CI insights、flaky test 处理、真实客户案例 | PatchDiet 的 Pro 方向可以围绕团队级趋势、噪音路径、flaky/timeout 统计和 CI 成本 | 不要在 v1 做太重的平台；先把单 PR 的 cleanup 体验做扎实 |

## 需求信号与市场空位

### 证据

- GitHub 官方已经把 Copilot Code Review 放入 PR review 流程，说明 AI 辅助 review 是平台级方向。
- CodeRabbit、Qodo/PR-Agent、Graphite 都在争夺 “AI code review” 心智，说明市场需求真实，但赛道拥挤。
- reviewdog、Danger、Super-Linter 证明开发者接受“机器在 PR 里做机械审查、减少人类重复劳动”。
- Graphite、gitStream、Mergify 证明团队愿意为 PR 变小、review 更快、CI 更稳、merge 更安全付费。
- 2025 年一篇关于 Copilot Code Review 的研究指出，AI code review 在安全漏洞检测上仍有明显不足，提醒 PatchDiet 不应过度承诺“自动发现所有 bug”。
- 2026 年 RepoReviewer 论文把 local-first repository review 作为重要架构方向，说明“本地优先、可控上下文、可复现报告”有持续吸引力。

### 推断

AI coding agent 让代码产出速度变快，随之出现的新痛点不是“没有 reviewer”，而是：

- PR 里夹杂 docs、generated files、scratch code、格式化噪音、临时实验。
- 测试通过不代表 diff 足够小、范围足够清楚。
- 人类 reviewer 面对大 diff 更容易 skim，而不是深入理解。
- 安全敏感团队不愿默认把源码上传给外部 AI reviewer。

这正是 PatchDiet 的空位：**不负责判断所有代码好坏，只负责把可被用户测试命令证明“不需要”的改动移出 review 面积。**

## 产品定位建议

### 推荐定位

PatchDiet is the local-first cleanup layer for AI-generated pull requests.

中文可以写成：

> PatchDiet 是 AI 生成 PR 的本地优先瘦身层：在人工 review 前，用你的测试命令找出可移除的噪音改动，并生成可审计 cleanup patch。

### 首页和 README 首屏建议

首屏要在 15 秒内讲清楚 4 件事：

1. 这个工具解决什么痛点：AI PR 太大，review 太累。
2. 它怎么解决：尝试移除候选 diff，再运行用户指定检查。
3. 为什么可信：不上传源码、不需要 LLM、只保留测试仍通过的移除项。
4. 用户现在能做什么：跑 demo、复制 Action、运行 CLI、安装 App。

推荐首屏结构：

```md
# PatchDiet

Verified cleanup for AI-generated PRs.

Verified example: agent-large-pr went from 4 files / 128 changed lines to 2 files / 32 changed lines, a 75% changed-line reduction, with node --test still passing.

[Try the 30-second demo] [Install GitHub App] [Run CLI]

No source upload by default. No LLM required. Cleanup patches are verified by your own checks.
```

README 中应增加一个“PatchDiet is / is not”区块：

| PatchDiet 是 | PatchDiet 不是 |
| --- | --- |
| AI PR cleanup layer | 泛用 AI reviewer |
| test-verified removal suggester | 语义等价证明器 |
| local-first diff reducer | 默认云端源码分析平台 |
| PR review noise reducer | 自动合并机器人 |
| 可审计 artifact 生成器 | 黑盒自动改代码工具 |

## 目标用户

| 用户 | 主要痛点 | 需要看到的价值 |
| --- | --- | --- |
| 开源维护者 | AI 贡献 PR 变多，但 review 时间有限 | 在不运行复杂平台的情况下，快速看出哪些 diff 可能是噪音 |
| 使用 Cursor/Codex/Claude Code/Aider/OpenHands 的个人开发者 | agent 写完后 PR 范围发散 | 提交前本地清理，减少自己和 reviewer 的负担 |
| 小团队技术负责人 | 团队大量使用 AI，PR 大小和质量不稳定 | GitHub Action/App 自动给出 cleanup report，作为 review 前置步骤 |
| 平台/基础设施团队 | monorepo PR 大、CI 慢、review 排队 | 路径策略、测试缓存、超时预算、团队级噪音趋势 |
| 安全敏感团队 | 不愿把源码默认交给外部 AI reviewer | local-first、no LLM required、权限最小化、self-host 文档 |

## P0 优化：先让陌生用户愿意试

P0 的目标不是功能最多，而是让用户第一次接触时顺滑可信。

### 1. 30 秒公开 Demo

现有 demo 已经能加载 sample diff 和输入 PR URL，建议补齐：

- 明确标记：`Preview only. Test verification happens in CLI/Action/App.`
- Sample library：TypeScript、Python、docs noise、generated file、monorepo 4 类示例。
- Before/after 双栏 diff：左侧原始噪音，右侧建议保留。
- 候选项解释：路径、类别、风险、为什么可能删除。
- 下一步 CTA：复制 CLI 命令、复制 GitHub Action YAML、下载 sample report。
- 隐私提示：粘贴 diff 是否只在浏览器本地处理；PR URL fetch 会请求 GitHub public diff。

### 2. README 任务路径重排

README 应从“功能总览”转为“用户成功路径”：

1. 30 秒：不用安装，看 demo。
2. 3 分钟：复制 GitHub Action，在 PR 里得到 comment/artifact。
3. 5 分钟：本地 CLI 运行 `doctor` 和 `shrink`。
4. 1 分钟：安装 GitHub App，未来自动评论。

每条路径都要写明成功标志，例如：

- Demo：看到 before/after 和 deletion candidates。
- Action：PR comment 或 step summary 出现。
- CLI：生成 `.patchdiet/report.html`、`.patchdiet/removal.patch`、`.patchdiet/candidates.json`。
- App：PR 里出现 preview comment 或 check run。

### 3. 报告体验

报告是 PatchDiet 的信任核心。建议分三层：

| 层级 | 用途 | 信息密度 |
| --- | --- | --- |
| GitHub comment | reviewer 快速判断是否值得看 | 10-30 行，摘要 + 关键候选 + artifact 链接 |
| HTML report | 深入审查 | before/after、候选详情、风险、命令、失败原因、复现步骤 |
| JSON artifact | 工具集成 | 稳定 schema，供 App/IDE/Pro dashboard 使用 |

每个候选项必须回答：

- 准备删除什么？
- 为什么认为它是噪音？
- 属于什么风险等级？
- 跑了什么命令？
- 通过/失败/跳过原因是什么？
- 如何复现？
- 如何应用或回滚？

### 4. 风险标签

建议统一使用四类风险：

| 风险 | 默认动作 | 示例 |
| --- | --- | --- |
| Low | 可建议移除 | docs-only、generated-like、format-only，且验证通过 |
| Medium | 建议人工确认 | unused helper、debug branch、实验代码 |
| High | 默认保留 | tests、lockfile、public API、migration、schema、security config |
| Blocked | needs human review | binary、submodule、reverse apply failed、timeout、permission issue |

### 5. 错误恢复

大众愿意使用开发者工具，常常取决于失败时是否知道下一步。`doctor` 和报告需要覆盖：

- 找不到 base/head：给出 `--base`、`--head` 示例。
- 没有测试命令：提示自动探测结果和手动 `--test`。
- baseline 失败：说明不是 PatchDiet 删除导致，先修复主检查。
- fork PR 权限不足：降级到 step summary/artifact。
- timeout：返回 partial result，不让用户觉得卡死。
- dirty worktree：说明是否安全、是否需要 stash/commit。

## P1 优化：让产品真的可持续使用

### 1. GitHub App 生产化

GitHub Marketplace 要求 listing 有明确价值、联系信息、隐私政策、支持链接、可用产品、logo、截图、定价等。GitHub App 最佳实践也强调最小权限、最少 webhook、webhook secret、日志监控、数据删除、凭证安全。

建议 GitHub App 分两种模式：

| 模式 | 说明 | 默认权限 |
| --- | --- | --- |
| Preview | 只分析 PR diff，快速评论潜在 cleanup | contents read、pull_requests read/write、checks write 可选 |
| Verified | 在 runner 中 checkout 并执行测试验证 | 必须显式启用，runner 和 artifact 策略独立说明 |

默认不要请求 branch write。创建 cleanup branch、自动 commit、自动修改 PR 都必须 opt-in。

### 2. VS Code 体验

VS Code 入口应服务“提交前瘦身”：

- Sidebar：显示当前 branch diff 的候选噪音。
- Candidate detail：展示 path、risk、reason、preview patch。
- Commands：`PatchDiet: Analyze Current Diff`、`PatchDiet: Copy Shrink Command`、`PatchDiet: Open Report`。
- Apply flow：默认 dry-run，真正 apply 前展示确认和回滚命令。
- Agent hooks：Claude Code、Codex、Cursor、Aider、OpenHands 运行后自动提示“run PatchDiet?”。

### 3. 可复现实例与 benchmark

不要使用虚假营销数字。建议每个 case study 都包含：

- repo 或 fixture 链接。
- base/head SHA。
- 原始 diff。
- 测试命令。
- PatchDiet 命令。
- report、run.json、removal.patch。
- removed/kept/needs-human-review 明细。
- 限制说明。

至少准备 3 个公开案例：

- TypeScript AI agent PR：docs/generated/unused helper。
- Python refactor PR：保留行为代码，移除 scratch notes。
- Monorepo PR：展示路径策略、缓存和超时预算。

### 4. 性能和规模

PatchDiet 的天然风险是“每个候选都跑测试会慢”。建议：

- Preview 与 Verified 分层：先 1 秒内给启发式 preview，再异步验证。
- `max_candidates`、`max_runtime_minutes`、`timeout_ms` 默认清晰。
- test-result cache：按 head、candidate patch、command、env hash 缓存。
- docs/generated batch verification：批量失败后再二分。
- path-based test selection：monorepo 中只跑相关 package。
- partial report：超时也返回已验证结果。

## P2 优化：形成团队和商业价值

Hosted Pro 不应锁住核心 cleanup 能力，应该提供团队协作、历史和治理：

- Managed verified runner。
- Team dashboard：每周减少多少 review lines、哪些路径最常产生噪音。
- PR shrink history。
- Org-level policy：保护路径、允许删除类型、默认测试命令。
- Audit logs：谁运行、删了什么、采用了什么 patch。
- Badge hosting：Diet Card 或 PR badge。
- Slack/Linear/Jira summary。
- SSO/SAML、数据保留策略、self-hosted runner。
- Optional LLM-assisted ranking：只能显式 opt-in，不覆盖 test-verified 决策。

计费建议围绕：

- verified PR runs/month。
- private repos。
- runner minutes。
- retained history。
- org policy/audit/SSO。

不要按 “AI review comments” 定价，因为 PatchDiet 的产品心智不是评论数量。

## 首次用户体验蓝图

### 30 秒 Demo

1. 打开 demo。
2. 看到自动加载的 sample receipt，必要时点击 Reset sample。
3. 看到 before/after 指标。
4. 展开一个 deletion candidate。
5. 复制下一步 CLI 或 Action。

成功标准：用户不用理解内部算法，也能说出“它在帮我把 PR 变小”。

### 3 分钟 GitHub Action

1. 复制 README YAML。
2. 打开一个 PR。
3. Action 运行。
4. PR 出现 comment，artifact 中有 report 和 patch。
5. 如果权限不足，看到 step summary 和明确原因。

成功标准：外部 repo 第一次运行不需要维护者读源码。

### 5 分钟 CLI

1. 发布前 judge proof：`node dist/packages/cli/src/index.js doctor`
2. 发布前 judge proof：`node dist/packages/cli/src/index.js shrink --base origin/main --head HEAD --test "npm test"`
3. 发布后再替换为 `npm exec -- patchdiet ...`，前提是 `npm view patchdiet version` 和 `npm exec -- patchdiet --help` 已在干净项目验证。
3. 打开 `.patchdiet/report.html`。
4. 查看 `.patchdiet/removal.patch`。
5. 复制 apply 或 create-branch 命令。

成功标准：用户知道它没有直接改当前分支，心里安全。

### GitHub App

1. GitHub Marketplace 安装（外部提交并 install-tested 后；黑客松现场先展示本地 App skeleton / listing draft）。
2. 选择 repositories。
3. PR opened/synchronize 时自动 preview。
4. 如果启用 verified runner，再更新为 verified result。
5. 支持 `/patchdiet rerun`、`/patchdiet explain`。

成功标准：安装后第一条评论短、清楚、不刷屏。

### VS Code

1. AI agent 生成 patch 后，VS Code sidebar 出现 candidates。
2. 用户点击候选项查看理由。
3. 复制 shrink 命令或生成 report。
4. 明确 apply 是 opt-in。

成功标准：本地 AI coding 用户在提交前自然多走一步。

## 文档和内容优化清单

| 文档 | 建议补强 |
| --- | --- |
| `README.md` | 首屏加入 demo/App/CLI 三入口；加入 is/is-not；把 status/发布限制移到后文 |
| `docs/quickstart.md` | 按 Demo、Action、CLI、App 四条路径重写 |
| `docs/demo.md` | 写清 preview-only、隐私边界、PR URL fetch 机制 |
| `docs/github-action.md` | 权限、fork PR、artifact、失败降级、最小 YAML |
| `docs/github-app.md` | Preview/Verified 模式、权限矩阵、队列、幂等、部署 checklist |
| `docs/diet-card.md` | 明确 Diet Card 是传播资产，不是验证证据 |
| `docs/safety.md` | 强化“不证明语义等价，只证明配置检查通过” |
| `docs/security-model.md` | 增加数据流图、默认数据边界、LLM opt-in、日志策略 |
| `docs/troubleshooting.md` | 按错误现象组织，而不是按内部模块组织 |
| 新增 comparison page | 与 Copilot Code Review、CodeRabbit、PR-Agent、reviewdog、Danger、Graphite、Mergify 对比 |

## 安全与信任清单

必须反复、直白地说明：

- 默认不上传源码。
- 默认不调用 LLM。
- 默认不改当前分支。
- 默认不删除 test files。
- cleanup patch 与 final reduced patch 方向不同，名字必须清楚。
- PatchDiet 不证明语义等价。
- GitHub App 使用最小权限。
- Fork PR 权限不足时降级，不尝试绕过 secrets 限制。
- Hosted 模式有数据保留、删除、日志脱敏、self-host 选项。
- LLM-assisted 只能显式开启，且只用于候选排序/解释，不能覆盖测试验证。

建议在 PR comment 底部固定一句：

> PatchDiet only proves that the proposed cleanup still passes your configured checks. It does not prove semantic equivalence.

## 增长与传播建议

PatchDiet 的传播点不应是“又一个 AI 工具”，而是具体可截图的 before/after：

- `4 files / 128 changed lines -> 2 files / 32 changed lines` verified on agent-large-pr with node --test passing.
- Browser preview sample: `5 files / 33 lines -> 2 files / 14 lines`, 58% review noise removed, 4m estimated attention saved.
- `Browser previews likely noise; CLI verifies removals by rerunning tests.`
- `No source upload. No LLM required. Verified by your tests.`
- `Your AI wrote the PR. PatchDiet cleans the review surface.`

建议发布材料：

- 60 秒 GIF：AI PR 太大 -> PatchDiet report -> cleanup patch -> reviewer 只看关键 diff。
- 3 个可复现实例。
- 一篇技术文章：为什么测试通过的 AI PR 仍然难 review。
- 一篇安全文章：为什么 PatchDiet 默认不上传源码。
- GitHub Marketplace 截图：PR comment、HTML report、Diet Card。
- Hacker News/Reddit/X/LinkedIn 文案统一围绕“review surface reduction”。

## 30/60/90 天路线图

### 30 天：把首次成功做硬

- README 首屏重排。
- Demo 加 preview-only、sample library、下一步 CTA。
- CLI `doctor` 错误恢复增强。
- Report 加 risk、reason、reproduce、apply guidance。
- Action 外部 repo smoke test。
- 安全文档补齐默认数据边界。

### 60 天：把 GitHub 体验做像产品

- GitHub App preview 生产部署。
- 权限矩阵和 Marketplace listing draft。
- PR comment 幂等更新，不刷屏。
- Verified runner 最小可用。
- 3 个可复现 case study。
- Diet Card polish 和公开 demo report。

### 90 天：把团队价值做出来

- Test cache、runtime budget、partial report。
- Monorepo path-based test selection。
- VS Code extension 打包发布准备。
- Team metrics schema 接入真实 runs。
- Hosted Pro alpha：history、badge、policy、audit。
- comparison page 和 launch campaign。

## 成功指标

| 指标 | 为什么重要 |
| --- | --- |
| Demo time-to-first-result | 衡量陌生用户是否马上懂 |
| README -> demo/action/CLI 点击率 | 衡量首屏是否有效 |
| CLI first success rate | 衡量安装和命令体验 |
| Action install-to-comment success | 衡量 GitHub 集成质量 |
| App install-to-first-preview time | 衡量一键安装是否成立 |
| Average review lines reduced | 衡量核心价值 |
| Cleanup patch acceptance rate | 衡量建议是否可信 |
| False positive reports | 衡量安全风险 |
| Timeout/partial-result rate | 衡量性能体验 |
| Report artifact opens | 衡量报告是否有用 |

## 最优先的 10 个行动项

1. 把 README 首屏改成 Demo/App/CLI 三入口，并加入 is/is-not。
2. Web Demo 明确 preview-only，增加 sample library 和复制下一步命令。
3. GitHub comment 压缩到 30 行以内，长详情进 HTML artifact。
4. 每个 candidate 增加 risk、reason、command、reproduce、apply guidance。
5. 补齐 comparison page，清楚说明和 Copilot/CodeRabbit/Qodo/reviewdog 的区别。
6. 外部 repo 跑通 Action，并把 fork/permission 降级写进文档。
7. GitHub App 按 Preview/Verified 两层设计权限和文案。
8. 做 3 个可复现 case study，拒绝虚假营销数字。
9. 用 “no source upload, no LLM required, verified by your tests” 做统一信任文案。
10. 把 Pro 方向从“更多 AI”改成“团队历史、策略、审计、runner、趋势”。

## 参考来源

- GitHub Docs: [Using GitHub Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review?tool=webui)
- CodeRabbit: [AI Code Reviews](https://www.coderabbit.ai/)
- GitHub: [The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent)
- GitHub: [reviewdog/reviewdog](https://github.com/reviewdog/reviewdog)
- Danger JS: [What is Danger JS?](https://danger.systems/js/)
- GitHub: [super-linter/super-linter](https://github.com/super-linter/super-linter)
- Graphite: [Code review for the age of AI](https://graphite.com/)
- gitStream Docs: [gitStream Documentation](https://docs.gitstream.cm/)
- Mergify: [Merge and CI platform](https://mergify.com/)
- GitHub Docs: [Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app)
- GitHub Docs: [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- arXiv: [GitHub's Copilot Code Review: Can AI Spot Security Flaws Before You Commit?](https://arxiv.org/abs/2509.13650)
- arXiv: [RepoReviewer: A Local-First Multi-Agent Architecture for Repository-Level Code Review](https://arxiv.org/abs/2603.16107)
- 本地项目文件：`README.md`、`package.json`、`demo/index.html`、`docs/productization-status.md`
