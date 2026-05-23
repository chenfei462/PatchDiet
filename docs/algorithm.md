# Algorithm

PatchDiet uses conservative, test-verified reduction:

1. collect diff between base and head
2. parse diff into file and hunk units
3. run required checks on head to establish the baseline
4. classify candidates as `formatting-only`, `docs-only`, `dependency-related`, `generated-like`, or `unknown`
5. keep ignored paths, binary diffs, and changed test files by default for human review
6. for each remaining changed file, create a temporary git worktree at `head` and try to reverse-apply the whole file patch
7. if the file-level revert passes checks, mark all file hunks as removed
8. if the file-level revert fails checks, evaluate each hunk in a temporary worktree
9. mark each candidate as `removed`, `kept`, or `needs-human-review` from the verification result
10. rebuild a cleanup patch from the kept hunks and write Markdown, HTML, JSON, GitHub, and diff artifacts

`patchdiet check` reports candidate counts with a small heuristic list of obviously unrelated demo paths. The actual shrink decision is driven by local verification, not by that heuristic or candidate classification.

`patchdiet check` is human-readable by default and supports `--json` for automation. `patchdiet shrink --json` emits the full `ShrinkReport` while still writing normal artifacts unless `--dry-run` is used.

PatchDiet does not claim full semantic equivalence. It proves that the smaller patch still satisfies the configured local checks in the current verification budget.
