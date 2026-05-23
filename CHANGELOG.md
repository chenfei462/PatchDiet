# Changelog

## Unreleased

- Reworked README first screen around "Put your AI-generated PRs on a diet."
- Added zero-config `patchdiet shrink` detection for base ref, head ref, and common test commands.
- Added `patchdiet doctor` for repository readiness checks.
- Expanded reports with Summary, Removed, Kept, Needs human review, Artifacts, and test status/duration.
- Added candidate classification: `formatting-only`, `docs-only`, `dependency-related`, `generated-like`, and `unknown`.
- Added conservative file-level revert attempts before hunk-level verification.
- Added `--dry-run`, per-command timeout support, flaky-test retries, ignore-path handling, and default protection for changed test files.
- Improved GitHub Action artifacts and PR comment update behavior with safe permission fallback.
- Added quickstart, GitHub Action, benchmark, examples, and security documentation.

## 0.1.1

- Prepared npm package metadata and trusted-publishing workflow.
- Updated GitHub Actions runtime versions.

## 0.1.0

- Initial conservative hunk-level PatchDiet proof of concept.
- Added CLI, core shrink engine, report renderers, GitHub Action wrapper, and example scenarios.
