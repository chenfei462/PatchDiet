# Case Study: octocat/Hello-World PR #6

Status: reproducible public PR preview

This case study uses a public GitHub pull request diff. It is intentionally small and does not claim that PatchDiet ran the repository test suite. It proves the PR URL fetch and case-study workflow, not a dramatic shrink result.

PR: https://github.com/octocat/Hello-World/pull/6
Repository: `octocat/Hello-World`
PatchDiet mode: Web demo preview / diff analysis
Test command: not applicable; repository has no configured automated test command for this sample

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files | 1 | 1 |
| Hunks | 1 | 1 |
| Changed lines | 2 | 2 |
| Suggested deletion hunks | 0 | 0 |
| Estimated review-time saved | 0% | 0% |

## Reproduce

```bash
npm ci
npm run build
npm run demo
# Open http://127.0.0.1:4173/demo/ and paste:
# https://github.com/octocat/Hello-World/pull/6
```

Or inspect the saved diff:

```bash
cat docs/case-studies/octocat-hello-world-pr-6.diff
```

## Notes

- The PR changes only a trailing newline in README.
- PatchDiet preview should not invent removals here.
- This is useful as a public smoke case for PR URL fetching and honest labeling.
