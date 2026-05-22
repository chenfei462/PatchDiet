# PatchDiet

PatchDiet shrinks AI-generated pull requests into the smallest reviewable patch that still passes your checks.

```bash
npx patchdiet shrink --base origin/main --head HEAD
```

![PatchDiet demo](docs/assets/patchdiet-demo.gif)

## Quickstart

### Supported JS repo, zero config

Start here for root JavaScript repos. If the repo has a root `package.json` with a `test` script and uses npm, pnpm, or yarn, PatchDiet can run without a config file:

```bash
npx patchdiet shrink --base origin/main --head HEAD
```

### What happens on the first run

- PatchDiet detects the root package manager and `test` script.
- It also uses root `lint` and `typecheck` scripts when they exist.
- It writes cleanup artifacts under `.patchdiet/`, including `cleanup.diff`, `report.html`, and `run.json`.
- It does not rewrite the current branch unless you pass `--apply` or `--create-branch`.

### Make the command explicit with `patchdiet init`

Use `patchdiet init` when you want the project contract in version control, when the repo has more than one target, or when the root `test` script is not the right verifier:

```bash
npx patchdiet init
```

`init` writes `patchdiet.yaml`. When root JS commands are detected, it pre-fills them; otherwise it leaves `commands.required` empty so you can add the command PatchDiet should trust.

Example:

```yaml
version: 1
base: origin/main
commands:
  required:
    - pnpm test
  optional:
    - pnpm lint
    - pnpm typecheck
```

PatchDiet resolves commands in this order:

1. explicit CLI flags or GitHub Action inputs
2. `patchdiet.yaml`
3. root `package.json` auto-detection

### JS repo with explicit overrides

Use this when you want to pin a different verifier or add lint/typecheck checks:

```bash
npx patchdiet shrink --base origin/main --head HEAD --test "pnpm test" --lint "pnpm lint" --typecheck "pnpm typecheck"
```

### Non-JS repo or monorepo target

PatchDiet will not guess workspace targets, package directories, or non-JS verification commands.

```bash
npx patchdiet shrink --base origin/main --head HEAD --test "python -m pytest"
npx patchdiet shrink --base origin/main --head HEAD --test "pnpm --filter app test"
```

## What it removes

- unrelated refactors
- formatting-only hunks
- stale comments
- dependency bumps outside scope
- files that do not affect the requested behavior

## When PatchDiet will not guess for you

- non-JS repositories
- monorepos that need package-targeted verification
- repositories without a root `test` script
- commands that require a specific workspace, filter, or package directory

### If zero-config detection fails

PatchDiet stops before shrinking and prints the next command to try. Pass `--test` directly for a one-off run, or run `patchdiet init` and edit `commands.required` before trying `shrink` again.

## Real repo case study

PatchDiet was validated against a local reproducible branch of the public `query-string` repository at commit `5ec53f9bc336de87e69427b95b1d389f406418e5`. This is the main zero-config JS path: the run used the root `package.json` test script without passing `--test`.

Example outcome:

- input: 5 files, 5 hunks
- output: 1 file, 1 hunk
- changed-line reduction: 86%
- removed: `readme.md`, `scratch.txt`, `test/patchdiet-validation.js`, `theme.js`
- kept: `base.js`

The full reproducible evidence, including the `pytest` explicit-command run and the `shelf.nu` monorepo targeted-command run, lives in `docs/evidence/real-repo-validation.md`.

## Synthetic demos

The small demos under `examples/` are still useful for fast smoke tests and explaining behavior:

- `ts-bloated-pr`
- `python-agent-refactor`
- `monorepo-scope-creep`

## GitHub Action

```yaml
- uses: patchdiet/action@v1
  with:
    base: origin/main
    lint: npm run lint
    typecheck: npm run typecheck

- uses: actions/upload-artifact@v4
  with:
    name: patchdiet-report
    path: |
      .patchdiet/cleanup.diff
      .patchdiet/report.html
      .patchdiet/run.json
```

If you omit `test`, the Action follows the same priority order as the CLI and can auto-detect supported root JS repos.

## Command summary

- `patchdiet init`
- `patchdiet check --base origin/main --head HEAD`
- `patchdiet shrink --base origin/main --head HEAD`
- `patchdiet report --format github`
- `patchdiet report --format json`

## Safety

- local-first by default
- no source upload
- does not rewrite the current branch in place
- produces cleanup artifacts under `.patchdiet/`
