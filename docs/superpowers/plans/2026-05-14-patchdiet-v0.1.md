# PatchDiet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working `PatchDiet` v0.1 repository in a new git repo with a CLI, conservative shrink engine, reports, GitHub Action, examples, and release documentation derived from the project plan.

**Architecture:** Use a TypeScript monorepo layout with a local-first shrink engine in `packages/core`, a rendering layer in `packages/report`, a CLI in `packages/cli`, and a lightweight JavaScript GitHub Action wrapper in `packages/action`. The canonical end-to-end verification target is the TypeScript example repo with a reproducible bloated branch that PatchDiet can shrink safely.

**Tech Stack:** Node.js, TypeScript, Vitest, Commander, YAML, Git CLI, GitHub Actions toolkit.

---

### Task 1: Workspace And Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `packages/cli/package.json`
- Create: `packages/core/package.json`
- Create: `packages/report/package.json`
- Create: `packages/action/package.json`

- [x] Define root workspace metadata and scripts.
- [x] Add TypeScript and test tooling dependencies.
- [x] Add workspace package manifests.
- [x] Add ignore rules for build output, temp output, and generated reports.

### Task 2: TDD For Diff Parsing And Statistics

**Files:**
- Create: `tests/unit/diff.test.ts`
- Create: `packages/core/src/diff.ts`
- Create: `packages/core/src/types.ts`

- [x] Write failing tests for unified diff parsing, file counts, line counts, and hunk counts.
- [x] Run the targeted unit tests and verify failure.
- [x] Implement minimal diff parsing and statistics code.
- [x] Re-run targeted tests and verify pass.

### Task 3: TDD For Report Rendering

**Files:**
- Create: `tests/unit/report.test.ts`
- Create: `packages/report/src/index.ts`

- [x] Write failing tests for Markdown, HTML, and GitHub comment rendering.
- [x] Run the targeted report tests and verify failure.
- [x] Implement minimal renderers.
- [x] Re-run targeted tests and verify pass.

### Task 4: TDD For Config Loading

**Files:**
- Create: `tests/unit/config.test.ts`
- Create: `packages/core/src/config.ts`

- [x] Write failing tests for default config, YAML parsing, and flag override merging.
- [x] Run config tests and verify failure.
- [x] Implement config loading.
- [x] Re-run config tests and verify pass.

### Task 5: TDD For Example Scenario Bootstrap

**Files:**
- Create: `tests/e2e/example-bootstrap.test.ts`
- Create: `examples/ts-bloated-pr/README.md`
- Create: `examples/ts-bloated-pr/scenario.json`
- Create: `examples/python-agent-refactor/README.md`
- Create: `examples/python-agent-refactor/scenario.json`
- Create: `examples/monorepo-scope-creep/README.md`
- Create: `examples/monorepo-scope-creep/scenario.json`
- Create: `tests/e2e/helpers/create-example-repo.ts`

- [x] Write failing bootstrap tests that create a temp git repo from the TypeScript scenario.
- [x] Run the bootstrap test and verify failure.
- [x] Implement example bootstrap helper and scenario fixtures.
- [x] Re-run bootstrap tests and verify pass.

### Task 6: TDD For Shrink Engine

**Files:**
- Create: `tests/e2e/shrink-ts-example.test.ts`
- Create: `packages/core/src/git.ts`
- Create: `packages/core/src/shrink.ts`
- Create: `packages/core/src/runner.ts`
- Create: `packages/core/src/index.ts`

- [x] Write failing end-to-end shrink tests against the TypeScript example.
- [x] Run the shrink test and verify failure.
- [x] Implement baseline verification, per-hunk evaluation, cleanup patch assembly, and cleanup worktree generation.
- [x] Re-run the shrink test and verify pass.

### Task 7: TDD For CLI Commands

**Files:**
- Create: `tests/e2e/cli.test.ts`
- Create: `packages/cli/src/index.ts`

- [x] Write failing tests for `init`, `check`, `shrink`, and `report`.
- [x] Run CLI tests and verify failure.
- [x] Implement the CLI with explicit safe flags for branch creation and apply.
- [x] Re-run CLI tests and verify pass.

### Task 8: GitHub Action Wrapper

**Files:**
- Create: `action.yml`
- Create: `packages/action/index.mjs`

