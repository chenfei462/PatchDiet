# Case Study Template

Use this template for real or reproducible PatchDiet before/after stories. Do not imply that PatchDiet ran on a public project unless the run is reproducible and the repository/version are named.

## Label

Status: `sample`, `reproducible`, or `real-world with permission`

## Headline

`<before changed lines>` changed lines became `<after changed lines>` after verified cleanup. Use real run data only; do not invent evidence.

## Context

- Repository:
- Commit/base:
- PR/branch:
- Test command:
- PatchDiet version:
- Machine/runner:

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files |  |  |
| Hunks |  |  |
| Changed lines |  |  |
| Suggested deletion hunks |  |  |
| Estimated review-time saved |  |  |

## What PatchDiet Removed

- 

## What PatchDiet Kept

- 

## Human Review Notes

- Did the cleanup patch match the intent?
- Any false positives?
- Any slow tests or flaky checks?

## Reproduction

```bash
git clone <repo>
cd <repo>
patchdiet shrink --base <base> --head <head> --test "<command>"
patchdiet card --project "<name>" --format svg
patchdiet card --project "<name>" --format png
```

## Screenshot Checklist

- README/landing first viewport
- CLI output showing before/after
- `.patchdiet/report.html`
- Diet Card
- PR comment
