# PatchDiet 剩余任务清单

> 更新日期：2026-06-06
> 范围：基于 `docs/delivery-readiness.md`、`docs/productization-status.md`、`docs/roadmap.md`、`docs/product-delivery-plan.md` 的当前状态审计。
> 结论：本地可完成的发布、验证、运营和 P1/P2 MVP 项已完成并纳入测试；正式公开发布仍需要外部账号、托管和人工确认。

---

## 1. 本地已完成项

| 优先级 | 项目 | 当前证据 |
| --- | --- | --- |
| P0 | npm 发布准备 | `package.json` metadata/bin/files、`prepublishOnly`、`.github/workflows/publish-npm.yml`、`docs/npm-publishing.md`、`npm run smoke:release` |
| P0 | GitHub Release 流程 | `docs/release.md` 包含 version、changelog、CI、pack smoke、tag、release notes、npm publish、post-release 验证步骤 |
| P0 | README 发布前/发布后安装路径 | README 首屏使用 local dist/tarball proof；`npm exec -- patchdiet ...` 仅在 npm 发布并外部验证后作为正式路径 |
| P0 | 外部 Action smoke 准备 | `action.yml`、`packages/action/dist/index.mjs`、外部 workflow 文档、artifact/comment e2e、Action bundle freshness check |
| P0 | GitHub App 生产化本地准备 | webhook signature、health check、job queue、idempotency、PR diff fetch abstraction、comment upsert、neutral check-run provider、`npm run smoke:github-app` |
| P0 | Marketplace/support/status 材料 | `docs/marketplace-listing.md`、`docs/support-status.md`、`docs/github-app-permissions.md`、support/security issue paths |
| P1 | 持久化 test-result cache | `performance.cache_tests` 写入 `.patchdiet/cache/test-results`，按 head/patch/command/env hash 复用，e2e 覆盖 persistent cache hit |
| P1 | AST/symbol cleanup | TS/JS/Python function/class symbol atom 已接入 shrink，symbol kept/removed e2e 覆盖 |
| P1 | dependency-aware grouping | docs/generated batch 按 path-specific commands 分组评估，失败后 bisect，monorepo path-to-test e2e 覆盖 |
| P1 | parallel worktree 优化 | worker pool、git worktree mutation lock、candidate patch hash cache、global runtime budget、partial result e2e 覆盖 |
| P1 | monorepo path-to-test 映射 | `test_selection.packages` preset/config、`commandsForCandidate`、baseline command union、e2e 覆盖 |
| P1 | risk 分类报告优化 | Markdown/HTML removed evidence 按 Low/Medium/High/Blocked 分组；GitHub comment 保持短摘要 |
| P1 | benchmark dataset/workflow | `docs/benchmark-schema.json`、4 个 fixture（含 `agent-large-pr`）、`npm run bench:examples`、`.github/workflows/benchmark.yml`，benchmark workflow 同时上传 `.patchdiet/pro-readiness` |
| P1 | cleanup branch 稳健性 | `reduced.patch`/`removal.patch` 分离、empty patch guard、reverse apply failure human-review path、cleanup worktree e2e |
| P1 | VS Code 扩展发布准备 | extension bundle、commands/sidebar/webview、VSIX 打包脚本、`npm run smoke:vscode` 包内结构检查 |
| DOC | 文档与社区 | issue templates 五类、SECURITY/hosted report path、troubleshooting、public roadmap、case studies、launch copy、GIF assets |
| Q | 质量门槛 | flaky/timeout/Windows path fixtures、OS CI matrix、npm pack smoke、VSIX smoke、GitHub App smoke、Action freshness check、release rehearsal docs |
| P2 | 商业化本地 MVP | `packages/core/src/pro.ts` 和 `npm run pro:readiness` 生成 dashboard、badge、team metrics、Slack/Linear/Jira summaries、audit、policy、billing、retention、LLM opt-in、remote-cache、benchmark trend artifacts |

---

## 2. 仍需外部账号/托管/人工确认的发布项

这些不能在本地自动完成；它们需要 npm、GitHub、域名、托管、Marketplace、支付或邮件服务账号。

