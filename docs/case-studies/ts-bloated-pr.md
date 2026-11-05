# Case Study: ts-bloated-pr

Status: reproducible local fixture

This case study uses the shipped TypeScript example repo and does not claim a public repository result.

## Context

- Repository: `examples/ts-bloated-pr`
- Base: `main`
- Head: `agent/bloated`
- Test command: `node --test`
- PatchDiet command: `patchdiet shrink --base main --head agent/bloated --test "node --test"`

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files | 4 | 2 |
| Hunks | 4 | 2 |
| Changed lines | 14 | 10 |
| Suggested deletion hunks | 2 | 2 |
| Estimated review-time saved | n/a | n/a |

## Notes

- Removes `README.md` and `src/unused.ts`.
- Keeps the behavior-bearing math change.
- Keeps the changed test file for human review.

## Reproduce

```bash
npm run bench:examples
cat .patchdiet/example-benchmarks/ts-bloated-pr/README.md
cat .patchdiet/example-benchmarks/ts-bloated-pr/report.md
```
