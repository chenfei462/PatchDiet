# PatchDiet v0.2 Plan — Verified Gap Analysis

**Date:** 2026-10-03
**Subject:** `docs/superpowers/plans/2026-10-03-ai-change-scope-verification-plan.md` (the "plan") against the current working tree (branch `codex/hackathon-judge-mode`, v0.1.1).
**Method:** Four independent auditors (config & verification oracle; reduction algorithm & verification loop; diff parsing & serialization; product surface) produced claims with cited evidence; a second confirmer pass re-derived every critical/high claim (confirmer notes below are treated as authoritative where they disagree with an auditor). For this report I additionally re-read the load-bearing code locations myself (all cited lines verified in this session: `packages/core/src/config.ts:184`, `packages/core/src/shrink.ts:331/400/436-441/493-514/661-730/861-876/1111-1149`, `packages/core/src/types.ts:55`, `packages/cli/src/index.ts:91/111-130`, `packages/core/src/diff.ts:340-370`) and found every one to match the auditors' citations. Plan quotes are cited as `plan:LINE`.

**Confidence legend for "independently confirmed":**
- **confirmer** — an independent confirmer re-derived the verdict with evidence (authoritative).
- **2 auditors** — two auditors reached the same verdict independently.
- **this session** — I re-read the cited code and confirmed it.
- **auditor only** — single auditor, detailed cited evidence, no confirmer pass.

---

## 1. Baseline

| Check | Result |
|---|---|
| `npm run typecheck` (workflow baseline) | **Could not run.** `WorkflowError: world.run 'npm' did not run to completion (spawn_error): spawn C:\Program Files\nodejs\npm ENOENT` |
| `npm run test` / full suite (workflow baseline) | **Could not run.** Same spawn ENOENT error. |
| `npm run typecheck` (re-run in this session) | **Passed.** `npm` is actually on PATH here (`C:\Program Files\nodejs\npm.cmd`, node v24.15.0). Command: `npm run typecheck` → `tsc -p tsconfig.json --noEmit`, exit 0, no output. |
| `npm run test` / full suite (this session) | **Not run.** The suite is `vitest run` with v8 coverage (vitest.config.ts:10-22), which writes `coverage/` and build artifacts into the working tree; this ask forbids changing anything in the repository except the one report file. The workflow attempt failed with the spawn error above. Reported as **not run**, per rules. |

Implication: the audit findings below rest on code reading and the auditors' live experiments, not on a green test baseline. A CI run of `npm run test` should be the first action after this report.

---

## 2. Claim verdicts

