# Safety

- PatchDiet is local-first.
- PatchDiet does not upload repository contents.
- PatchDiet does not rewrite the current branch in place.
- Cleanup artifacts are written under `.patchdiet/`.
- Reports distinguish removals from kept changes.

## Boundary

PatchDiet does not prove full semantic correctness. It proves that a smaller patch still satisfies the configured checks in the current verification budget.