| # | 外部项 | 完成标准 | 人工验证命令或检查 |
| --- | --- | --- | --- |
| P0-1 | 正式发布 `patchdiet` 到 npm | `npm view patchdiet version` 返回当前版本；trusted publishing/provenance 通过 | `npm view patchdiet version`；`npm exec -- patchdiet --help` |
| P0-2 | 创建 GitHub Release | tag、release notes、changelog 与 npm 版本一致 | `git fetch --tags`；检查 GitHub Release 页面；`npm view patchdiet version` |
| P0-3 | 注册并托管真实 GitHub App | 生产 webhook URL、`/healthz`、签名校验、队列、PR comment/check-run 可用 | `curl https://<app-domain>/healthz`；在测试 PR 触发 webhook |
| P0-4 | 提交 GitHub Marketplace listing | logo、3 张截图、60 秒 GIF、权限解释、privacy/support/terms 链接齐全 | Marketplace draft checklist；安装到测试 org |
| P0-5 | 外部仓库 Action smoke | 非本仓库使用 `uses: chenfei462/PatchDiet@vX.Y.Z` 产出 artifact + PR comment | 在外部测试 repo 创建 PR 并检查 `.patchdiet/**` artifact 和 PR comment |
| P0-6 | 域名、托管、计费、支持邮箱、状态页 | hosted App 有 HTTPS 域名、support 入口、status page、计费/支付配置 | DNS/HTTPS/status page/support mailbox/payment provider 后台检查 |
| P1-3 | VS Code Marketplace/Open VSX 发布 | `.vsix` 上传成功并可安装 | `npm run smoke:vscode`；Marketplace/Open VSX 下载页安装测试 |
| P1-4 | 公开 Web Demo 部署 | demo public URL 可达，PR URL fetcher 隐私说明上线 | 打开 public demo URL；加载 sample diff；测试 public PR diff fetch |

---

## 3. 建议执行顺序

1. 发布 npm：运行本地 gates，确认 trusted publishing，发布并验证 `npm view` 和 `npm exec`。
2. 创建 GitHub Release：tag 与 npm version 对齐，发布 release notes。
3. 外部 Action smoke：在单独测试仓库使用 release tag 跑通 artifact/comment。
4. 托管 GitHub App：配置域名、webhook secret、private key、health check、status page。
5. 提交 Marketplace 和 VS Code/Open VSX：使用已生成 GIF、screenshots、VSIX、support/privacy/terms 链接。
6. 运营 handoff：创建 support mailbox、status page、billing provider、post-release monitoring issue。

---

## 4. 本地验证结果

2026-07-06 本地验证已运行：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；Action bundle 重新生成 |
| `npm test` | 通过；10 个测试文件、52 个测试；默认门禁为 unit + demo server smoke |
| `npx vitest run tests/e2e/action.test.ts` | 通过；6 个测试；覆盖 bundled Action、token scrub、PR comment fallback |
| `npx vitest run tests/e2e/release-readiness.test.ts` | 通过；13 个测试；覆盖发布材料和 README 口径 |
| `npx vitest run tests/unit/diet-card.test.ts` | 通过；4 个测试；Diet Card 主口径为 review noise removed |
| `npx vitest run tests/unit/runner.test.ts` | 通过；7 个测试；覆盖 env override 和 GitHub token scrub |
| `npm run test:e2e:heavy` | 未作为默认门禁运行；保留 CLI/shrink/GitHub App/VS Code/pack 等重型 e2e |
| `npm run smoke:release` | 通过；`npm pack`、临时安装、`patchdiet --help`、`patchdiet init --preset node` |
| `npm run smoke:vscode` | 通过；生成并检查 `patchdiet-vscode-0.1.0.vsix` |
| `npm run smoke:github-app` | 通过；构建后通过 GitHub App health/webhook smoke |
| `npm run pro:readiness` | 本轮未重新运行；仍是发布前/Pro 演示可选项 |
| `npm run bench:examples` | 通过；刷新 `.patchdiet/example-benchmarks` 三个本地 fixture artifacts，不作为市场数据 |
| `npx vitest run tests/e2e/demo-server.test.ts` | 通过；3 个测试；也包含在 `npm test` 默认门禁中 |

Action bundle freshness：当前工作区包含大量未提交源码与 bundle 改动，因此 `git diff --exit-code -- packages/action/dist/index.mjs` 不能作为相对 `HEAD` 的干净性证明；本轮用 `npm run build` 重新生成了当前源码对应的 Action bundle，发布前仍应在干净 clone 中运行 freshness check。
