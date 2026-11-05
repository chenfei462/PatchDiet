# Post-MVP continuation review

The previously accepted local CLI0.2.0 package remains immutable. New extension work is **IN PROGRESS, NOT ACCEPTED**. Current implementer is Paseo/ZCode **Z AI Start Plan GLM-5.3-Flash**, following the user's current-login clarification on 2026-10-07; the prior BigModel implementation identity remains correct for the historical MVP package.

Plan: `docs/superpowers/plans/2026-10-07-post-mvp-evidence-feedback-plan.md`.

## Current batch

Pinned Git history, explicit caller-supplied merged-PR snapshots, local SQLite persistence and readonly Scope Map evidence. No automatic network adapter, feedback-driven removal or App deployment is accepted yet. Root has prepared a genuine four-commit independent fixture: path a touched3commits, b touched3commits, two co-change commits. All temporary fixture Git commits belong to the reviewer; no product commits were made.

The former BigModel model id was absent from the current Paseo catalog and failed creation with INVALID_CONFIGURATION. The user clarified Z AI login; a new registered ZAI/GLM session successfully began reading project files. No credentials or global login settings were modified.

## GitHub App pre-integration findings

Actual independent probes ran with injected transports, synthetic tokens and a newly generated disposable RSA key. **No real network requests or real credentials were used.** Evidence is `.patchdiet/review-2026-10-04/post-mvp-app-origin-guard-review.json`.

1. `packages/github-app/src/github-provider.mjs` accepts an absolute foreign-origin URL in its public `request` method and invokes the transport with the installation-token Authorization header. The negative probe expected rejection before transport; actual result was one mock transport call. Before live integration, constrain requests to the configured trusted HTTPS API origin and refuse unsafe redirects, credentials in URLs and unsupported API targets.
2. `packages/github-app/src/auth.mjs` checks hostnames but allows `http://api.github.com`. Its token-exchange probe reached the mock transport over the plaintext URL. Before live integration, enforce HTTPS and a precise supported API origin before creating/sending an App JWT.

These are reproducible integration readiness defects, not claims that real credentials have leaked. The App server currently queues sample-diff preview jobs; its auth/provider helpers are not a complete webhook-to-verified-runner/check/action flow. Live private-beta acceptance must include installation/head identity, signed events, deduplication, job privacy, receipt validation and explicit cleanup-branch authorization.

## Persistent limits

Human-labelled natural agent PR sample count remains0: **NOT VERIFIED**. Mock App tests and manually constructed local feedback events cannot be counted as natural production data. External deployment, accounts, publication and human communication must be resolved only when a concrete reviewable local implementation is ready.

## Independent corrective review checkpoint

Fresh candidate typecheck/build passed. All12 independent functional holdouts passed after GLM corrections: four real-Git history/readonly/legacy checks; raw LF/TAB Git-object path framing; four unsafe-path/invalid-UTF8 negatives; and three merged-input/source-hash/public-citation/configuration checks. The first failing results are retained beside corrected results in the reviewer directory. These passing probes do not approve the batch by themselves.

Independent repository regression **FAILED, exit1**: two test files,19 passed,5 failed (24 total),71.21s. Actual evidence is `post-mvp-history-focused-independent.log` and its exit JSON. Remaining failures:

- The fast-import fixture omits the committer timezone and declares a constant message byte length although its messages vary. Git exits128. Generate well-formed bounded input; retain the100-commit cap assertions.
- The unusual-path fixture installs stdout/end listeners after awaiting process close, missing events and hanging until the unchanged30-second test deadline. Attach listeners before stdin and await completion; retain exact path-byte assertions.
- Two configuration diagnostic assertions insist on the word "requires" despite the returned diagnostic explicitly naming `knowledge.history.git: false`, the pinned-snapshot dependency and unavailable merged-PR evidence. Assert those semantic conditions and the existing enabled/available/ingested fields instead of an incidental English wording.
- The global-evidence limitation assertion expects singular "authorises" although the actual plural-subject statement says "records never authorise removal". Keep the removal-authority check and all weak/neutral/provenance/classification-identity assertions.

The ZCode native session then returned **NATIVE_PROTOCOL_ERROR**. Resuming the same Flash session, creating a fresh Flash session, and a fresh same-account GLM-5.3 probe asking only for `READY` also failed. Creation/model enumeration succeeds, but the turn fails before answering. Relevant Paseo logs expose only "ZCode turn failed/session failed", without an underlying HTTP or quota reason; no credential or quota conclusion is asserted. No login settings or credentials were edited. A supplier choice/connection-repair question is pending.

Task1 is **NOT ACCEPTED / NOT INTEGRATED**. Main hashes still match the accepted0.2.0 delivery. Feedback recording/ranking, App integration and optional cloud intent have not started implementation; do not describe the entire eight-week plan as completed.

