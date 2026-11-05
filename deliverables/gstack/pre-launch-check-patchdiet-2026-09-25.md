# PatchDiet 上线前全面检查报告

**日期**：2026-09-25
**场景**：上线前检查（代码审查 + 安全审计 + QA 测试评估）
**参与成员**：安全卫士（gstack-security-officer）+ 质量门神（gstack-qa-lead）+ 代码审查（由通用 Agent 补派，原产品官 gstack-product-reviewer 超时未回传）

---

## 📌 TL;DR（执行摘要）

- **整体结论：🔴 不通过（No-Go）** —— 存在 5 项上线阻塞项，核心 CLI 功能本身质量良好，但受"源码/产物分歧、缺失源码、测试门禁失败"三大问题阻塞，当前状态不可整体发布。
- **阻塞项数量：5 项（高）** + 中危 11 项 + 低危 12 项。
- **头号风险（跨安全+QA 共识）**：工作树 `packages/**/*.ts` 源码被清空/回滚，而可发布的 `dist/` 含有完整安全守卫。`prepublishOnly` 会从源码重构建 dist —— **若从当前回滚源码重建，安全守卫会被从 npm 包中剥除**（配置强校验、test 文件删除门控、写权限门控失效）。这是发布完整性层面的高危回归风险。
- **可独立上线的部分**：核心 CLI（shrink / check / doctor / report / card）算法、配置校验、测试运行器、报告渲染均稳健且无影响正确性的高危 bug；完成 P0 整改后该部分可发布。
- **不可发布的部分**：① GitHub App（源码与 dist 均缺失）；② VSCode 扩展（打包链路断裂，无法产出 vsix）。这两块在当前工作树下无法构建/运行，严禁发布。
- **下一步**：先完成 P0（对齐源码与产物 + 补齐/下线缺失模块 + 解耦测试门禁 + 核心算法补单测），再对 GitHub App / VSCode 扩展二选一修复或推迟发布。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🔴 No-Go（整体不通过，5 项阻塞） |
| 严重度分布 | 🔴 高 5 / 🟠 中 11 / 🟡 低 12 |
| 关键行动项 | 13 条（P0 ×5、P1 ×5、P2 ×3） |
| 建议负责人 | 安全卫士→发布门禁；质量门神→测试复位；代码审查→打包链路 |
| 可上线范围 | 仅核心 CLI（需先完成 P0 #1/#4/#5） |
| 禁止发布范围 | GitHub App、VSCode 扩展（当前工作树不可构建） |

---

## 1. 各成员核心结论（摘要）

### 🛡️ 安全卫士（OWASP + STRIDE 审计）
- **核心判断**：整体安全编码质量较高（git 操作用 `execFile` 数组参数无 shell、测试命令环境剔除 CI 令牌、报告输出统一转义、CI 最小权限 + OIDC 发布、无硬编码密钥）。风险等级 **中低**，默认部署下无可直接利用的高危漏洞。
- **关键建议**：发布前必须完成两项低成本修复 —— `publish-npm.yml` 钉定提交 SHA（当前 `@v6` 与全仓 `@v4` 不一致）与 `.gitignore` 补 `.env`；下个迭代处理 VSCode `diffCommand` 命令注入与演示服务器令牌代理。补充发现 **source↔dist 安全逻辑分歧**须作为发布门禁拦截（详见 H1）。

### ✅ 质量门神（QA 测试与发布）
- **核心判断**：测试等级 **D（不达标）**。默认 `test:fast` 实测 10/13 文件、32/101 用例失败，且失败为**确定性契约漂移**而非偶发；核心算法 `shrink.ts` 与 `github-app`/`pro`/`insights`/`symbols` 关键模块**无有效测试覆盖**；真实 `npm test` 被 `demo:build`（esbuild 平台崩溃）整体阻断。
- **关键建议**：头号项为**对齐源码与 dist、恢复安全守卫**并加守卫存在性发布卡点；补齐缺失源码消除孤儿测试；为 `shrink` 安全分支补单元覆盖；解耦 `npm test` 与 `demo:build`；接入覆盖率工具与 CI 阈值。