| # | Plan claim (location) | Audit verdict | Independently confirmed? | What the code actually does |
|---|---|---|---|---|
| 1 | **P0 bug #1** (plan:28, plan:555-601): `--test` defaults to `[]`; `flags.test ?? config.commands.required` lets the empty array shadow `patchdiet.yaml` `commands.required`, so shrink can run with no oracle | **Partial** (mechanism real, live data-loss refuted) | **confirmer** (reproduced the merge behavior at runtime: `mergeConfigWithFlags(cfg,{test:[]}).commands.required === []`) + **2 auditors** (config-oracle, product-surface) + **this session** (`config.ts:184`, `cli/src/index.ts:91,115-128`) | Mechanism verbatim: `required: flags.test ?? config.commands.required` (`packages/core/src/config.ts:184`); `--test` declared with Commander default `[]` (`packages/cli/src/index.ts:91`, same at :159 for `doctor`). But **no shipped caller passes the raw default**: the CLI resolves `tests` as flags → config → auto-detect and throws `noTestCommandMessage()` if still empty before merging (`packages/cli/src/index.ts:115-128`); the Action does the same (`packages/action/index.mjs:21-34`). The plan's own regression scenario (plan:592-601) **passes today**. The hazard is library-level: `mergeConfigWithFlags` replaces config with an explicitly passed `[]`, and `runShrink` has no guard (see row 2). |
| 2 | Implicit plan claim: engine fails closed when no required command exists | **Partial** | **confirmer** (all ten cited locations re-read) + **this session** (`shrink.ts:331`, `:436-441`) | Shipped surfaces DO fail closed (CLI `packages/cli/src/index.ts:121-123`; `doctor` :188-208 sets exit 1; Action `packages/action/index.mjs:27-29`). The **engine does not**: `runShrink(options: RunShrinkOptions)` takes plain `requiredCommands: string[]` (`packages/core/src/shrink.ts:282,331`) with no emptiness check; with `[]` the baseline loop runs zero iterations and returns success (`shrink.ts:854-889`), `report.testCommand.status` is **hardcoded `"passed"`** (`shrink.ts:436-441`), the per-candidate `for (const command of options.requiredCommands)` never executes so every candidate gets verdict `"removed"` (`shrink.ts:833-848`), and combined verification passes trivially (`shrink.ts:714-726`). The config loader also happily returns `required: []` (`packages/core/src/config.ts:16,57,141,196`). Only a direct `runShrink` library caller (it is exported via `packages/core/src/index.ts:7`) can produce a cleanup labelled verified with no oracle. |
| 3 | **P0 bug #2** (plan:28, plan:603): "There is no subsequent combined oracle pass over the full removal set" | **REFUTED** | **confirmer** + **2 auditors** (reducer, product-surface) + **this session** (`shrink.ts:400, 661-730`) | `verifyCombinedRemovalSet` exists and is always-on: called right after evaluation (`shrink.ts:400`, "M3" comment), it reverse-applies **all** removed hunks together onto a fresh headRef worktree (`shrink.ts:696-712`) and reruns every required command (`shrink.ts:714-726`); on any failure `downgradeRemovals` flips **every** removal to needs-human-review and the report is marked partial (`shrink.ts:643-653, 707-709, 720-722`). Directly tested: `tests/unit/shrink-safety.test.ts:1112-1152` (A/B mutually-required fixture → 0 removals, both downgraded, `partial: true`). Two residual gaps: (a) the pass is **skipped** when the global runtime budget is already exhausted, with the report explicitly marked partial (`shrink.ts:679-684`); (b) the downgrade is **all-or-nothing** — no ddmin/restore search to retain a smaller jointly-safe subset (plan:645-649 asks for one). |
| 4 | Plan:120/603 framing: "runShrink evaluates every hunk independently" | **Partial** (imprecise) | **2 auditors** (reducer, diff-serializer) | Evaluation is two-phase and file-first: Phase 1 tests the whole-FILE patch (`shrink.ts:579-586`), Phase 2 tests per-hunk candidates only for files not removed whole (`shrink.ts:588-614`); hunks of a fully-removed file inherit the file verdict without individual testing (`shrink.ts:625-627`). Binary/rename/delete files are escalated without evaluation (`shrink.ts:1062-1109`); budget-exhausted candidates are skipped unevaluated (`shrink.ts:805-811`). |
| 5 | Plan:652-662: the exact emitted patch should be verified on a clean base-ref worktree | **Confirmed missing** (as a gap, the plan is right) | **confirmer** + **3 auditors** (reducer, diff-serializer adjacent, product-surface) | The emitted `cleanup.diff` is never run against the oracle. Verification is only the inverse-removals patch on headRef (`shrink.ts:702-726`). The `createBranch` path creates a clean base-ref worktree, applies the kept patch, then only `git add`/`git commit` — no required command, no tree comparison (`shrink.ts:493-510`, apply at :500). `--apply` applies to the live tree unchecked (`shrink.ts:512-514`). No tree-comparison code exists in core (confirmer grep: only `resolveCommitSha` at `shrink.ts:1004`). |
| 6 | Plan:351: "the loader currently assigns defaults to those reduction properties" (max_runtime_minutes, retry_flaky_tests) | **REFUTED** for the named fields | **2 auditors** (config-oracle refuted with test citations; product-surface independently confirmed enforcement) | `max_runtime_minutes` (int 1–1440) and `retry_flaky_tests` (int 0–10) are parsed from YAML (`config.ts:65-66`), preferred over defaults (`config.ts:147-148`), round-trip tested (`tests/unit/config.test.ts:44-58, 426-450`, boundary matrix :378-390), and consumed: CLI uses them as per-command timeout and retry count (`packages/cli/src/index.ts:139-140`); the engine's `resolveBudgets` reads `maxRuntimeMinutes` (`shrink.ts:947`); baseline retries are honored in `runRequiredCommands` (`shrink.ts:861-876`, `maxAttempts = 1 + retryFlakyTests`). The real gap is different fields — see row 7. |
| 7 | Implicit: config fields are wired end-to-end | **Confirmed partially inverted** | **2 auditors** | Genuinely consumed: `base`, `commands.required`, `scope.ignore_paths`, `reduction.max_runtime_minutes`, `reduction.retry_flaky_tests`, `performance.max_parallel_worktrees`. **Validated but never consumed**: `commands.optional`, `reduction.strategy` (locked to `z.literal("conservative")`, `config.ts:20,63`), `reduction.atom_granularity` (locked to `"hunk"`, `config.ts:21,64`), `report.html/markdown/github_comment`, `safety.mode/allow_upload`, `intelligence.mode`, `performance.cache_tests`. The CLI/Action write all four artifacts unconditionally (`packages/cli/src/index.ts:143-149`; `packages/action/index.mjs:52-55`); `report.md`/`run.json` are always written by `shrink.ts:519-526`. |
| 8 | Plan:767: "The current serializer synthesises ordinary text-file headers around hunks; it should not pretend to safely support rename metadata, binary patches, file modes and every new/deleted-file case" | **Partial** — correct for `serializePatch`, and the live failure is **worse** than the plan states | **confirmer** (reproduced with fresh scratch-repo experiments) | `serializeFilePatch` (`shrink.ts:1111-1149`) returns `""` for rename/delete (:1118-1121), filters binary hunks (:1122), emits `""` for mode-only files (zero serializable hunks, :1123-1125), and synthesizes plain `diff --git / --- a/ / +++ b/` headers with no `new file mode`/`--- /dev/null` (:1127-1131). **Live-verified consequences:** (a) a kept **new-file hunk** serialized as a plain modification makes `git apply` fail on the base worktree — with `createBranch:true` the whole run **throws** at `shrink.ts:500` ("error: test/agent.test.js: No such file or directory") after verification completed and before `report.md`/`run.json` are written (:519-526), leaving `cleanup.diff`, the cleanup worktree and branch behind; (b) with `createBranch:false`, a **mode-only file silently vanishes** — no candidates, no report entry, absent from `cleanup.diff` (zero-hunk files dropped at `shrink.ts:570-577, 617-639, 408-422`); (c) `git apply -R` of the plain new-file patch leaves the file **empty** rather than deleting it, so the counterfactual state tested differs from base. Corrections: `serializeUnifiedDiff` in `packages/core/src/diff.ts:344-368` **does** support these forms (replays captured `extendedHeaders` byte-for-byte, only binary payload unpreserved, documented at `diff.ts:340-342`), and its round-trips are tested (`tests/unit/diff.test.ts:385-453`); the coverage gap applies to `serializePatch` only (module-private; no test drives a kept new-file hunk or mode-only change through `runShrink`). |
| 9 | Worktree creation/reverse-apply/cleanup are sound | **Confirmed** (mechanism verified; two live caveats) | **confirmer** (re-read all cited code, reproduced experiments) | Eval worktrees live **inside the target repo** at `<cwd>/.patchdiet/eval/<name>` (`shrink.ts:813-816`), created via `git worktree add --detach <path> <headRef>` (:234,252) with prune+rmSync+one-retry self-healing (:236-261). Failure semantics conservative per candidate: apply failure → needs-human-review (:826-831); command failure/timeout → kept (:833-843). Layered cleanup verified (:849-851, :264-276, :527-550, signal handlers :98-152, stale prune :155-225) with unit coverage (`tests/unit/shrink-safety.test.ts:1016-1109`). Caveats: see row 8 (uncaught forward-apply throw) and the empty-file residue on reverse-apply of new-file hunks. |
| 10 | There is no caching of candidate verification results | **Confirmed — and worse than stated** | **confirmer** (authoritative correction) + **2 auditors** | There is effectively **no caching at all**. The in-process memo (`shrink.ts:23-74`: `candidateVerdictCache`, SHA-256 key, 512-entry cap, `readCachedVerdict`/`writeCachedVerdict`) is **dead code** — zero call sites (verified by grep in this session: only the definitions at `shrink.ts:62,66`). Its doc comment (`shrink.ts:23-31`, "Candidate verdicts are memoized per run") describes behavior that does not happen; eviction would be FIFO, not LRU. `evaluatePatchCandidate` (`shrink.ts:791-852`) unconditionally creates a worktree and re-runs the oracle. The week-2 work is wiring + set-level keys, not building from scratch. |
| 11 | Verification outcomes are binary pass/fail: no INCONCLUSIVE, no flake-retry, no per-command timeout | **Partial** — 3 of 4 assertions stale | **auditor** (detailed citations) | Not binary: `CandidateVerdict = "removed" \| "kept" \| "needs-human-review"` (`packages/core/src/types.ts:55`). Baseline **does** retry (`shrink.ts:861-876`, pinned by `tests/unit/shrink-artifacts.test.ts:167-183`). Per-command **timeouts exist**: `runCommandDetailed` kills the process tree (`taskkill /T /F` on Windows, process-group SIGKILL on POSIX; `packages/core/src/runner.ts:89-133`), reports `failureKind "timeout"` (`runner.ts:181-209`), and `commandTimeoutMs` is threaded to baseline (:869), candidate eval (:834) and combined verification (:715). **Still true:** candidate evaluation and combined verification run each command **exactly once** — no retry, no oscillation detection, no INCONCLUSIVE — so a flaky pass can promote an unsafe removal on a single sample. |
| 12 | No symbol/AST atoms; symbol module is unwired | **Confirmed** (unit claim corrected to file+hunk) | **confirmer** + **2 auditors** | No parser exists in-repo (grep for tree-sitter/ts-morph/babel/AST machinery: zero hits). `extractSymbolCandidatesFromDiff` (`packages/core/src/symbols.ts:57-104`) is a regex scan of added lines, hardcoded riskLevel "medium", with no consumer — the only references are the barrel re-export (`packages/core/src/index.ts:8`) and its unit test. Reduction units are whole file (`shrink.ts:736-755`) and textual hunk (`shrink.ts:757-789`); `atom_granularity` is a `z.literal("hunk")` (`config.ts:21,64`) and is never read by the engine. |
| 13 | No ddmin / subset-complement search; no persistent cache | **Confirmed** | **auditor** (greps) + consistent with confirmer on row 10 | No ddmin/bisect/subset-complement code anywhere; the search is the fixed two-phase single pass plus the M3 combined downgrade. No persistent test-result or candidate cache; `performance.cache_tests` is validated-but-unused config. Note `docs/remaining-tasks.md:19-23` claims all of this exists (see §3). |
| 14 | CLI surface: plan proposes init/index/verify/explain/shrink/report/feedback + `--task` | **Confirmed absent** | **confirmer** | Exactly six commands registered: init, check, shrink, doctor, report, card (`packages/cli/src/index.ts:25,65,88,156,212,235`). No `index`/`verify`/`explain`/`feedback`, no `--task`/`--task-file`, no `--strategy`/`--granularity`/`--final-verify` options. |
| 15 | No SQLite anywhere; `migration` package is not a storage foundation | **Confirmed** | **confirmer** | Only `sqlite` hit in all of `packages/` is a dead driver enum string (`packages/migration/src/types.ts:106`); no package.json declares any DB dependency; the migrator keeps state in in-memory Maps and calls user-supplied `up()`/`down()` only (`packages/migration/src/migrator.ts:24-26,137-154`). Nothing imports `@patchdiet/migration`, and its test file is not even matched by the vitest include globs (`vitest.config.ts:4-9`). `packages/knowledge` does not exist. |
| 16 | GitHub App is preview-only; no check-runs in any production flow | **Confirmed** | **auditor** | `packages/github-app/src/server.mjs` has HMAC verification (:53-74), fail-closed 503 without secret (:148-159), in-memory dedupe queue (`jobs.mjs:27-92`), JWT/installation auth (`auth.mjs:7-53`), comment upsert, and a `createCheckRun` method (`github-provider.mjs:71-135`) whose only caller is a test (`tests/e2e/github-app.test.ts:176`). The job closure is `countPreviewStats` — no verify/shrink pipeline runs server-side. |
| 17 | README positioning matches code; `docs/remaining-tasks.md` does not | **Confirmed** | **auditor** | README's command list matches the CLI exactly and its Status section (`README.md:187-189`) correctly says AST atoms/dependency reasoning are future work. `docs/remaining-tasks.md` (dated 2026-06-06) claims symbol atoms are wired into shrink (:20), dependency-aware grouping with bisect (:21), a persistent test-result cache (:19) and monorepo `test_selection`/`commandsForCandidate` (:23) — **none exist in the source** (all greps empty). |

