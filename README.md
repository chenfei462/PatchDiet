# PatchDiet

**Put your AI-generated PRs on a diet.**

PatchDiet is the cleanup layer after AI coding. Run it on a bloated agent PR and it tries to shrink the diff into a smaller, easier-to-review patch that still passes your local checks.

| Before PatchDiet | After PatchDiet |
| --- | --- |
| 4 files changed | 2 files changed |
| 4 hunks | 1 hunk |
| 14 changed lines | 10 changed lines |
| Tests pass, but review scope is inflated | Tests still pass, cleanup patch generated separately |

```bash
patchdiet shrink
```

PatchDiet is built for PRs produced by Claude Code, Codex, Cursor, OpenHands, Devin-like agents, and similar AI coding workflows. It does not replace your agent or reviewer; it sits between "the agent passed tests" and "a human has to review this patch."

## Safety Contract

- **No source upload:** repository contents stay on your machine or runner.
- **No LLM required:** decisions are made with git diffs and your test command.
- **Test-verified removals:** hunks are removed only when checks still pass after reverting them.
- **Local-first:** all shrink work happens in temporary local git worktrees.
- **No branch rewrite by default:** `patchdiet shrink` writes artifacts; it does not rewrite your current branch.
- **Cleanup patch generated separately:** inspect `.patchdiet/cleanup.diff` before applying it.

## Quickstart

From this repository:

```bash
npm ci
npm run build
node dist/packages/cli/src/index.js shrink
```

From another project after installing or linking PatchDiet:

```bash
patchdiet doctor
patchdiet check
patchdiet shrink
```

`patchdiet shrink` tries to detect:

- base ref from GitHub Actions PR context, `origin/main`, `origin/master`, then upstream merge-base
- head ref as `HEAD`
- test command from `pnpm test`, `npm test`, `yarn test`, `bun test`, `pytest`, `go test ./...`, or `cargo test`

If detection is not possible, pass the missing values explicitly:

```bash
patchdiet shrink --base origin/main --head HEAD --test "npm test"
```

Generated files:

- `.patchdiet/report.md`
- `.patchdiet/report.github.md`
- `.patchdiet/report.html`
- `.patchdiet/run.json`
- `.patchdiet/cleanup.diff`

`patchdiet check` prints a short human-readable diff summary by default. Use `patchdiet check --json` when another tool needs machine-readable stats.

## Installation Status

PatchDiet has npm package metadata and a trusted-publishing workflow, but package availability depends on maintainer publishing. Until you confirm the package exists on npm for the version you want, use the repository build path above or install from a local tarball:

```bash
npm ci
npm run build
npm pack
npm install -g ./patchdiet-*.tgz
```

After a real npm release is available:

```bash
npm exec -- patchdiet shrink
```

## GitHub Action

```yaml
name: PatchDiet PR

on:
  pull_request:

jobs:
  patchdiet:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: chenfei462/PatchDiet@v0.1.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: patchdiet-report
          path: .patchdiet/**
```

If the PR comes from a fork or the token lacks comment permission, PatchDiet still writes the step summary and artifacts instead of failing silently.

The Action uses a bundled entrypoint committed under `packages/action/dist/`; it should not install PatchDiet dependencies or build PatchDiet itself inside a user PR run.

## Commands

- `patchdiet init`
- `patchdiet doctor`
- `patchdiet check`
- `patchdiet check --json`
- `patchdiet shrink`
- `patchdiet shrink --json`
- `patchdiet shrink --base origin/main --head HEAD --test "pnpm test"`
- `patchdiet shrink --dry-run`
- `patchdiet shrink --timeout-ms 120000 --retry-flaky-tests 1`
- `patchdiet shrink --allow-test-file-removal`
- `patchdiet shrink --create-branch`
- `patchdiet shrink --apply`
- `patchdiet report --format markdown`
- `patchdiet report --format github`
- `patchdiet report --format html`
- `patchdiet report --format json`

## How It Works

1. Diff `base...head`.
2. Run your required test command on the current head to establish a passing baseline.
3. Try conservative file-level reverts in temporary worktrees.
4. For files that cannot be removed wholesale, try hunk-level reverts.
5. Keep only removals verified by the same test command.
6. Write reports explaining removed, kept, and needs-human-review candidates.

PatchDiet classifies candidates as `formatting-only`, `docs-only`, `dependency-related`, `generated-like`, or `unknown`. The classification helps humans review the report; tests still decide whether removal is allowed.

By default, changed test files are kept for human review. That is a deliberate safety choice: a smaller patch that deletes the agent's new test may still pass the remaining suite, but it can make review worse.

PatchDiet does not prove semantic equivalence. It proves only that the cleanup patch passes the configured local checks, then makes kept and needs-human-review items visible so reviewers know where judgment is still required.

## Reports

Markdown reports include:

- Summary
- Removed
- Kept
- Needs human review
- Artifacts
- Test command/status/duration

The GitHub comment is intentionally short and screenshot-friendly. The HTML report gives a larger before/after summary and categorized audit sections.

## Repo Layout

- `packages/core`: diff parsing, config, shrink engine
- `packages/report`: markdown/html/github renderers
- `packages/cli`: command line interface
- `packages/action`: GitHub Action wrapper
- `examples/*`: reproducible demo scenarios
- `docs/*`: usage, safety, algorithm, benchmark, and release notes

## Status

`v0.1.1` is still conservative. It focuses on local-first, no-upload, test-verified patch reduction for small and medium AI-generated PRs. It does not prove full semantic equivalence, and it does not use an LLM. AST-level atoms, richer dependency reasoning, and public benchmark datasets remain future work.