### 🔍 代码审查（补派，覆盖质量/bug/性能/规范）
- **核心判断**：核心算法（`config.js`/`git.js`/`runner.js`/`shrink.js`/`report/*`/`diet-card.js`）质量很高，进程树清理、凭据脱敏、输出转义均到位，无遗留 console.log/TODO。问题集中在**两条打包/验收链路断裂**（GitHub App 源码缺失、VSCode 扩展产物路径不匹配）及若干性能/健壮性隐患（缓存无上限、超时耦合、O(n²) 查找）。
- **关键建议**：先修 VSCode 扩展打包链路（否则 vsix 无法产出）；补齐/下线 GitHub App；解耦单命令超时与全局预算；`candidateResultCache` 加容量上限防常驻进程 OOM；报告构建改 Map 查找。

> 注：原产品官（gstack-product-reviewer）在本轮超时未回传，代码审查维度由通用 Agent 补派完成，结论已基于实际阅读 `dist/` 编译产物与 `scripts/`、`extensions/`、`demo/` 源码得出。

---

## 2. 综合审查发现（去重合并后按严重度排序）

### 🔴 高（上线阻塞，5 项）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源 |
|---|--------|------|------|---------|------|------|
| H1 | 🔴 | 安全/构建完整性 | `packages/**/*.ts`（源码）vs `dist/packages/**/*.js`（产物） | **源码↔产物分歧**：工作树 `packages/**/*.ts` 被清空/回滚，而 `dist/` 含完整安全逻辑（`validateConfig` 强校验、`allowTestFileRemoval`→needs-human-review、`allowBranchWrite` 门控）。`prepublishOnly` 会从源码重构建 dist —— 若从当前回滚源码重建，安全守卫将从 npm 包被**剥除** | 以 dist 安全逻辑为准回灌/修复 `config.ts`/`shrink.ts`；`npm run build` 后断言守卫存在；CI 在 `prepublishOnly` 前加守卫存在性卡点 | 安全官 + 质量门神 |
| H2 | 🔴 | 功能缺失 | `packages/github-app/`（空）、`scripts/github-app-smoke.mjs:14`、`action.yml` | GitHub App 源码与 dist 均缺失；冒烟脚本 `spawn(execPath,["packages/github-app/src/server.mjs"])` 必然失败，整功能无法发布 | 补齐 `packages/github-app/src/{auth,github-provider,jobs,comment}.mjs` 使 `github-app.test.ts` 可加载；或在未就绪前下线 `action.yml` 与冒烟脚本 | 质量门神 + 代码审查 |
| H3 | 🔴 | 打包链路断裂 | `scripts/package-vscode-extension.mjs:45-46,54-61`、`extensions/vscode-patchdiet/extension.mjs:7` | 打包脚本读取 `extensions/vscode-patchdiet/dist/extension.mjs`（不存在，仅 `extension.mjs` 在根）→ 守卫抛 `Missing VS Code extension package input`，无法产出 vsix；且 `extension.mjs:7` 以 `../../dist/...` 脆弱相对路径依赖仓库布局，打包后失效 | 先 `tsc`/`esbuild` 生成 `dist/extension.mjs` 再打包，或改读取路径并同步 `package.json` 的 `main`；依赖改用 `import.meta.url` 绝对解析或内联 | 代码审查 |
| H4 | 🔴 | 测试门禁 | `package.json`(`pretest:fast`→`demo:build`)、`scripts/build-demo-assets.mjs` | 真实 `npm test` 被 `demo:build`（esbuild 原生二进制平台不匹配）整体阻断；当前 `test:fast` 实测 32/101 失败（多为源码/test 契约漂移）；开发者本地 `npm test` 不跑重型 e2e（cli/shrink/action） | 解耦 `npm test` 与 `demo:build`；让核心单测全绿；把 cli/shrink/action 流程测试纳入默认 `npm test` | 质量门神 |
| H5 | 🔴 | 测试覆盖 | `dist/packages/core/src/shrink.js`(`getConservativeSkipEvaluation` 约 1036–1085)、`tests/unit` | 核心"瘦身"算法安全分支（test 文件→人审、binary→人审、ignorePaths→kept、rename/copy/delete→人审）**仅重型 e2e 间接覆盖、零单元覆盖**；已出现 source/dist 安全分支分歧且无人发现 | 为 `shrink` 纯函数（`isFormattingOnly`/`matchesPattern`/`classifyCandidate`/安全分支三态）补单元覆盖；用 mock 注入 `runCommand` 测"保留/删除/人审" | 质量门神 + 安全官 |