---

## 3. Where the plan is wrong or imprecise

Where a confirmer disagreed with or refined an auditor, the confirmer's version is stated as authoritative and marked.

1. **plan:603 is factually wrong about the current code (its second P0 bug does not exist as stated).** The combined removal-set oracle pass ("M3") already exists, is always-on, downgrades on failure, and is tested (`shrink.ts:400, 661-730`; `tests/unit/shrink-safety.test.ts:1112-1152`). Week 2 should be scoped as "add **base-side artifact verification** + **ddmin/restore search on the combined-failure path**", not "implement combined verification from scratch". Residual truths the plan can still claim: the pass is skipped on budget exhaustion (marked partial, `shrink.ts:679-684`), and failure downgrades *all* removals rather than bisecting to a smaller safe subset — the actual week-2 algorithm gap.

2. **plan:555-601 (its first P0 bug) overstates a live regression.** The empty-`[]`-shadows-config scenario cannot manifest via the CLI or Action today because both pre-resolve the test list to non-empty or throw (`packages/cli/src/index.ts:115-128`; `packages/action/index.mjs:21-34`); the plan's own regression scenario (plan:592-601) would pass if run today. The hazard is real but **latent and library-level**: `mergeConfigWithFlags` honors an explicitly passed empty array (`config.ts:184`, runtime-verified by the confirmer), and the engine has no fail-closed guard (`shrink.ts:282,331`). Keep the fix — reframe it as engine/config-boundary hardening, not a user-facing break.

