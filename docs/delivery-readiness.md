# Delivery Readiness

Updated: 2026-06-06

## P0 Status

| Item | Local status | Evidence |
| --- | --- | --- |
| A. Patch artifact semantics | Completed locally | `reduced.patch`, `removal.patch`, `candidates.json`; `--apply` rejected; `--apply-removals` and `--create-branch` covered by e2e |
| B. Candidate data model | Completed locally | candidates include category, risk level, verdict, reason, commands, duration, SHAs, worktree id, reproduce command |
| C. Diff/git boundaries | Completed locally for fixtures/policy | rename/delete/binary/test/lockfile/generated/path spaces/Windows path parsing or risk policy; unsafe types go to human review |
| D. Verification system | Completed locally | baseline command summaries, retry/flaky, timeout classification, per-candidate command summaries, global runtime budget, partial result, failure kind |
| E. Doctor | Completed locally | Node, package manager, SHAs, fetch depth, worktree, config warnings, `.patchdiet` gitignore, monorepo hint, test executable |
| F. Config schema/init presets | Completed locally | schema validation, unknown key warnings, actionable errors, presets for node/python/go/rust/monorepo |
| G. GitHub Action | Completed locally | new artifacts and outputs, permission fallback tests, external workflow docs |
| H. GitHub App preview | Completed locally | webhook signature, idempotent job queue, job status endpoints, comment upsert, neutral check-run provider, preview wording |
| I. Report UX | Completed locally | Markdown/HTML/GitHub comment include before/after, risk, removed/kept/needs-human-review, artifacts, reproduce, safety note |
| J. Security docs | Completed locally | security model, threat model, App permissions, data retention, self-hosting, LLM-assisted mode |
| K. Cases and benchmark | Completed locally | 3 runnable fixtures plus reverse-apply fixture; `npm run bench:examples` writes input diff, report, run JSON, command, and limitation notes; benchmark docs avoid market claims |
| L. Release prep | Completed locally | npm pack install smoke script, VSIX package smoke, GitHub App smoke, release checklist, trusted publishing docs |
| M. Pro readiness MVP | Completed locally | `packages/core/src/pro.ts` plus `npm run pro:readiness` generate dashboard, badge, team metrics, Slack/Linear/Jira summaries, audit log, policy, billing, retention, LLM opt-in, and remote-cache artifacts |

## External Or Manual P0 Still Required

- Publish `patchdiet` to npm and verify `npm view patchdiet version`.
- Tag and publish a GitHub release.
- Register and host the real GitHub App.
- Submit GitHub Marketplace listing.
- Run an external repository Action smoke using `uses: chenfei462/PatchDiet@vX.Y.Z`.
- Configure any domain, hosted service, billing, support email, or status page.

## P1/P2 Local Status

| Item | Status |
| --- | --- |
| Parallel worktree pool | Completed locally |
| Test-result cache | Completed locally | In-process candidate result cache behind `performance.cache_tests`; persistent env-hash cache writes to `.patchdiet/cache/test-results` and is exercised by e2e |
| AST/symbol candidate | Completed locally | TypeScript/JavaScript and Python function/class extraction is wired into automatic cleanup atoms; symbol candidates are verified independently in e2e |
| Dependency-aware grouping | Completed locally | docs/generated batch candidates are grouped by selected test commands; failed batches are bisected; monorepo path-to-test selection is covered by e2e |
| Risk/classified reports | Completed locally | Markdown and HTML reports group removed evidence by low/medium/high/blocked risk; GitHub comments stay compact |
| VS Code VSIX packaging | Completed locally | `npm run smoke:vscode` bundles the extension, writes a `.vsix`, and checks package entries |
| VS Code marketplace publishing | External publishing still required | Visual Studio Marketplace/Open VSX publisher accounts and upload tokens are external |
| Public demo deployment | Local demo exists; public hosting external |
| Diet Card | Completed locally |
| Hosted Pro dashboard/data MVP | Completed locally | `buildProDashboard` and `npm run pro:readiness` produce `.patchdiet/pro-readiness/dashboard.json`, policy, audit, and benchmark trend artifacts |
| Team metrics/pricing/launch materials | Completed locally | local metrics schema, pricing draft, launch copy, GIF assets, and reproducible cases are documented; hosted billing remains external |
