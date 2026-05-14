# Algorithm

PatchDiet v0.1 uses conservative hunk-level reduction:

1. collect diff between base and head
2. parse diff into file and hunk units
3. run required checks on head to establish the baseline
4. for each hunk, create a temporary git worktree at `head` and reverse-apply only that hunk
5. rerun the required checks in the temporary worktree
6. mark the hunk as `removed`, `kept`, or `needs-human-review` from the verification result
7. rebuild a cleanup patch from the kept hunks and write Markdown, HTML, JSON, and GitHub report artifacts

`patchdiet check` currently reports candidate counts with a small heuristic list of obviously unrelated demo paths. The actual shrink decision is driven by per-hunk verification, not by that heuristic.

This is an intentionally narrow implementation of the plan. It proves the workflow and repository structure without claiming full semantic equivalence.