3. **plan:351 names the wrong fields.** `max_runtime_minutes` and `retry_flaky_tests` are parsed, enforced and consumed (`config.ts:65-66,147-148`; `cli/src/index.ts:139-140`; `shrink.ts:861-876,947`; tested in `tests/unit/config.test.ts:44-58,426-450`). The fields that actually exist in the schema but are dead are: `commands.optional`, `reduction.strategy`, `reduction.atom_granularity` (both locked to single literals), `report.html/markdown/github_comment`, `safety.mode/allow_upload`, `intelligence.mode`, `performance.cache_tests`. Related: plan:603's "no final combined verification" sibling assertion is refuted (item 1).

4. **plan:767 (serializer) is right in direction but materially incomplete.** The reduction-pipeline `serializePatch` is the problem; the diff package's `serializeUnifiedDiff` already replays `extendedHeaders` correctly (`diff.ts:344-368`) with round-trip tests (`tests/unit/diff.test.ts:385-453`). The plan does not mention the live-verified crash: a kept **new-file hunk** crashes `--create-branch` runs at the forward `git apply` (`shrink.ts:500`) *after* verification, with no `report.md`/`run.json` written — and a **mode-only change silently vanishes** from candidates, report and `cleanup.diff` entirely. These are shipped-surface bugs today, not future AST-atom concerns.

5. **plan:120/603 "evaluates every hunk independently" is imprecise.** Evaluation is two-phase file-first (row 4); "every hunk independently" describes only Phase 2.

6. **plan:817-827 ("no flake-retry policy, no per-command timeout handling") is stale.** Baseline retry and process-tree-killing timeouts exist and are wired from config (row 11). What is missing is narrower: retry/oscillation/INCONCLUSIVE handling for **candidate and combined** verification, which currently sample each command exactly once.

7. **plan:714-725 (caching) understates the starting point.** Confirmer's authoritative correction: there is *no* caching, not even the in-process memo the code claims — `readCachedVerdict`/`writeCachedVerdict` have zero call sites, the eviction would be FIFO not LRU, and the doc comment at `shrink.ts:23-31` is false. Week 2 must wire the existing scaffolding and fix or delete the comment.

8. **`docs/remaining-tasks.md` is stale and contradicts the code.** Its "本地已完成项" table claims symbol atoms wired into shrink, dependency-aware grouping with bisect, a persistent test-result cache, and monorepo test_selection/commandsForCandidate mapping — none exist (row 13, 17; all greps empty). The plan and this backlog must not treat it as an inventory of shipped capability. Related stale claims: `docs/delivery-readiness.md:39` and `docs/performance-and-intelligence.md:47` describe batch-bisect behavior the code does not implement. The README (`README.md:187-189`) is the accurate status document.

9. **Minor plan-adjacent imprecision:** the plan's `verification` knobs (plan:332-334) and `safety.protect` policy levels (plan:336-342) have no schema counterpart at all; the nearest existing mechanism, `scope.ignore_paths`, marks candidates "kept" (`shrink.ts:1090-1097`) — weaker than the plan's "protected → human review regardless of verification".

---

## 4. Gap analysis across the four pillars

Auditors' gaps merged and deduplicated; each mapped to the plan's weeks (plan:921-931).

### Scope Map (plan weeks 1, 3, 4)
| Gap | Evidence | Plan week |
|---|---|---|
| No v2 config: `version` accepted as any int ≥ 1 (`config.ts:52,137`), no per-version schema, no migration path — the plan's v2 block (plan:287-349) has nowhere to land | config-oracle | 1 |
| No `intent` section, no intent sources (`cli/github_pr/linked_issue/commits`), no LLM-adapter config; nearest field `intelligence.mode` is parsed but dead | config-oracle, product-surface | 4 |
| No `--task`/`--task-file` flags; no requirement schema; no PR/issue/commit adapters; `index`/`verify`/`explain`/`feedback` commands absent | product-surface (confirmer) | 4 |
| Five scope states (required/supporting/candidate/uncertain/protected) do not exist; nearest analog is the flat `CandidateCategory` label enum (`types.ts:48-53`) used only in reports | product-surface | 4 |
| No `knowledge` config (database path, languages, rules.auto_discover, history) | config-oracle | 3 |
| No `safety.protect` globs or `dependency_manifests`/`unsupported_diff` policy levels; `ignore_paths` "kept" semantics are weaker than "protected" | config-oracle | 1-2 |
| Feedback memory: no feedback command, no memories/feedback tables, no accept/keep/false-positive capture | product-surface | 5 (schema), 8 |

### Evidence Engine (plan weeks 4-5)
| Gap | Evidence | Plan week |
|---|---|---|
| Reports carry one free-text `reason` string + category per candidate (`types.ts:63-78`); no typed evidence categories (intent/graph/rules/test/history/static/runtime/memory), no polarity/confidence/source_ref | product-surface | 5 |
| No Evidence Report / Scope Report renderer in `packages/report` (current formats: Markdown/HTML/GitHub-comment/Diet Card; JSON is `JSON.stringify` in the CLI; no GitHub check-run format) | product-surface | 5 |
| `commands.optional` loaded but consumed by nobody — plan gives it an advisory evidence role | config-oracle, product-surface | 5 |
| Report toggles decorative — CLI/Action write all artifacts unconditionally | product-surface | 5+ (hygiene) |
| No targeted test selection: no test-to-symbol mapping, no LCOV/coverage ingestion, no `INCONCLUSIVE` in `TestCommandStatus` (`types.ts:80-85` is passed/failed/not-run) | product-surface | 5 |

