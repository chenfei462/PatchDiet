# Performance And Intelligence

PatchDiet currently evaluates cleanup candidates conservatively by reversing each file or hunk in a temporary worktree and running the configured checks. This is trustworthy, but it can be slow on large PRs and large test suites.

## Current Bottleneck

For each candidate:

1. create temporary worktree at `head`
2. reverse-apply candidate patch
3. run each required command
4. remove worktree

That means a PR with 40 candidate hunks can run the test command dozens of times.

## Implemented Configuration Surface

`patchdiet.yaml` now has explicit safety, intelligence, and performance sections:

```yaml
safety:
  mode: local
  allow_upload: false
intelligence:
  mode: local-only
performance:
  max_parallel_worktrees: 1
  cache_tests: false
```

CLI flags:

```bash
patchdiet shrink --intelligence local-only
patchdiet shrink --intelligence llm-assisted
patchdiet shrink --max-parallel-worktrees 4
```

`llm-assisted` is an opt-in policy surface for local readiness artifacts. It does not override test-verified cleanup decisions, and source upload remains disabled unless explicitly enabled by policy.

## Implemented Speedups

- `performance.max_parallel_worktrees` now caps a worker pool for independent candidate evaluation.
- Git worktree add/remove operations are serialized to avoid `.git/worktrees` metadata races.
- Candidate verification commands run concurrently inside already-created worktrees.
- Docs-only and generated-like files are attempted as a batch first; if the batch passes, PatchDiet avoids per-file checks for that group.
- If a docs/generated batch fails, PatchDiet bisects the batch and can still remove a safe subset.
- `performance.cache_tests: true` enables a persistent test-result cache in `.patchdiet/cache/test-results`, keyed by head ref, candidate patch, selected commands, and environment-sensitive inputs.
- Repeated candidates still receive an in-process memory hit during a single run, while later runs can reuse persisted `persistent cache hit` records.
- Symbol candidates are evaluated by shrink: TypeScript/JavaScript and Python function/class additions become symbol-level patch atoms before hunk fallback.
- Symbol cleanup remains test-verified. Public API, test-only, or budget-exhausted symbols are kept or marked for human review instead of being silently removed.

## Local Verification

```bash
npx vitest run tests/e2e/shrink-ts-example.test.ts
npm run pro:readiness
```

The e2e suite covers memory cache hits, persisted cache hits after clearing in-process state, and independent symbol evaluation when a mixed hunk contains both required and removable functions.

## Remaining Hosted Intelligence Work

1. Optional LLM ranking provider:
   - rank low-risk candidates before expensive test runs
   - identify dead debug code and abandoned scaffolding
   - never upload source unless `safety.allow_upload` is explicitly true
2. Hosted policy controls:
   - connect the local Pro readiness policy to account-level settings
   - audit every ranking request, upload decision, and reviewer-visible recommendation

## Trust Boundary

Default mode:

- no source upload
- no LLM call
- local git worktrees
- local required checks decide removals

Optional future LLM mode:

- must show what data is sent
- must support redaction/exclusion paths
- must produce suggestions, not silent branch rewrites
- must preserve a local-only mode as the default
