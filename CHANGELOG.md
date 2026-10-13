# Changelog

## 0.2.0

Version 2 configuration and the scope/evidence modules. All reduction is still verified by rerunning the user's own required checks locally; no precision or savings numbers are claimed beyond per-run receipts.

- Added the `version: 2` `patchdiet.yaml` surface: `intent`, `knowledge` (repo-local SQLite database, repo-local rule files), `verification`, and expanded `reduction`, `safety`, `report`, `scope`, and `performance` sections, validated with strict schemas that reject unknown fields. `patchdiet init --v2` writes a working template.
- Added `patchdiet index` to build the local semantic repository index (pinned `better-sqlite3` 12.9.0 store), optionally ingesting coverage from the bounded schemaVersion:1 per-test JSON, LCOV tracefiles, Istanbul JSON, or coverage.py JSON.
- Added `patchdiet verify` (read-only task-scope Scope Map from a diff) and `patchdiet explain` (evidence for changed atoms), both with `--json` output.
- Added `--strategy ddmin` and `--granularity ast` reduction: AST-granularity atoms and dependency grouping are integrated and default-on in v2 templates, with the hunk/conservative v1 path unchanged.
- Added targeted-first verification: when `verification.targeted_first` is on, tests are selected from the pinned index mapping. Every failure mode (missing, stale, or unreadable index; no mapping; unsupported runner) yields an explicitly unavailable plan and falls back to the full required suite. `full_required_at_end` is mandatory and cannot be disabled.
- Added report toggles (`report.evidence`, `report.json`, `report.github_check`) that the engine honors: disabled formats are never written and never named in the run summary. Enabled JSON file output is `.patchdiet/run.json` in both versions; the toggle controls whether the file is written, not its name.
- Added the advisory intent scope gate: `--task`/`--task-file` feed scope classification, and out-of-scope candidates are flagged for human review rather than silently kept or removed.
- Made the final artifact verification mandatory in every mode; `--no-final-verify` is rejected as a configuration error.
- Added `patchdiet card` to re-render the Diet Card (SVG/HTML/PNG/badge) from an existing run report.
- Known limitations (documented, not silently accepted): the advisory semver-bump detector is not implemented in this version, and `scope.flag_dependency_bumps` therefore has no separate detector to toggle — setting it to `false` records a diagnostic stating this, while the dependency-manifest human-review policy remains mandatory and unaffected. `knowledge.history.git`/`merged_prs` are accepted by the schema but no history evidence is computed by this runtime. Both cases surface as recorded run diagnostics. See `docs/cli-v02.md` for the complete accepted-field audit.
- Hardened the GitHub Action and release workflow: pinned `actions/*` to commit SHAs, added a Node `engines` floor, and added a `prepublishOnly` build/typecheck/test gate.
- Registered the `demo`, `bench:examples`, `pro:readiness`, and `github-app:dev` scripts so the documented entry points resolve.
- Made the VS Code extension self-contained at bundle time (no runtime import escaping the extension root), spawn-safe on Windows, and strict about `patchdiet.diffCommand` (whitelist instead of blacklist, no shell).

## 0.1.1

- Added zero-config `patchdiet shrink` detection for base ref, head ref, and common test commands.
- Added `patchdiet doctor` for repository readiness checks.
- Expanded reports with Summary, Removed, Kept, Needs human review, Artifacts, and test status/duration.
- Added candidate classification: `formatting-only`, `docs-only`, `dependency-related`, `generated-like`, and `unknown`.
- Added conservative file-level revert attempts before hunk-level verification.
- Added `--dry-run`, per-command timeout support, flaky-test retries, ignore-path handling, and default protection for changed test files.
- Improved GitHub Action artifacts and PR comment update behavior with safe permission fallback.
- Added quickstart, GitHub Action, benchmark, examples, and security documentation.
- Prepared npm package metadata and trusted-publishing workflow.
- Updated GitHub Actions runtime versions.

## 0.1.0

- Initial conservative hunk-level PatchDiet proof of concept.
- Added CLI, core shrink engine, report renderers, GitHub Action wrapper, and example scenarios.
