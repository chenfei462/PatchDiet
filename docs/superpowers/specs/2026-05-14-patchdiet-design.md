# PatchDiet Design

> Scope source: `C:\Users\CYL\Downloads\项目计划书.docx`

## Goal

Build `PatchDiet`, a local-first CLI and GitHub Action that shrinks AI-generated pull request diffs into a smaller, reviewable patch while preserving user-defined checks and generating an auditable report.

## Product Boundary

PatchDiet is:

- a patch minimizer for AI-generated diffs
- a local-first tool that does not upload source code
- a conservative reducer that uses checks as predicates
- a report generator for removal and retention evidence

PatchDiet is not:

- an AI coding agent
- a generic PR review bot
- a proof of full semantic equivalence
- a tool that rewrites the user's current branch by default

## v0.1 Deliverables

- Monorepo repository structure with `packages/cli`, `packages/core`, `packages/report`, `packages/action`
- CLI commands: `check`, `shrink`, `report`, `init`
- Hunk-level conservative reduction engine
- Temporary git worktree execution for isolated verification
- Cleanup patch generation and optional cleanup branch creation
- Markdown, HTML, JSON, and GitHub comment report outputs
- `patchdiet.yaml` sample config
- GitHub Action wrapper
- Three example scenarios:
  - `examples/ts-bloated-pr`
  - `examples/python-agent-refactor`
  - `examples/monorepo-scope-creep`
- Release-facing documentation and launch materials

## Architecture

### Core flow

1. Read config, CLI flags, and git state.
2. Resolve `base` and `head`.
3. Build unified diff and parse it into file and hunk atoms.
4. Establish baseline by running required checks on `head`.
5. Evaluate each hunk atom in isolation by reverting it in a temporary worktree and re-running required checks.
6. Mark each hunk as:
   - `removed`
   - `kept`
   - `needs-human-review`
7. Rebuild a patch from kept hunks against `base`.
8. Apply kept hunks to a fresh cleanup worktree.
9. Generate patch artifact, optional cleanup branch, and report artifacts.

### Package responsibilities

- `packages/core`
  - git command wrappers
  - diff parsing and statistics
  - hunk evaluation
  - cleanup patch construction
  - shrink engine orchestration
- `packages/report`
  - markdown output
  - HTML rendering
  - GitHub comment rendering
  - JSON serialization
- `packages/cli`
  - command-line interface
  - config loading and merge with flags
  - user-visible output and exit codes
- `packages/action`
  - GitHub Action entrypoint
  - PR comment publishing

## Reduction Strategy

`v0.1` uses conservative hunk-level reduction:

- Only remove hunks whose isolated revert keeps required checks green.
- If a hunk cannot be applied or verdict is ambiguous, classify it as `needs-human-review`.
- Reconstruct the cleanup patch from kept hunks instead of mutating the current branch.

This deliberately favors false negatives over unsafe removals.

## Safety Model

- Default behavior is analysis plus artifact generation only.
- Destructive outputs require explicit flags:
  - `--create-branch`
  - `--apply`
- The current user branch is never rewritten in place.
- Cleanup generation happens in a separate temporary worktree.
- Reports must clearly separate:
  - `high-confidence removal`
  - `needs-human-review`

## Reporting Model

Each run produces structured results with:

- input and output diff statistics
- removed hunk list with evidence type
- kept hunk list with reason or failing predicate
- generated artifact paths
- cleanup branch name when requested

## Example Strategy

Examples are fixed, reproducible scenarios rather than screenshots only.

- `ts-bloated-pr` is the canonical end-to-end verification case.
- `python-agent-refactor` demonstrates language-agnostic hunk reduction.
- `monorepo-scope-creep` demonstrates scope creep removal across packages and docs.

## Acceptance Targets

- `patchdiet --help` works
- `patchdiet check` returns diff statistics
- `patchdiet shrink` can reduce the TypeScript example by at least 50 percent in changed lines while tests remain green
- reports are generated in Markdown and HTML
- GitHub Action wrapper can publish a PR comment from generated results

## Deferred Beyond v0.1

- AST-level atoms
- cloud LLM integration
- semantic equivalence claims
- broad language-specific AST adapters
- benchmark dataset generation beyond scaffolding