### Reducer (plan weeks 2-3)
| Gap | Evidence | Plan week |
|---|---|---|
| No dependency-grouped ddmin: fixed two-phase single pass, one oracle run per candidate, and `downgradeRemovals` discards **all** removals on combined failure instead of bisecting to a jointly-safe subset (`shrink.ts:643-653`) | reducer (confirmer caveat a/b), product-surface | 2 |
| No candidate-result caching wired: memoization scaffolding is dead code with a false doc comment (`shrink.ts:23-74`) | reducer, product-surface; confirmer correction | 2 |
| No sub-hunk/atom encoder: `serializePatch` re-emits original hunks with plain text-file headers only; `buildDefaultHeaders` (`diff.ts:384-402`) never synthesizes `@@`, `new file mode`, `--- /dev/null`, mode or rename headers — AST atoms cannot be reverse-applied without it | diff-serializer | 2-3 (prerequisite for 3) |
| No hunk→base/head line-range mapping: headers stored as raw strings (`types.ts:14-18`); `parseHunkHeaderCounts` (`diff.ts:424-433`) extracts counts, not start lines; no cumulative offsets tracked | diff-serializer | 3 (prerequisite) |
| No tree-sitter parse layer, no symbol graph, no SQLite — greenfield (`symbols.ts` regex scanner is dead code; no DB dependency anywhere; `migration` package unrelated and its test not even in the vitest include) | diff-serializer, product-surface (confirmer) | 3 |
| Human-review routing holes: `isNew` files not routed (`getConservativeSkipEvaluation`, `shrink.ts:1062-1109`), mode-only files silently vanish, kept new-file hunks crash `createBranch` runs | diff-serializer (confirmer, live-verified) | 1 ("classify unsupported diff forms") |

### Verifier (plan weeks 1-2)
| Gap | Evidence | Plan week |
|---|---|---|
| Engine does not fail closed on empty `requiredCommands`; baseline success + all-removed verdicts with zero oracle runs; `report.testCommand.status` hardcoded `"passed"` (`shrink.ts:436-441`) | config-oracle, product-surface (confirmer) | 1 |
| `mergeConfigWithFlags` empty-array shadowing (`config.ts:184`) — latent, library-level | config-oracle, product-surface (confirmer) | 1 |
| Emitted `cleanup.diff` never verified on a clean base-ref worktree (plan:652-662 second pass missing) | reducer, product-surface (confirmer) | 2 |
| No retry/oscillation/INCONCLUSIVE for candidate & combined verification (baseline retry + timeouts already exist) | reducer | 2 |
| No `verification.targeted_first`/`full_required_at_end` config; evaluation ordering is implicit (`shrink.ts:579-614`) | config-oracle | 2, 5 |
| Config/oracle invariants not attested in `run.json` (e.g. granularity used, parse-failed flags) | config-oracle, diff-serializer | 5 |

Cross-pillar note: the plan's six-week MVP assumes ~65 person-days (plan:41) — an estimate this audit did not evaluate (§6).

---

## 5. Prioritized backlog

