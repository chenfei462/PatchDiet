# Post-MVP local development checkpoint — 2026-10-08

**Scope:** isolated `patchdiet-scope-evidence` worktree. The accepted main-workspace 0.2.0 delivery was not rewritten, committed, published or deployed. The user superseded the earlier ZCode implementer requirement and requested completion directly in this session.

## Task 2 — local feedback and advisory ranking

- `patchdiet feedback record/show` binds decisions to genuine `run.json` report bytes, the emitted `cleanup.diff` digest, fixed Git base/head identities, repository root and candidate ordinal/content digest. A contradictory final-verification identity is rejected. The legacy v1 schema remains separate; new records use strict v2.
- Safe local persistence, lock and idempotency, bad/stale/link/tamper inputs and two-run ranking have genuine shrink-artifact tests. Ranking is explicit and only changes the trial order of already eligible candidates; mandatory final oracle remains.
- This is local human-decision storage, not authenticated reviewer attribution or natural PR validation.

## Task 3 — mocked connected App adapter

- Installation JWT exchange now rejects plaintext/non-GitHub origins and redirects; Provider rejects cross-origin paths and redirects. Connected mode uses signed GitHub webhooks and pins repository, installation, PR and base/head identities before preview API calls.
- A separate runner HMAC gates verified Check Runs. The trusted runner helper signs only reports with an exact patch digest and passed final artifact oracle. Bounded annotations and at most three GitHub-compatible action buttons are emitted. Feedback actions are currently in-memory intents; a branch ref requires an explicit signed action, a signed verified receipt, fresh PR identity and a cleanup commit directly parented by the pinned PR head. Opening/synchronizing a PR does not create a branch or execute source commands on the server.
- Actual mock HTTP integration covers invalid webhook/runner signatures, retry, stale head, cross-installation receipt, forged verification, Check Run, annotation and feedback/branch actions. The default manifest stays `contents: read`; the separate opt-in branch manifest requests `contents: write`.
- **Not production-ready:** no live App registration/install, credentialed GitHub smoke, hosted runner, durable queue/receipt/feedback storage or restart-safe idempotency. The App server still trusts a properly signed runner's verification claims; digest fields alone cannot prove execution independently.

## Task 4 — optional cloud adapter and pilot preparation

- `patchdiet intent-extract` defaults to local normalization. Cloud extraction requires an explicit HTTPS provider URL, model, token and `--upload-consent`. The injected transport tests enforce bounded payload/response, exact UTF-8 source spans, strict fields, contradiction references, no redirects and local fallback. Cloud suggestions remain advisory and do not change cleanup eligibility.
- A strict consented natural-PR corpus importer and aggregate pilot metric validator are available. No genuine human-labelled natural PR data was supplied; claimed sample count remains **0, NOT VERIFIED**. No participant or result was invented.
- Cloud data preview, redaction policy and provider retention disclosure still need product work before a public upload feature. No cloud credential was configured or called in this checkpoint.

## Fresh verification and limits

- `npm run typecheck` and `npm run build`: passed after the latest source changes.
- Final focused suite: **7 files, 34 tests passed** (feedback, ranking, App mock, cloud CLI/adapter and corpus). Earlier reducer/AST/format policy focused suite: **5 files, 41 passed**. Real-artifact runner receipt test passed.
- Complete regression: **58 files passed; 759 tests passed, 1 skipped, 1 failed**. The failure was the installable-package test's 120-second timeout under parallel load, followed by a temporary-directory `EBUSY` during cleanup. The same installable test passed alone afterward in 58.64 seconds. Keep the full-run failure visible; this is not a clean full-suite pass.
- Sixteen-case CLI benchmark: all applicable gates passed. Removal precision **17/17 (100%)**, full-pipeline detection **13/14 (92.9%)**, independent final oracle **12/12 (100%)**, hidden regressions **0**. Results: `benchmarks/results/2026-10-07T17-11-14-598Z`. Natural PR count **0**.
- Local runtime is Node **24.15.0**. A standalone Node 20 executable was not found, so the Node 20 runtime gate remains **NOT VERIFIED**; the Action bundle was built targeting Node 20 and passed its existing tests under the available runtime.
- Main-workspace source identity review passed: all **27** accepted integrated-file hashes remained frozen, including pinned SQLite/version consistency. No commit, publication, deployment, external network call using real credentials or customer communication was performed.

## Superseding final local verification — 2026-10-08 (Asia/Tokyo)

- Fresh `npm test -- --maxWorkers=1` exited **0**: **59 files passed, 761 tests passed, 1 skipped** in 1462.56 seconds. The skip requires a dangling symlink that this Windows account cannot create (`EPERM`). Both installable-package tests passed; the pack/install/`npm exec` case took 25.41 seconds. The earlier parallel full-run timeout and `EBUSY` above remain recorded as a separate failed run.
- Fresh `npm run bench:cli-v02` exited **0** with all 16 cases satisfying their applicable gates: removal precision **17/17**, full-pipeline detection **13/14**, independent final oracle **12/12**, hidden regressions **0**. Results: `benchmarks/results/2026-10-07T17-49-30-083Z`. Natural human-labelled PR count remains **0, NOT VERIFIED**.
- Fresh `node scripts/github-app-smoke.mjs` exited **0** for the local unsigned-preview path. The connected webhook/runner/action path has mock HTTP test coverage, not a live App installation. `npm run typecheck`, `npm run build`, `git diff --check`, and the main-workspace 27-file source-identity review also exited **0** in this final review.
- These results establish a clean local single-worker regression on Node **24.15.0**. They do not establish a Node 20 runtime pass, durable App state, real GitHub integration, a customer-controlled runner, or production effectiveness.
