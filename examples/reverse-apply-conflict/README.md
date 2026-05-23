# Reverse Apply Conflict

This scenario intentionally creates a binary file change. PatchDiet should not try to be clever when a candidate patch cannot be reverse-applied in a temporary worktree. It should mark the candidate as `needs-human-review`.
