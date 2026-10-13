# Case Study: python-agent-refactor

Status: reproducible local fixture

This case study uses the shipped Python example repo and does not claim a public repository result.

## Context

- Repository: `examples/python-agent-refactor`
- Base: `main`
- Head: `agent/bloated`
- Test command: `python -m unittest discover -s tests -v`
- PatchDiet command: `patchdiet shrink --base main --head agent/bloated --test "python -m unittest discover -s tests -v"`

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files | 4 | 2 |
| Hunks | 4 | 2 |
| Changed lines | 13 | 9 |
| Suggested deletion hunks | 2 | 2 |
| Estimated review-time saved | n/a | n/a |

## Notes

- Removes the unrelated README and scratch file.
- Keeps the real Python code path.
- Keeps the changed test file for human review by default.

## Reproduce

```bash
npm run bench:examples
cat .patchdiet/example-benchmarks/python-agent-refactor/README.md
cat .patchdiet/example-benchmarks/python-agent-refactor/report.md
```
