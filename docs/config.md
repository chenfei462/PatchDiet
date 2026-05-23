# Config

Example `patchdiet.yaml`:

```yaml
version: 1
base: origin/main
commands:
  required:
    - node --test
  optional: []
reduction:
  strategy: conservative
  atom_granularity: hunk
  max_runtime_minutes: 20
  retry_flaky_tests: 2
scope:
  ignore_paths: []
report:
  html: true
  markdown: true
  github_comment: true
```

Generated run artifacts are written to `.patchdiet/`, including:

- `run.json`
- `report.md`
- `report.github.md`
- `report.html`
- `cleanup.diff`

The CLI can re-render a stored run with `patchdiet report --format markdown|html|github|json`.

`patchdiet shrink` can run without flags when PatchDiet can detect a base ref and test command. It tries GitHub Actions PR context, `origin/main`, `origin/master`, and upstream merge-base for the base ref. It detects common test commands from Node, Python, Go, and Rust project files.

`patchdiet check` uses the same base/head detection and prints a human-readable summary by default. Use `patchdiet check --json` for machine-readable diff stats. Use `patchdiet shrink --json` for the full shrink report without losing the generated `.patchdiet/` artifacts.

Useful flags:

- `--dry-run`: verify and print a summary without writing `.patchdiet/` artifacts
- `--timeout-ms <ms>`: override the per-command timeout
- `--retry-flaky-tests <count>`: retry failed required checks before giving up
- `--allow-test-file-removal`: allow changed test files to be removed when checks still pass

`scope.ignore_paths` supports exact paths, `*`, and trailing `/**` directory patterns. Ignored paths are kept in the cleanup patch and reported as kept.
