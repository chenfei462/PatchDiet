# Quickstart

PatchDiet shrinks an already-generated PR. Use it after Claude Code, Codex, Cursor, OpenHands, Devin-like agents, or another coding agent has produced a branch that passes tests but feels too large to review.

## From This Repository

```bash
npm ci
npm run build
node dist/packages/cli/src/index.js doctor
node dist/packages/cli/src/index.js shrink
```

`doctor` checks git, repository state, base/head detection, test-command detection, worktree status, and whether `.patchdiet/` is writable.

## From Another Repository

Until you confirm the npm package is published for the version you want, install from a local tarball:

```bash
git clone https://github.com/chenfei462/PatchDiet.git
cd PatchDiet
npm ci
npm run build
npm pack
npm install -g ./patchdiet-*.tgz
```

Then run:

```bash
patchdiet doctor
patchdiet check
patchdiet shrink
```

## Zero-Config Detection

When flags are omitted, `patchdiet shrink` tries:

- base: GitHub Actions PR base, `origin/main`, `origin/master`, then upstream merge-base
- head: `HEAD`
- test: `pnpm test`, `npm test`, `yarn test`, `bun test`, `pytest`, `go test ./...`, or `cargo test`

If detection fails, pass explicit values:

```bash
patchdiet shrink --base origin/main --head HEAD --test "npm test"
```

## Outputs

PatchDiet writes artifacts under `.patchdiet/`:

- `cleanup.diff`: the cleanup patch to inspect or apply
- `report.md`: full Markdown report
- `report.github.md`: compact PR comment body
- `report.html`: browser-friendly report
- `run.json`: machine-readable report

`patchdiet check` prints a short summary with detected base/head refs, file count, hunk count, changed lines, and candidate path count. For automation, use `patchdiet check --json`.

By default, PatchDiet does not rewrite your current branch. Use `--create-branch` to create a cleanup branch in a separate worktree, or `--apply` only when you are ready to apply the generated cleanup patch to the current checkout.

To preview a run without writing artifacts:

```bash
patchdiet shrink --dry-run
```

To tune verification for slow or flaky suites:

```bash
patchdiet shrink --timeout-ms 120000 --retry-flaky-tests 1
```

To pipe the full shrink result into another tool:

```bash
patchdiet shrink --json
```