### 🟠 中（11 项）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源 |
|---|--------|------|------|---------|------|------|
| M1 | 🟠 | 安全/注入 | `extensions/vscode-patchdiet/extension.mjs:27,101-108` | `diffCommand` 来自 `.vscode/settings.json`（仓库可控），经 `execFileAsync(cmd,{shell:true})` 执行且**未校验 `isTrusted`** → 打开恶意仓库即任意命令执行 | 执行前校验 `vscode.workspace.isTrusted`；或改 `execFile` 数组参数、固定 `git` + 安全参数 | 安全官 |
| M2 | 🟠 | 安全/SSRF | `scripts/demo-server-lib.mjs:61-98`、`scripts/serve-demo.mjs:50-64` | `/api/pr` 在进程环境带 `GITHUB_TOKEN` 时，用环境令牌向 `api.github.com` 取 diff → 条件性 SSRF/令牌代理（可读私有 PR）。`owner/repo` 未编码 | 默认禁转发 `GITHUB_TOKEN`；`owner/repo` 做 `encodeURIComponent`；加 allowlist 限制公开仓库 | 安全官 |
| M3 | 🟠 | 安全/供应链 | `.github/workflows/publish-npm.yml:16-17` | 发布流程用可变主版本标签且 `@v6` 与全仓 `@v4` 不一致（可能解析失败或被劫持），且发 `npm publish` 依赖 OIDC 令牌 | 钉定到完整提交 SHA，统一版本号；加 Dependabot 与发布前 attestation | 安全官 |
| M4 | 🟠 | 性能/内存 | `dist/packages/core/src/shrink.js:13,999` | 模块级 `candidateResultCache`(Map) 永不淘汰；VSCode 扩展为常驻进程，重复运行持续增长 → OOM | 加 LRU/TTL 上限或容量上限（最近 2000 条）+ 定期 clear | 代码审查 |
| M5 | 🟠 | 性能/并发 | `dist/packages/cli/src/index.js:111`、`shrink.js:22` | 单命令默认超时 = 全局预算（`maxRuntimeMinutes`*20min），单个慢测试即耗尽全部预算，并发评估（`maxParallelWorktrees`/`budget.isExhausted()`）几乎不触发 | 单命令超时与全局预算解耦（如 `min(候选, 全局预算/2)`） | 代码审查 |
| M6 | 🟠 | 性能 | `dist/packages/core/src/shrink.js:124,142,160` | 报告构建对大 PR 重复 O(3n·n) `candidateItems.find(c=>c.id===id)` 三次 | 先建 `Map<id,item>` 复用，避免重复展开 | 代码审查 |
| M7 | 🟠 | 测试/工程化 | `vitest.config.ts`、`package.json`(devDeps 无 `@vitest/coverage-*`) | 无覆盖率度量与阈值卡点，CI 无法设阈值拦截退化 | 接入 `@vitest/coverage-v8`，对 `packages/core` 设最低行/分支阈值（初值 70%）并在 CI 失败 | 质量门神 |
| M8 | 🟠 | 测试覆盖 | `scripts/*.mjs`（13 个，仅 `demo-server-lib.mjs` 被测） | 构建/打包/冒烟脚本无单元/行为验证，仅 e2e 以 `execFile` 冒烟（非断言） | 抽纯函数做单测；e2e 至少断言退出码与关键产物存在 | 质量门神 |
| M9 | 🟠 | 测试/CI | `.github/workflows/ci.yml`(`test:e2e:heavy` 仅 `ubuntu`) | 重型 e2e 仅 ubuntu 跑，Windows 专用 `taskkill` 超时分支、路径分隔符处理在 win/mac CI 从不执行 | 重型 e2e 至少在 windows 也跑，或抽 OS 分支单测 | 质量门神 |
| M10 | 🟠 | 安全/配置告警 | `action.yml`、`dist/packages/core/src/runner.js:7-15`、`.github/workflows/patchdiet-pr.yml` | 设计上以 `shell:true` 执行 PR 自带测试命令；当前 `pull_request` + `contents:read` 安全，但**误改为 `pull_request_target` + checkout PR head 将升级为特权 RCE** | SECURITY.md/工作流注释明确禁止 `pull_request_target`+checkout PR head；保留 `runner.js` 的 `scrubEnv` 令牌剔除并加测试守护 | 安全官 |
| M11 | 🟠 | 安全/配置校验 | `packages/core/src/config.ts`（源码层，结合 H1） | 源码 `loadPatchDietConfig` 对非法值静默回退默认、不抛错；危险配置（如 `intelligence.mode:cloud` 无 provider、`max_parallel_worktrees:0`）会被静默接受，安全护栏形同虚设 | 实现真实 schema 校验（zod/手写），安全相关字段强校验并抛可操作错误 | 质量门神+安全官 |