- [x] Implement an action entrypoint that runs PatchDiet and posts a PR comment when token and context are available.
- [x] Add a local fallback path when comment publishing is unavailable.

### Task 9: Docs And Launch Materials

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `LICENSE`
- Create: `docs/algorithm.md`
- Create: `docs/safety.md`
- Create: `docs/config.md`
- Create: `docs/release.md`
- Create: `docs/roadmap.md`
- Create: `docs/issues.md`

- [x] Write README with before/after first screen and "not a PR review bot" boundary.
- [x] Document algorithm, safety model, config, launch copy, roadmap, and initial issues.
- [x] Add license and contribution instructions.

### Task 10: Verification And Completion Audit

**Files:**
- Modify: `docs/superpowers/plans/2026-05-14-patchdiet-v0.1.md`

- [x] Run `npm install`.
- [x] Run unit tests.
- [x] Run end-to-end tests.
- [x] Run the CLI help command.
- [x] Run the TypeScript example shrink flow and capture evidence.
- [x] Audit every explicit requirement from the source project plan against repository artifacts and command output.

## Completion Audit

Date: `2026-05-14`

### Fresh Verification Commands

- `npm install`
- `npm run build`
- `npm run typecheck`
- `npm test`
- `node dist/packages/cli/src/index.js --help`
- Materialize a fresh temp repo from `examples/ts-bloated-pr` via `dist/tests/e2e/helpers/create-example-repo.js`
- `PATCHDIET_TARGET_CWD=<temp-repo> node dist/packages/cli/src/index.js check --base main --head agent/bloated`
- `PATCHDIET_TARGET_CWD=<temp-repo> node dist/packages/cli/src/index.js shrink --base main --head agent/bloated --test "node --test"`
- `PATCHDIET_TARGET_CWD=<temp-repo> node dist/packages/cli/src/index.js report --format github`
- `PATCHDIET_TARGET_CWD=<temp-repo> node dist/packages/cli/src/index.js report --format json`

### Verification Results

- `npm install` completed successfully.
- `npm run build` completed successfully.
- `npm run typecheck` completed successfully.
- `npm test` completed successfully with `10` passing test files and `24` passing tests.
- CLI help printed `init`, `check`, `shrink`, and `report`.
- The bundled TypeScript example reported `4` files, `14` changed lines, `4` hunks, and `2` heuristic candidates before shrinking.
- The bundled TypeScript example shrank to `1` file, `4` changed lines, `1` hunk after shrinking.
- The generated GitHub report showed `3` high-confidence removals and `1` kept hunk.
- The stored run artifact was re-rendered successfully as JSON via `report --format json`.
- The bundled demo exceeded the project-plan reduction bar: `14 -> 4` changed lines, about `71%` reduction.
- Installability was verified by the pack-install-execute flow in `tests/e2e/installable.test.ts`.
- GitHub Action behavior was verified by `tests/e2e/action.test.ts`.

### Requirement Audit Against `项目计划书.docx`

- Independent new repository: satisfied in `C:\Users\CYL\Documents\PatchDiet`.
- Local-first CLI: satisfied by `packages/cli`, `README.md`, and `docs/safety.md`.
- Commands `init`, `check`, `shrink`, `report`: satisfied and freshly verified.
- `patchdiet.yaml` support: satisfied by `init` plus `packages/core/src/config.ts`.
- Conservative shrink engine with proof-oriented reporting: satisfied by `packages/core/src/shrink.ts` and `packages/report/src/index.ts`.
- Markdown, HTML, JSON, and GitHub comment reports: satisfied by generated `.patchdiet` artifacts and report renderer tests.
- GitHub Action wrapper with PR comment path: satisfied by `action.yml`, `packages/action/index.mjs`, and `tests/e2e/action.test.ts`.
- Three reproducible demos: satisfied by `examples/ts-bloated-pr`, `examples/python-agent-refactor`, and `examples/monorepo-scope-creep`, with e2e coverage.
- README, CONTRIBUTING, LICENSE, release copy, roadmap, and initial issues: satisfied by repository docs.
- "Not a PR review bot" boundary: satisfied in `README.md` and the design spec.
- Safety boundary of not rewriting the current branch by default: satisfied in CLI flags and `docs/safety.md`.
