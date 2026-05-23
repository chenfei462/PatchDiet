# Examples

PatchDiet examples are small git scenarios that model common AI coding cleanup cases.

## TypeScript Bloated PR

Path: `examples/ts-bloated-pr`

The agent adds a real `multiply` function and test, but also adds an unrelated README update and unused source file. PatchDiet should keep the feature-bearing hunk and changed test file, then remove unrelated candidates after `node --test` still passes.

## Python Agent Refactor

Path: `examples/python-agent-refactor`

The agent adds a real Python function and test, plus scratch notes and docs changes. PatchDiet verifies with `python -m unittest discover -s tests -v`.

## Monorepo Scope Creep

Path: `examples/monorepo-scope-creep`

The agent changes a package under `packages/app` while also touching unrelated docs and playground files. PatchDiet verifies with a package-targeted Node test command.

## Reverse Apply Conflict

Path: `examples/reverse-apply-conflict`

The agent changes a binary-like file. PatchDiet treats binary diffs as `needs-human-review` instead of trying to rewrite them into a text cleanup patch.

## What To Look For

Each run should produce:

- a smaller `.patchdiet/cleanup.diff`
- a Markdown report explaining removed and kept candidates
- a GitHub-ready comment report
- an HTML report with before/after summary
- a JSON report for automation

The examples are intentionally conservative. They show the workflow, not every future algorithmic capability.