### 🟡 低（12 项）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源 |
|---|--------|------|------|---------|------|------|
| L1 | 🟡 | 安全/配置 | `.gitignore:1-12` | 未忽略 `.env`/`*.env*`/`*.key`/`*.pem`/`secrets*.json`，开发者易误提交含令牌文件 | 追加忽略项（一行改动） | 安全官 |
| L2 | 🟡 | 安全/注入 | `dist/packages/core/src/shrink.js:1315`、`cli/index.js:350-358` | git 引用（baseRef/headRef）以 `-` 开头理论触发参数注入（当前为数组参数无 shell，低概率） | 校验 ref 不以 `-` 开头，或用 `rev-parse --verify --end-of-options` | 安全官 |
| L3 | 🟡 | 安全/信息泄露 | `scripts/demo-server-lib.mjs:46-53` | 演示静态根含 `examples/`（可能含示例仓库 `.git`）可被遍历 | 静态根收窄为 `demo`+`docs/assets`，排除 `.git`/隐藏文件 | 安全官 |
| L4 | 🟡 | 安全/SSRF | `scripts/demo-server-lib.mjs:80-83` | `fetchPublicPullRequestDiff` 未编码 `owner/repo` 且接受 `apiUrl` 参数（未来若接用户输入可转向内网） | `owner/repo` 做 `encodeURIComponent`；`apiUrl` 加域名 allowlist 并禁重定向到非允许域 | 安全官 |
| L5 | 🟡 | 安全/日志 | `dist/packages/core/src/runner.js:105-113` | `redactSensitiveOutput` 仅覆盖有限模式（`ghp_/npm_/TOKEN|KEY|SECRET|PASSWORD`），自定义格式（`Authorization: Bearer ...`）可能进 `run.json` | 扩展正则（含 `Authorization`/`Bearer`/`client_secret`/云密钥前缀），写入前再脱敏 | 安全官 |
| L6 | 🟡 | 安全/CSP | `extensions/vscode-patchdiet/extension.mjs:114-123` | Webview `enableScripts:true` 无 CSP，未来新增未转义拼接即可执行脚本（当前转义到位无 XSS） | 设 `Content-Security-Policy`（`default-src 'none'; img-src https:; style-src 'unsafe-inline'`），保留现有转义 | 安全官 |
| L7 | 🟡 | 安全/路径穿越 | `dist/packages/cli/src/index.js:225,234-236` | `diet-card --output` 为用户任意路径，`join(cwd,options.output)` 直写，未做 `..` 穿越校验（本地 CLI 场景） | 写入前用 `isInsidePath` 边界校验（复用 `demo-server-lib.mjs:109-112`），补越界拒绝单测 | 安全官+质量门神 |
| L8 | 🟡 | 正确性/边界 | `dist/packages/core/src/diff.js:51` | 开启 git copy 检测时，`copy from` 置 `pendingChangeType="copy"`，无 `copy to` 处理，目标文件不入 `files`，相关候选被忽略 | 补 `copy to` 分支，确认默认不开启 copy 检测时的行为 | 代码审查 |
| L9 | 🟡 | 健壮性 | `dist/packages/cli/src/index.js:206,231` | `report`/`card` 命令 `JSON.parse(readFileSync(jsonPath))` 无 try/catch，`.patchdiet/run.json` 缺失/损坏抛原始 `SyntaxError` | 包 catch 给出"请先运行 patchdiet shrink"提示 | 代码审查 |
| L10 | 🟡 | 健壮性 | `dist/packages/core/src/insights.js:36` | `humanAttentionSavedMinutes` 未 `Math.max(0,...)` 夹紧下界（output 行数异常可负） | 夹紧下界 | 代码审查 |
| L11 | 🟡 | 质量/冗余 | `package-vscode-extension.mjs`、`diet-card.js`、`config.js:34-35`、`shrink.js`(`createRuntimeBudget`) | `escapeXml`/`crc32` 重复实现；`strategy/atomGranularity` 硬编码 conservative/hunk 吃掉配置项；`exhausted` 字段与 `isExhausted()` 重复 | 统一工具函数、消除重复（不阻塞上线） | 代码审查 |
| L12 | 🟡 | 测试质量 | `tests/unit/demo-motion.test.ts`(45KB)、`report/diet-card.test.ts`、`vitest.config.ts` | 像素对比测试 flaky 风险；字符串精确匹配断言脆弱；`fileParallelism:false`+`testTimeout:240000` 套件慢；巨型测试文件可读性差 | 视觉测试设宽松阈值/锚定参考图；断言结构化字段；开并行+收紧默认超时；按场景拆分大文件 | 质量门神 |

