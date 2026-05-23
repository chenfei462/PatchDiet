# Safety

- PatchDiet is local-first.
- PatchDiet does not upload repository contents.
- PatchDiet does not require an LLM.
- PatchDiet does not rewrite the current branch in place.
- Cleanup artifacts are written under `.patchdiet/`.
- Reports distinguish removed, kept, and needs-human-review changes.
- PatchDiet is not a semantic-equivalence prover. It verifies the cleanup patch against configured local checks and leaves human-review evidence in the report.
- Removals are test-verified in temporary local worktrees.
- Cleanup patches are generated separately as `.patchdiet/cleanup.diff`.

## Boundary

PatchDiet does not prove full semantic correctness. It proves that a smaller patch still satisfies the configured checks in the current verification budget.
