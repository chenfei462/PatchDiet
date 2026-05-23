# PatchDiet Growth Roadmap

PatchDiet should move from a v0.1 technical proof toward a tool that is easier to understand, install, run, review, and share.

## Product Positioning

PatchDiet is the PR cleanup layer after AI coding. Claude Code, Codex, Cursor, OpenHands, Devin-like agents, and similar tools can generate patches that pass tests but are too broad for comfortable review. PatchDiet shrinks those patches into smaller cleanup diffs while preserving the local verification contract.

Core message:

> Put your AI-generated PRs on a diet.

## Non-Negotiables

- local-first
- no source upload
- no LLM required
- test-verified removals
- no branch rewrite by default
- cleanup patch generated separately

## Productization Priorities

- README first screen explains the value in 30 seconds.
- `patchdiet shrink` works with minimal flags.
- `patchdiet doctor` tells users what is missing.
- GitHub Action produces useful PR comments, reports, and artifacts.
- Reports explain why hunks were removed, kept, or flagged for human review.
- Documentation covers quickstart, GitHub Actions, examples, benchmark framing, safety, and release status.

## Conservative Algorithm Direction

- Try file-level revert before hunk-level revert.
- Classify candidates for human review.
- Record test duration.
- Avoid LLMs and remote source uploads.
- Prefer slow, auditable correctness over aggressive minimization.

## Open Growth Work

- Publish and verify npm package availability.
- Add richer dependency reasoning.
- Add AST-level atoms for TypeScript and Python.
- Build a public benchmark dataset.
- Explore GitHub App distribution after the Action flow is stable.
