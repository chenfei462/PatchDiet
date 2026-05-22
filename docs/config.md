# Config

Example `patchdiet.yaml`:

```yaml
version: 1
base: origin/main
commands:
  required:
    - pnpm test
  optional:
    - pnpm lint
    - pnpm typecheck
reduction:
  strategy: conservative
  atom_granularity: hunk
  max_runtime_minutes: 20
  retry_flaky_tests: 2
scope:
  ignore_paths:
    - dist/**
    - "**/*.lock"
  allow_format_only_removal: true
  flag_dependency_bumps: true
report:
  html: true
  markdown: true
  github_comment: true
```

Generated run artifacts are written to `.patchdiet/`, including:

- `run.json`
- `report.md`
- `report.html`
- `report.github.md`

The CLI can re-render a stored run with `patchdiet report --format markdown|html|github|json`.

`commands.required` must pass before and after a candidate revert. `commands.optional` also participate when they pass at baseline; if a green optional check fails after a revert, PatchDiet keeps that hunk and records the check as evidence.

Command resolution priority is:

1. explicit CLI flags or GitHub Action inputs
2. `patchdiet.yaml`
3. root `package.json` auto-detection

Supported zero-config auto-detection is limited to root JS repos that use `npm`, `pnpm`, or `yarn` and define a root `package.json` `test` script. PatchDiet only adds `lint` and `typecheck` when those scripts already exist in the root `package.json`.

## When PatchDiet will not guess for you

- non-JS repositories
- monorepos that need package-targeted verification
- repositories without a root `test` script
- commands that need a workspace filter, package directory, or explicit target

Use `--test` for a one-off run, or run `patchdiet init` and edit `commands.required` for those cases. If PatchDiet cannot resolve a required command, it stops before shrinking and prints the next command to try.