---

## ✅ 行动清单（13 条）

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 对齐 `packages` 源码与 dist 安全逻辑（恢复 `validateConfig`/`safety` 块/`shrink` 安全分支）；`npm run build` 后断言守卫存在；CI 在 `prepublishOnly` 前加守卫存在性卡点 | 安全门神 + 代码审查 | **P0** | 发布前必做 |
| 2 | 补齐 `packages/github-app/src/*.mjs` 源码使 `github-app.test.ts` 可加载；或在未就绪前下线 `action.yml` 与 `github-app-smoke.mjs` | 代码审查 + 质量门神 | **P0** | 发布前必做 |
| 3 | 修复 VSCode 扩展打包链路：先构建 `dist/extension.mjs` 再打包，或改读取路径；`extension.mjs:7` 依赖改 `import.meta.url` 绝对解析 | 代码审查 | **P0** | 发布前必做 |
| 4 | 解耦 `npm test` 与 `demo:build`；修复 source/test 契约漂移，让 `test:fast` 全绿；把 cli/shrink/action 流程测试纳入默认 `npm test` | 质量门神 | **P0** | 发布前必做 |
| 5 | 为 `shrink.js` 安全分支（`getConservativeSkipEvaluation` 三态、忽略路径、二进制、test 文件门控）补单元覆盖 | 质量门神 + 安全官 | **P0** | 发布前必做 |
| 6 | `publish-npm.yml` 钉定提交 SHA，统一 `@v4`（当前 `@v6` 不一致） | 安全官 | **P1 立即** | 发布前 |
| 7 | `.gitignore` 补 `.env`/`*.env*`/`*.key`/`*.pem`/`secrets*.json` | 安全官 | **P1 立即** | 发布前 |
| 8 | VSCode `diffCommand` 加 `isTrusted` 校验或改 `execFile` 数组参数（去 shell） | 安全官 | **P1** | 下迭代 |
| 9 | 演示服务器默认禁用 `GITHUB_TOKEN` 转发；`owner/repo` 编码 + 公开仓库 allowlist | 安全官 | **P1** | 下迭代 |
| 10 | 接入 `@vitest/coverage-v8` + CI 阈值（初值 70%） | 质量门神 | **P1** | 下迭代 |
| 11 | `candidateResultCache` 加容量上限（LRU/TTL）防常驻进程 OOM | 代码审查 | **P2** | 例行维护 |
| 12 | 单命令超时与全局预算解耦；报告构建改 `Map` 查找消除 O(n²) | 代码审查 | **P2** | 例行维护 |
| 13 | CI 在 windows 也跑重型 e2e；视觉测试降 flaky；断言去字符串耦合 | 质量门神 | **P2** | 例行维护 |

