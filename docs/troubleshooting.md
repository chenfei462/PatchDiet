# Troubleshooting

## Base / Head

- The base/head pair should point at the branches you want to compare.
- Run `patchdiet doctor` first.
- Make sure `base` points to the branch you want to compare against.
- If `HEAD` is wrong, re-run `patchdiet shrink --base <base> --head <head>`.

## Test Command

- Confirm the command works in the repo before giving it to PatchDiet.
- Use `npm run smoke:release` to verify a packaged install can run `patchdiet --help`.
- Use `npm test` or your project-specific command, not a placeholder.

## Permissions

- GitHub Action comment updates need `issues: write` and `pull-requests: write`.
- Fork PRs may degrade to preview-only behavior when write permissions are unavailable.
- The GitHub App preview also degrades cleanly when installation credentials are missing.

## Timeout

- Increase `--timeout-ms` if a valid test command is being killed too early.
- `patchdiet shrink` reports partial results when the global budget is exhausted.
- Use `patchdiet.yaml` to set `reduction.max_runtime_minutes` and `reduction.retry_flaky_tests`.

## Worktree

- Close any editor or shell session that is holding files open in the worktree.
- If cleanup fails, remove `.patchdiet` and re-run the command.
- On Windows, prefer short paths without extra quoting around the repo root.

## Windows Paths

- Keep paths simple and quoted when needed.
- Avoid mixing forward and backslashes in custom scripts.
- If a path contains spaces, verify the command in PowerShell before shipping it to CI.