P0 = correctness/safety; the plan itself says these precede every knowledge feature (plan:28). P1 = core v0.2 MVP (plan weeks 2-6; week-2 reducer-foundation items are included because the MVP's safety claim depends on them). P2 = later (weeks 5-8 remainders and beyond).

### P0

**P0-1. Fail-closed oracle guard at the engine/config boundary**
- **What:** In `runShrink`, reject `requiredCommands` with length 0 (plan:578-588 error text); derive `report.testCommand.status` from the actual baseline result instead of hardcoding `"passed"` (`shrink.ts:436-441`); harden `mergeConfigWithFlags` to treat `flags.test !== undefined && flags.test.length > 0` as the only override (`config.ts:184`, plan:571-576). Keep the existing CLI/Action pre-checks (`cli/src/index.ts:115-128`, `action/index.mjs:21-34`).
- **Why:** With `[]`, the baseline passes trivially (`shrink.ts:854-889`), every candidate auto-verdicts `"removed"` (`shrink.ts:833-848`), combined verification passes trivially (`shrink.ts:714-726`), and the report says `status: "passed"` — a library consumer of the exported `runShrink` (`packages/core/src/index.ts:7`) can ship a "verified" cleanup with zero oracle runs (confirmer-verified end to end).
- **Acceptance:** `runShrink({ requiredCommands: [] })` rejects with the fail-closed message; a library-level test proves no report labelled verified can be produced with zero commands; `mergeConfigWithFlags(config, { test: [] })` preserves `config.commands.required`; existing CLI/Action e2e unchanged.
- **Files:** `packages/core/src/shrink.ts`, `packages/core/src/config.ts`, `tests/unit/shrink-safety.test.ts`.
- **Source:** plan:555-601 ("Fix the existing verification-command bug first") — corrected by audit to engine/config-boundary scope.

**P0-2. Human-review routing and safe serialization for new-file, mode-only and metadata-only changes; guard the createBranch forward-apply**
- **What:** Route `isNew` files, mode-only/zero-hunk metadata files, and any file whose hunks cannot be re-encoded safely to `needs-human-review` in `getConservativeSkipEvaluation` (`shrink.ts:1062-1109`) instead of silence or crash; either serialize kept new-file hunks with `new file mode 100644` + `--- /dev/null` (reusing `extendedHeaders`, `diff.ts:344-368`) or mark them unremovable; wrap the `createBranch` forward `git apply` (`shrink.ts:500`) so a failure downgrades to a partial report instead of throwing out of `runShrink` after verification, and register the cleanup worktree for signal-path cleanup.
- **Why:** Live-verified by the confirmer: with `createBranch:true`, a kept new-file hunk makes the run throw (`error: test/agent.test.js: No such file or directory`) after verification completed, before `report.md`/`run.json` are written (`shrink.ts:519-526`), leaving `cleanup.diff` + worktree + branch behind; with `createBranch:false`, a mode-only file produces no report entry at all and silently vanishes from `cleanup.diff` (`shrink.ts:570-577, 617-639, 408-422`).
- **Acceptance:** A scratch repo containing a chmod-only change plus a new source file and new test file runs `runShrink` with `createBranch:true` to completion; the mode-only file appears in the report as needs-human-review; a kept new-file hunk applies cleanly on the base worktree; an injected forward-apply failure yields a partial report, not an uncaught throw.
- **Files:** `packages/core/src/shrink.ts`, `tests/unit/shrink-safety.test.ts`, `tests/unit/diff.test.ts`.
- **Source:** plan:767 and the "Diff-format edge cases" risk row (plan:999); concrete failure modes discovered live in this audit.

**P0-3. Base-ref artifact verification of the exact emitted patch**
- **What:** After `cleanup.diff` is written (`shrink.ts:425-429`), add a `verifyEmittedPatch` pass: clean worktree at `baseCommitSha` (already resolved at `shrink.ts:379-382`), apply the exact serialized kept patch, run all required commands, optionally compare the resulting tree against the expected `HEAD − removals` tree; on failure downgrade and `markPartial`. Account for `serializeFilePatch` silently skipping rename/delete/binary (`shrink.ts:1115-1149`).
- **Why:** The plan's "verified" gate requires the exact artifact the developer receives to pass the oracle (plan:652-662, plan:942, plan:956); today only the inverse patch is tested on headRef (`shrink.ts:702-726`), the base-ref worktree applies with no checks (`shrink.ts:498-506`), and `--apply` is unchecked (`shrink.ts:512-514`) — serializer defects ship directly (confirmer-verified).
- **Acceptance:** 100% of artifacts labelled verified pass the final oracle on the benchmark; a deliberately corrupted emitted patch produces a partial report with all removals intact, never a "verified" label.
- **Files:** `packages/core/src/shrink.ts`, `tests/unit/shrink-safety.test.ts`.
- **Source:** plan:652-662 ("Artefact verification" acceptance row, plan:942); independently flagged by three auditors (reducer gap, product-surface gap P0, diff-serializer live experiment).

**P0-4. Sub-hunk/atom-capable patch encoder with recomputed `@@` headers and diff-kind metadata**
- **What:** Add a serializer alongside `serializeUnifiedDiff` that can emit a patch for an arbitrary group of lines/atoms: recompute `@@ -o,n +p,m @@` counts and offsets, and emit correct diff-kind metadata (`new file mode`/`--- /dev/null`, mode, rename) reusing the `extendedHeaders` capture; replace or wrap `serializePatch` (`shrink.ts:1111-1149`).
- **Why:** `serializePatch` can only re-emit whole parsed hunks with the original header string and plain text-file headers; `buildDefaultHeaders` (`diff.ts:384-402`) never synthesizes `@@` lines or diff-kind metadata. Without an encoder, no reduction unit below a hunk can be reverse-applied, and the P0-2 new-file failure reproduces at atom granularity (diff-serializer auditor, P0).
- **Acceptance:** Round-trip tests for new-file, deleted-file, mode-only, rename, rename-with-edit, quoted paths, CRLF and no-newline forms through the new encoder; every atom patch the reducer produces applies and reverse-applies cleanly in the test fixtures.
- **Files:** `packages/core/src/diff.ts`, `packages/core/src/shrink.ts`, `tests/unit/diff.test.ts`.
- **Source:** plan:727-767 ("AST atomisation", serializer caveat); diff-serializer audit gap (P0).

**P0-5. Hunk line-range parser (base/head coordinates)**
- **What:** Export a parser that fully resolves `@@ -o,n +p,m @@` into per-hunk head/base line ranges (respecting `noNewlineAfter`, `diff.ts:188-193`, and verbatim CRLF content, `diff.ts:243-244`), plus cumulative offset tracking across hunks per file.
- **Why:** The diff model stores headers as raw strings (`types.ts:14-18`); `parseHunkHeaderCounts` (`diff.ts:424-433`) is private and extracts counts, not start lines. Mapping changed lines to enclosing AST nodes (P1 knowledge/reducer work) and emitting atom spans is impossible without it (diff-serializer auditor, P0 enabler).
- **Acceptance:** Unit tests mapping multi-hunk files (insertions, deletions, replacements, mixed) to correct base and head ranges; consumed by the P1 atomizer.
- **Files:** `packages/core/src/diff.ts`, new `packages/core/src/candidate.ts` or `reducer.ts`.
- **Source:** plan:727-727ff (parse-and-map design, plan:727); diff-serializer audit gap (P0).

### P1

**P1-1. Dependency-grouped ddmin reduction with restore search**
- **What:** New `packages/core/src/reducer.ts`: a group/partition model above `DiffHunk`, candidate-**set** evaluation (today `evaluatePatchCandidate` accepts exactly one file-or-hunk patch, `shrink.ts:791-799`), subset/complement iteration over groups (Picire-style, plan:670-712), weighted evaluation order, and a restore search hooked into `verifyCombinedRemovalSet`'s failure path so a failing combined set yields the largest jointly-safe subset instead of `downgradeRemovals` discarding everything (`shrink.ts:643-653`).
- **Why:** The current search is a fixed two-phase single pass with no iteration; one bad hunk in the removal set currently costs all removals (confirmer-verified caveat b on the refuted claim).
- **Acceptance:** The A/B mutually-required fixture (plan:607-619) retains a smaller safe subset rather than zero removals where one exists; ddmin operates on grouped atoms and caches duplicate candidate sets (plan:944); a benchmark delta vs the single-pass baseline is recorded.
- **Files:** new `packages/core/src/reducer.ts`, `packages/core/src/shrink.ts`, `packages/core/src/types.ts`, `tests/unit/shrink-safety.test.ts`.
- **Source:** plan week 2 (plan:924), plan:645-649, plan:670-712; reducer + product-surface audits.

**P1-2. Wire candidate-set caching into the oracle**
- **What:** Call `readCachedVerdict`/`writeCachedVerdict` from `evaluatePatchCandidate` (key check before worktree creation at `shrink.ts:813`, store at :845-848) and from combined/ddmin set evaluation; extend `candidateVerdictCacheKey` (`shrink.ts:40-60`) to candidate sets + environment fingerprint (plan:714-725); decide persistence (in-process vs the plan's SQLite `verification_runs`, plan:483-485); fix or delete the false doc comment (`shrink.ts:23-31`) and correct the FIFO-not-LRU eviction.
- **Why:** Confirmer-authoritative: there is **no** caching today — zero call sites; every candidate re-runs the oracle in a fresh worktree. Under ddmin this is what keeps the search affordable (plan:114 "cache hit rate", plan:997).
- **Acceptance:** A duplicate candidate set hits the cache (measured hit rate in a fixture); eviction behavior matches its name or is renamed; the doc comment describes reality.
- **Files:** `packages/core/src/shrink.ts`.
- **Source:** plan week 2; reducer + product-surface audits; confirmer correction (no caching exists at all).

**P1-3. Retry/INCONCLUSIVE handling for candidate and combined verification**
- **What:** Shared retry wrapper (reusing `runRequiredCommands`' attempt loop, `shrink.ts:861-876`) for candidate eval (`shrink.ts:833-843`) and combined verification (`shrink.ts:714-726`); add an `INCONCLUSIVE` outcome for pass/fail oscillation (plan:817-827); an INCONCLUSIVE check can never yield `"removed"` (mirror `downgradeRemovals`); extend `CandidateVerdict` (`types.ts:55`) and the report renderers.
- **Why:** Candidate and combined verification sample each command exactly once today — a flaky pass promotes an unsafe removal on a single sample; a flaky fail silently demotes a good one (reducer audit; baseline retry and timeouts already exist and are out of scope).
- **Acceptance:** A flaky-oracle fixture produces INCONCLUSIVE → needs-human-review, never a removal (plan:951); oscillation-detection test; existing artifacts tests still pass.
- **Files:** `packages/core/src/shrink.ts`, `packages/core/src/types.ts`, `packages/report/src/index.ts`.
- **Source:** plan "Flaky execution needs a third state" (plan:817-827, plan:951); reducer audit partial claim.

**P1-4. Config v2 schema: version gating, v1→v2 migration, and the plan's missing sections**
- **What:** Per-version schema selection in `packages/core/src/config.ts` with rejection of unknown versions; a v2 strictObject adding `intent` (sources, llm), `knowledge` (database, languages, rules.auto_discover, history), `verification` (targeted_first, full_required_at_end), `safety.protect` globs + `dependency_manifests`/`unsupported_diff` policy enums, widened `reduction.strategy`/`atom_granularity`, `dependency_grouping`/`final_verification`, `report.evidence/json/markdown/github_check`; v1 files keep loading.
- **Why:** `version` is accepted as any int ≥ 1 with no second schema (`config.ts:52,137`); the plan's v2 block (plan:287-349) has nowhere to land; `strategy`/`atom_granularity` are locked to single literals (`config.ts:20-21,63-64`) so ddmin/AST are inexpressible; `safety` has no protect semantics today (nearest: `ignore_paths` "kept", `shrink.ts:1090-1097`).
- **Acceptance:** The plan's example v2 YAML (plan:286-349) loads and every field is consumed by some code path or explicitly documented as advisory; v1 configs behave identically to today; `version: 3` fails with an actionable error.
- **Files:** `packages/core/src/config.ts`, `packages/core/src/shrink.ts` (plumb-through), `tests/unit/config.test.ts`.
- **Source:** plan week 1 ("implement config v2 parser", plan:923) and plan:286-349; config-oracle audit gaps.

**P1-5. Intent extraction, Scope Map classification, and evidence records**
- **What:** Structured intent schema with source spans (plan:152-171); `--task`/`--task-file` flags and the deterministic source order (plan:134-148); optional PR/issue/commit adapters; repository-rule auto-discovery (AGENTS.md/CLAUDE.md/GEMINI.md/copilot-instructions/CONTRIBUTING, plan:205-215); the five scope states with per-atom typed evidence records (category, polarity, confidence, source_ref) replacing the single free-text `reason` (`types.ts:63-78`); LLM strictly non-authoritative.
- **Why:** Nothing consumes task intent today; the five scope states do not exist; the nearest analog is a flat label enum (`types.ts:48-53`) used only in reports (product-surface audit, confirmer-verified absence of commands and flags).
- **Acceptance:** Explicit task text produces atom-level required/supporting/candidate/uncertain/protected classification with evidence (plan:946); every extracted requirement retains a source reference (plan:947); `verify` is read-only.
- **Files:** new scope module in `packages/core/src`, `packages/core/src/types.ts`, `packages/core/src/config.ts`, `packages/cli/src/index.ts`.
- **Source:** plan week 4 (plan:926), plan:122-171; product-surface + config-oracle audits.

**P1-6. SQLite knowledge store, symbol graph, and tree-sitter parsers**
- **What:** New `packages/knowledge` (store/schema/indexer/retrieval per plan:519-547) implementing the plan's tables (plan:470-487); new `packages/parsers` with tree-sitter TS/JS/Python; file/symbol/import/reference/test edges; incremental blob-SHA indexing (plan:489-504); parse-failure fallback to symbol/hunk units with an explicit parse-failed flag.
- **Why:** Greenfield: no DB dependency exists anywhere; the `migration` package is an unrelated in-memory runner whose own test is not even in the vitest include globs (`vitest.config.ts:4-9`); `symbols.ts` is a dead regex scanner (all confirmer-verified). Note the plan's week-3 estimate (plan:925) should absorb the P0-4/P0-5 encoder/parser prerequisites.
- **Acceptance:** Changed symbols, imports/references and test relationships are queryable from SQLite (plan:948); parser failure falls back safely to hunk mode (plan:945); incremental re-index skips unchanged blobs by SHA.
- **Files:** new `packages/knowledge/*`, new `packages/parsers/*`, `packages/core/src/reducer.ts`.
- **Source:** plan week 3 (plan:925), plan:430-547; product-surface + diff-serializer audits.

**P1-7. `index` / `verify` / `explain` CLI commands**
- **What:** `patchdiet index` (build/update knowledge store), `patchdiet verify` (read-only scope analysis, plan:246-251), `patchdiet explain` (evidence retrieval, plan:252-255); wire them to P1-5/P1-6 outputs; `feedback` lands with P2-1.
- **Why:** The CLI registers exactly six commands and none of these exist (`packages/cli/src/index.ts:25,65,88,156,212,235`; confirmer-verified; no `--task` flag anywhere).
- **Acceptance:** Commands exist with docs; `verify` writes nothing outside `.patchdiet/` reports; `explain` output cites evidence records only.
- **Files:** `packages/cli/src/index.ts`, `packages/core/src` (new modules).
- **Source:** plan:239-280, week 4 (plan:926); product-surface audit.

**P1-8. Evidence Report and Scope Report rendering**
- **What:** Stable JSON schema plus Markdown Scope and Evidence Reports (plan:831-885) in `packages/report`, including the mandatory limitation line under every automatic removal (plan:879-885); consume P1-5 evidence records.
- **Why:** Reports today carry one free-text reason per candidate; `packages/report` renders Markdown/HTML/GitHub-comment/Diet Card only, with no evidence or check-run format (product-surface audit).
- **Acceptance:** Evidence Report renders the plan's sections (intent/graph/rules/test-mapping/history/counterfactual/final verification/limitation) from real run data; JSON schema versioned and stable across two runs on the same input.
- **Files:** `packages/report/src/index.ts`, `packages/core/src/types.ts`.
- **Source:** plan week 5 (plan:927), plan:831-885; product-surface audit.

### P2

**P2-1. Feedback memory and `patchdiet feedback`**
- **What:** Feedback data schema (week 5) then repository-local memory with minimum-support thresholds, decay, and ranking-only effect (plan:887-913); `feedback --run --atom --decision` command (plan:274-279).
- **Why:** No feedback command, tables, or event capture exists anywhere (product-surface audit).
- **Acceptance:** Feedback changes ranking only after repeated support; it can never bypass rules or final verification (plan:913); events persist locally.
- **Files:** new `packages/knowledge/src/memory/feedback.ts`, `packages/cli/src/index.ts`, `packages/core/src/config.ts`.
- **Source:** plan weeks 5 and 8 (plan:927, plan:930); product-surface audit.

**P2-2. GitHub App "Scope Gate" check-run flow**
- **What:** Wire the existing `createCheckRun` provider method (`packages/github-app/src/github-provider.mjs:71-135`, today called only from a test) into a real flow: check runs with annotations and up to three requested actions (Explain / Generate cleanup / Keep), execution on GitHub Actions or customer runners, minimal permissions.
- **Why:** The App is preview-only: HMAC intake, dedupe queue, JWT auth and comment upsert exist; no verify/shrink pipeline runs server-side and no check-run is created in any production flow (product-surface audit).
- **Acceptance:** A PR gets a "PatchDiet Scope Gate" check with annotations end to end; cleanup-branch creation requires explicit user action; no source leaves the runner (plan:984).
- **Files:** `packages/github-app/src/server.mjs`, `packages/github-app/src/github-provider.mjs`, `packages/action/index.mjs`.
- **Source:** plan weeks 7-8 (plan:929-930), plan:403-428; product-surface audit.

**P2-3. Enforce existing report toggles and give `commands.optional` its advisory role**
- **What:** Honor `report.html/markdown/github_comment` when writing artifacts (CLI currently writes all four unconditionally, `packages/cli/src/index.ts:143-149`; Action `packages/action/index.mjs:52-55`); run optional commands as non-gating signals recorded in the report.
- **Why:** Both fields are validated but consumed by nobody (two auditors, grep-verified) — v1 config is decorative in exactly the places the plan's v2 report block extends.
- **Acceptance:** Toggling a report field off removes that artifact; optional-command results appear in the report without ever gating removal.
- **Files:** `packages/cli/src/index.ts`, `packages/core/src/shrink.ts`, `packages/core/src/config.ts`.
- **Source:** config-oracle + product-surface audits ("discovered in this audit" relative to plan).

**P2-4. Targeted test selection (test-to-symbol mapping + coverage ingestion)**
- **What:** Static import-based test→symbol edges, optional LCOV/Istanbul/coverage.py ingestion, targeted-first planning behind `verification.targeted_first` — strictly as an optimization; the full required oracle always runs at the end (plan:235, plan:769-815).
- **Why:** No test discovery beyond the single required command exists; `TestCommandStatus` (`types.ts:80-85`) lacks INCONCLUSIVE; no coverage ingestion anywhere (product-surface audit).
- **Acceptance:** A mistaken test mapping can waste time but cannot make the final output falsely pass (plan:815); targeted runs measurably reduce oracle executions on the benchmark.
- **Files:** `packages/knowledge/src/code/tests.ts` (new), `packages/core/src/runner.ts`, `packages/core/src/shrink.ts`.
- **Source:** plan week 5 (plan:927); product-surface audit.

---

## 6. Not checked here

- **Market and competitor claims** (plan:15-19, 49-93, 1058): Stack Overflow 2025 survey figures, DORA 2026 analysis, Greptile/CodeRabbit/Qodo/Graphite feature and pricing claims, AgentDiff/C-Reduce/Picire/Perses characterizations, and the cited Claude Code/Codex issue contents. These were outside all four audit scopes.
- **Effort estimates** (plan:41, plan:921-931): the 65/91 person-day budgets and role allocations are unvalidated.
- **Release-gate targets** (plan:47, plan:105-114): ≥98% precision, ≥80% hit rate, ≥40% acceptance, 100% final-oracle pass are product targets — no benchmark exists yet to measure them against (the benchmark's three classes, plan:958-982, are unbuilt).
- **Full test suite / build:** `npm run test` and `npm run build` were not run in this session (see §1); the workflow attempt failed with a spawn error. Only `npm run typecheck` was executed here (passed).
- **Auditors' live experiments** were not re-run by me; I verified their cited code locations by reading them (all matched). The scratch-repo experiments (new-file crash, mode-only vanish, merge shadowing, worktree residue) are reported on the confirmer's authority.
- **Action bundle freshness** in a clean clone (`docs/remaining-tasks.md:83` flags this) and **npm publish status** (`README.md:76-85` says availability depends on maintainer publishing) were not checked.
- **`docs/remaining-tasks.md` external items** (npm release, GitHub Release/App hosting, Marketplace, VS Code publishing — its §2) were not verified.
