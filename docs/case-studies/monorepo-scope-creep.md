# Case Study: monorepo-scope-creep

Status: reproducible local fixture

This case study uses the shipped monorepo example and does not claim a public repository result.

## Context

- Repository: `examples/monorepo-scope-creep`
- Base: `main`
- Head: `agent/bloated`
- Test command: `node --test packages/app/test/math.test.js`
- PatchDiet command: `patchdiet shrink --base main --head agent/bloated --test "node --test packages/app/test/math.test.js"`

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files | 4 | 2 |
| Hunks | 4 | 2 |
| Changed lines | 12 | 10 |
| Suggested deletion hunks | 2 | 2 |
| Estimated review-time saved | n/a | n/a |

## Notes

- Removes unrelated docs and scratch output.
- Preserves the package math implementation.
- Keeps the changed test file for human review.

## Reproduce

```bash
npm run bench:examples
cat .patchdiet/example-benchmarks/monorepo-scope-creep/README.md
cat .patchdiet/example-benchmarks/monorepo-scope-creep/report.md
```