---

## ⚠️ 阻塞项清单（上线前必须清零）

1. **H1** 源码↔产物安全分歧，重建会剥守卫 —— 对齐源码并在 `prepublishOnly` 前加守卫断言。
2. **H2** GitHub App 源码与 dist 均缺失 —— 补齐源码或下线 `action.yml`。
3. **H3** VSCode 扩展打包链路断裂 —— 修复构建顺序/路径，否则 vsix 无法产出。
4. **H4** 测试门禁失败且被 `demo:build` 阻断 —— 解耦并复位核心单测全绿。
5. **H5** 核心算法零单元覆盖 —— 补 `shrink` 安全分支单测。

> 仅当 #1/#4/#5 完成，核心 CLI 部分方具备发布条件；#2/#3 未完成前，GitHub App 与 VSCode 扩展**禁止发布**。

---

## ⚠️ 回滚预案

- **npm 包**：采用 OIDC provenance + 语义化版本标签，发现问题版本用 `npm deprecate <pkg>@<version>` 标记并发布 patch 修复；发布前对当前已验证 `dist/` 打 tag/保留为安全基线，`prepublishOnly` 重建前先 `git stash` 或基于已验证 tag。
- **GitHub Action**：发布于 Marketplace，回滚需重新发布上一稳定 tag 的 action 版本；CI 已用 `git diff --exit-code -- packages/action/dist/index.mjs` 校验产物一致性，可借此快速识别产物回归。
- **VSCode 扩展**：通过 VSIX 版本回退；在 H3 修复前不要发布扩展，避免发布不可运行产物。
- **整体原则**：所有发布动作加入"守卫存在性"预检门禁（见 H1），防止带病/退化的安全逻辑进入发布物。

---

## ⚠️ 待完善 / 已知局限

- **专家覆盖**：原产品官（gstack-product-reviewer）超时未回传，代码审查由通用 Agent 补派完成，已基于实际代码得出结论，但与专家流程的标准化产出口径略有差异。
- **范围限制**：`packages/action/dist/index.mjs` 与 `packages/github-app/src/server.mjs` 运行时源码在快照中缺失，令牌处理、Webhook 签名（是否 `crypto.timingSafeEqual`）、端点鉴权未做源码级审计，建议补齐后专项复核。
- **依赖供应链**：受限于快照未联网查询 CVE 库，未实际跑 `npm audit`；建议发布前执行 `npm audit` + `npm audit signatures` 确认无已知 CVE。
- **测试运行环境**：本机 `npm test` 因 esbuild 原生二进制平台不匹配直接崩溃，QA 实测数据为绕过 `pretest` 钩子的最小套件结果，仅供判断趋势。

---

## 📚 成员产出索引

- 安全卫士（gstack-security-officer）原始产出：主报告（STRIDE + OWASP Top 10 检查表、中低危清单 M1–M4/L1–L6）+ 补充报告（source↔dist 分歧高优项、L7 CLI 路径穿越）。
- 质量门神（gstack-qa-lead）原始产出：主报告（实测 32/101 失败、覆盖缺口、H1–H5/M1–M4/L1–L4）+ 修正补充（根因定为 source/dist 分歧 R-1，重分类 H-1/H-2/H-3/M-4）。
- 代码审查（补派 general-purpose）原始产出：总体质量评估 + 高/中/低发现（GitHub App 与 VSCode 打包链路断裂、缓存/超时/查找性能隐患、边界与冗余）。
- 产品官（gstack-product-reviewer）：**超时未回传，未纳入本报告**。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
