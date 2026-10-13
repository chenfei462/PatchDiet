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

## PatchDiet Is / Is Not

- **Is:** a test-verified cleanup layer that shrinks AI-generated PRs before a human reviews them.
- **Is:** a browser preview (`/demo/`) that surfaces likely review noise before you run the CLI. Sample receipt: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.
- **Is not:** PatchDiet is not an AI reviewer. It never judges whether your feature logic is correct; your tests and reviewers still do.
- **Is not:** a semantic-equivalence proof. Removals are "verified" only in the sense that your configured checks still pass afterwards.

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

- `patchdiet init` / `patchdiet init --v2`
- `patchdiet doctor`
- `patchdiet check`
- `patchdiet check --json`
- `patchdiet index` (build the local semantic index; optional `--coverage` input)
- `patchdiet verify --base origin/main` (read-only Scope Map)
- `patchdiet explain --base origin/main` (changed-atom evidence)
- `patchdiet shrink`
- `patchdiet shrink --json`
- `patchdiet shrink --base origin/main --head HEAD --test "pnpm test"`
- `patchdiet shrink --task "one-line task description"` (advisory scope gate)
- `patchdiet shrink --dry-run`
- `patchdiet shrink --strategy ddmin --granularity ast` (v2 defaults)
- `patchdiet shrink --timeout-ms 120000 --retry-flaky-tests 1`
- `patchdiet shrink --allow-test-file-removal`
- `patchdiet shrink --create-branch`
- `patchdiet shrink --apply`
- `patchdiet report --format markdown`
- `patchdiet report --format github`
- `patchdiet report --format html`
- `patchdiet report --format json`
- `patchdiet card --format svg` (also `html`, `png`, `badge`)

For the complete `version: 2` `patchdiet.yaml` field audit — including fields the schema accepts that this runtime does not compute, and the documented limitations (no advisory semver-bump detector; dependency-manifest human review cannot be disabled) — see [`docs/cli-v02.md`](docs/cli-v02.md).

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
- `docs/*`: usage, safety, algorithm, benchmark, and release notes — see the
  [documentation index](docs/README.md) for the full map

## Status

Current CLI version is `0.2.0` (workspace sources; not yet published to npm). It keeps the v0.1 safety posture — local-first, no-upload, test-verified patch reduction, no semantic-equivalence proof, no LLM in the decision path — and adds the version 2 configuration surface: AST-granularity ddmin reduction with dependency grouping, the local SQLite knowledge index with targeted-first verification, the read-only `verify`/`explain` scope reports, and the bounded local coverage ingestion described in [`docs/cli-v02.md`](docs/cli-v02.md). The GitHub Action example above still points at the last published `v0.1.1` tag; a published Action tag for 0.2.0 does not exist yet.
