# GitHub Action

PatchDiet can run on pull requests and publish a compact report back to the PR. It never uploads source code to a third-party service; it only uses the GitHub runner checkout and local git worktrees.

The Action entrypoint is bundled in this repository at `packages/action/dist/index.mjs`. A normal PR run should not install PatchDiet's own dependencies or build PatchDiet before it can start; your workflow still installs your project dependencies so the configured test command can run.

## Recommended Workflow

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
          path: |
            .patchdiet/report.md
            .patchdiet/report.github.md
            .patchdiet/report.html
            .patchdiet/run.json
            .patchdiet/cleanup.diff
```

## Inputs

- `base`: optional base ref. Defaults to GitHub PR base, `origin/main`, `origin/master`, then upstream merge-base.
- `head`: optional head ref. Defaults to `HEAD`.
- `test`: optional verification command. Defaults to detected package or language test command.
- `github-token`: optional token for posting or updating a PR comment.

Use explicit inputs when your workflow needs a custom test command:

```yaml
- uses: chenfei462/PatchDiet@v0.1.1
  with:
    base: origin/main
    head: HEAD
    test: pnpm test
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

For timeout, retry, and ignore-path defaults in the Action, commit a `patchdiet.yaml` file with `reduction.max_runtime_minutes`, `reduction.retry_flaky_tests`, and `scope.ignore_paths`.

## PR Comment Behavior

The action writes `.patchdiet/report.github.md` and appends it to the GitHub step summary. If `github-token` is provided, it tries to update an existing PatchDiet comment marked with `<!-- patchdiet-comment -->`; otherwise it creates a new one.

If the PR is from a fork or the token lacks `issues: write` or `pull-requests: write`, comment publishing safely degrades. The action logs the permission issue and leaves the report in the step summary and uploaded artifacts.

## Artifacts

The action generates:

- `.patchdiet/report.md`
- `.patchdiet/report.github.md`
- `.patchdiet/report.html`
- `.patchdiet/run.json`
- `.patchdiet/cleanup.diff`

Upload these artifacts so reviewers can inspect the cleanup patch even when comments are disabled by repository permissions.

## Outputs

The action writes these output paths when `GITHUB_OUTPUT` is available:

- `report-md`
- `report-github`
- `report-html`
- `run-json`
- `cleanup-diff`