## Superseding Task 1 acceptance checkpoint

The earlier failure checkpoint above is retained as historical evidence. The isolated candidate's pinned-history and caller-supplied merged-PR batch is now **ACCEPTED IN THE ISOLATED WORKSPACE**, not integrated into or released as the immutable 0.2.0 delivery. The Z AI GLM implementer repaired the five failing assertions/fixtures and the independently discovered Git path-framing defects (control-byte, invalid UTF-8 and commit-header-spoof filenames). The parser now distinguishes true NUL-framed commit headers from path records and refuses invalid UTF-8 path bytes with an explicit diagnostic.

Independent fresh verification in `C:\Users\hacjr\.paseo\worktrees\22ndakoi\patchdiet-scope-evidence` passed: typecheck, build, focused history tests (27/27), six reviewer holdout scripts (including real Git fixtures and readonly/source-identity checks), full regression (734 passed, 1 skipped across 53 files), and the 16-case CLI benchmark. Logs are under `.patchdiet/review-2026-10-04/` in the main workspace, including `post-mvp-history-sentinel-independent.log`, `post-mvp-history-full-independent.log`, and `post-mvp-history-benchmark-independent.log`. The deliberately failing invalid-UTF-8 probe was separately gated on its expected explicit error. Main delivery source identity remains frozen across all 27 checked files.

The benchmark's natural human-labelled PR count remains **0: NOT VERIFIED**. This acceptance authorizes the next isolated feedback batch only; it does not accept the remaining eight-week plan or authorize live App integration, deployment, publication, or customer contact.

## Superseding local continuation checkpoint — 2026-10-08

The user superseded the earlier ZCode implementer requirement and requested direct completion in this session. The Paseo implementer was stopped. All subsequent source changes described here remain in the isolated `C:\Users\hacjr\.paseo\worktrees\22ndakoi\patchdiet-scope-evidence` candidate; the accepted main 0.2.0 delivery was not rewritten, committed, published or deployed. The detailed local checkpoint is `deliverables/post-mvp-local-integration-review-2026-10-08.md` in that candidate.

Task 2 feedback record/show and explicit advisory ranking are locally implemented. Genuine shrink artifacts bind report bytes, emission-time cleanup patch hash, pinned Git identities, repository identity and candidate ordinal/content digest; contradictory final-verification identity is refused. The v1 schema remains intact and v2 is separate. Ranked trials can only reorder already eligible candidates and still require full final verification.

Task 3 now has a connected App adapter behind signed webhooks and a separate trusted runner receipt signature. The cross-origin installation-token leak and plaintext token-exchange defects noted above were fixed and tested. Mock HTTP coverage includes preview/check/comment, signed verified receipt, annotation, replay, stale head, cross-installation and explicit feedback/cleanup-branch actions. The genuine runner-artifact helper refuses tampered patches. Feedback action state and job deduplication are still in memory. No live App install, hosted runner, durable storage or real GitHub mutation was performed; production integration is **NOT VERIFIED**.

Task 4 adds a default-local, explicit-consent structured cloud-intent adapter, strict source spans/contradiction validation and a consented local natural-PR corpus importer with aggregate pilot metrics. No cloud credential or natural human-labelled PR was supplied. Natural sample count stays **0; production effectiveness NOT VERIFIED**.

Fresh candidate typecheck/build and the last seven focused suites passed **34/34**. The complete regression yielded **759 passed, 1 skipped, 1 failed** across 59 files: the installable-package end-to-end test hit its 120-second timeout under parallel load and then reported a locked temporary directory. The same test passed alone in **58.64 seconds**. The complete-run failure remains recorded, so there is no clean full-suite claim. The 16-case benchmark passed all applicable gates: removal precision **17/17**, full-pipeline detection **13/14**, independent final oracle **12/12**, hidden regressions **0**; its natural PR count is **0**. The installed Node runtime is **24.15.0**; a standalone Node 20 executable was not found, so the Node 20 runtime gate is **NOT VERIFIED**. The main-workspace source-identity review again passed all **27** frozen integrated hashes plus SQLite/version consistency.

## Superseding final local verification — 2026-10-08 (Asia/Tokyo)

The earlier parallel full-run failure above remains historical evidence. A fresh single-worker `npm test -- --maxWorkers=1` completed with exit code **0**: **59 files passed, 761 tests passed, 1 Windows symlink-permission skip**. Both installable-package tests passed. Fresh typecheck/build and local App smoke passed. A fresh 16-case benchmark passed all applicable gates with the same **17/17**, **13/14**, **12/12**, **0** results; its result directory is `benchmarks/results/2026-10-07T17-49-30-083Z` in the isolated candidate. Natural human-labelled PRs remain **0**, standalone Node 20 remains **NOT VERIFIED**, and no live App/runner/deployment or production pilot was performed. The accepted main 0.2.0 source remains frozen.
