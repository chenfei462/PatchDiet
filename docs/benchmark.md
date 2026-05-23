# Benchmark

PatchDiet is not claiming a universal "AI PR bloat" score yet. The current benchmark story is intentionally small, reproducible, and local.

## Current Fixtures

The repository ships three example scenarios:

- `examples/ts-bloated-pr`: TypeScript feature plus unrelated docs and unused file
- `examples/python-agent-refactor`: Python feature plus unrelated scratch file and docs
- `examples/monorepo-scope-creep`: package-scoped JavaScript change plus unrelated workspace files

Each fixture creates a git repository with a `main` base branch and an `agent/bloated` head branch. Tests assert that PatchDiet keeps the behavior-bearing patch, keeps changed test files for review by default, and removes unrelated candidates only when checks still pass.

## Metrics Reported

PatchDiet reports:

- files before/after
- hunks before/after
- changed lines before/after
- removed candidates
- kept candidates
- needs-human-review candidates
- test command and duration

## Local Benchmark Run

```bash
npm ci
npm run build
npm test -- tests/e2e/examples-smoke.test.ts
```

For a manual run:

```bash
node dist/packages/cli/src/index.js shrink --base main --head agent/bloated --test "node --test"
```

Run that command inside a materialized example repository or your own test fixture.

## Future Dataset Criteria

A public benchmark should include:

- real or realistic AI-generated PRs with clear task intent
- a passing baseline test command
- human-labeled unrelated changes
- dependency and generated-file cases
- failure cases where PatchDiet correctly keeps risky hunks
- runtime measurements on clean runners

Candidate datasets should follow [benchmark-schema.json](benchmark-schema.json).

Until that dataset exists, use the included examples as smoke tests rather than marketing-grade benchmark proof.
