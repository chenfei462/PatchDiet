# Productization Status

This tracks the requirements from the local productization brief on the desktop.

| Priority | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 1 | Reposition as AI-generated PR cleanup layer | Completed | README, package/action/CLI descriptions, report comment copy updated around verified `agent-large-pr` proof: 4 files / 128 changed lines -> 2 files / 32 changed lines, 75% changed-line reduction. |
| 1 | Preserve broader usefulness without diluting the core | Completed | README keeps AI-generated PRs as the primary use case and mentions other noisy PRs as secondary. |
| 1 | README first screen has contrast narrative and before/after | Completed | Hero uses verified `agent-large-pr` evidence: 4 files / 128 changed lines -> 2 files / 32 changed lines, 75% changed-line reduction, with `node --test` still passing. |
| 2 | 30-second Web demo | Completed locally | `npm run demo`, static demo, sample diff, paste diff support. |
| 2 | PR URL support | Completed locally | `scripts/serve-demo.mjs` exposes `/api/pr?url=...` for public GitHub PR diff fetch while sample diff remains local. |
| 2 | Demo metrics: files, lines, deletion hunks, review time | Completed | Implemented in demo and core insights. |
| 3 | GitHub App skeleton | Completed locally | Webhook server, analyzer, provider, comment renderer, env and manifest templates. |
| 3 | One-click install and real PR comments | Partial | JWT, installation-token exchange, real PR diff fetch, comment upsert, webhook signature verification, idempotent preview queue, job status, and neutral check-run provider are implemented locally; external App registration/hosting still required. |
| 4 | VS Code extension | Completed locally | Bundle script, `.vsix` package script, VSIX smoke, activity/sidebar tree, open candidate, copy suggestion, and dry-run JSON command are implemented. Marketplace/Open VSX publishing remains external. |
| 5 | Diet Card | Completed locally | HTML/SVG/PNG generation and badge markdown implemented; PNG export is deterministic local raster output. |
| 5 | PR badge design | Completed as interface | Badge markdown and future endpoint documented. |
| 6 | Performance bottleneck review | Completed as design | Current bottleneck documented; config surface added. |
| 6 | Parallel worktree pool and batch candidate evaluation | Completed | Worker pool honors `performance.max_parallel_worktrees`; git worktree mutations are serialized, checks run concurrently, and docs/generated batch evaluation is implemented. |
| 6 | Test-result cache | Completed locally | Candidate patch and command results now persist under `.patchdiet/cache/test-results` and are reused across runs. |
| 6 | Optional LLM mode | Completed as local policy interface | `intelligence.mode` config/CLI toggle and Pro policy evaluation are explicit opt-in; source upload remains false by default and no LLM call is made. |
| 7 | npm pack install smoke | Completed locally | `npm run smoke:release` packs, installs into a temp project, runs `patchdiet --help`, and verifies `patchdiet init --preset node`. |
| 7 | Agent post-commit hooks | Completed | Generic hook and Claude Code/Cursor/Aider/OpenHands docs added. |
| 7 | Free vs hosted Pro boundary | Completed | `docs/pro-mode.md`. |
| 8 | Case study template | Completed | `docs/case-study-template.md`, explicitly avoids fake claims. |
| 8 | Launch copy and GIF script | Completed | `docs/launch-materials.md`. |
| 8 | Public/reproducible case studies | Completed locally | `docs/case-studies/octocat-hello-world-pr-6.md` plus TS, Python, and monorepo reproducible fixtures are documented without fake claims. |
| 8 | 60-second GIF | Completed locally | `npm run gif:storyboard` and `npm run gif:demo-flow` write 60-second GIF assets under `docs/assets/launch-gif/`. |
| 8 | Hosted Pro readiness MVP | Completed locally | `packages/core/src/pro.ts`, `npm run pro:readiness`, and focused tests produce dashboard, badge, team metrics, integration summaries, audit, policy, billing, retention, LLM opt-in, remote-cache, and trend artifacts. |
