# Data Retention

## Local CLI

PatchDiet writes artifacts under `.patchdiet/` and does not upload them. Retention is controlled by the repository owner. The default `.gitignore` excludes `.patchdiet/`.

## GitHub Action

Artifacts are retained according to the repository's GitHub Actions artifact retention policy. The workflow should upload `.patchdiet/**` only when reviewers need audit evidence.

## GitHub App Preview

The local preview server keeps in-memory job state only for the process lifetime. Production deployments must document:

- job retention duration
- log retention duration
- whether raw diffs are stored
- how operators delete stored data

## Logs

PatchDiet stores command stdout/stderr summaries in JSON and reports. Full logs are not stored by the core engine unless the hosting workflow captures them.
