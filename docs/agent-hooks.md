# Agent Post-Commit Hooks

PatchDiet should run right after an AI coding agent creates a commit, while the diff is still fresh and before a reviewer sees the PR.

## Generic Git Hook

Install:

```bash
mkdir -p .git/hooks
cp scripts/hooks/patchdiet-post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Default behavior:

- checks whether `patchdiet` is available
- runs `patchdiet check`
- prints a short summary
- does not rewrite the commit

To run shrink automatically:

```bash
PATCHDIET_HOOK_MODE=shrink PATCHDIET_TEST_COMMAND="npm test" git commit
```

## Claude Code

Use PatchDiet as a post-commit command in your project bootstrap notes:

```bash
PATCHDIET_HOOK_MODE=check .git/hooks/post-commit
```

Recommended workflow:

1. Claude Code finishes a task and commits.
2. Hook runs `patchdiet check`.
3. If the PR is noisy, run `patchdiet shrink --test "npm test"`.
4. Review `.patchdiet/reduced.patch`, `.patchdiet/removal.patch`, and `.patchdiet/candidates.json` before applying.

## Cursor

Add a workspace task that calls:

```bash
patchdiet check && patchdiet shrink --dry-run --test "npm test"
```

Run it after agent edits and before opening a PR.

## Aider

Use Aider's git workflow and run:

```bash
PATCHDIET_HOOK_MODE=shrink PATCHDIET_TEST_COMMAND="npm test" .git/hooks/post-commit
```

PatchDiet writes artifacts without rewriting the branch by default.

## OpenHands

Add PatchDiet to the repository setup script:

```bash
node dist/packages/cli/src/index.js check
node dist/packages/cli/src/index.js shrink --dry-run --test "npm test"
```

Use `npm exec -- patchdiet ...` here only after npm publishing is externally
verified with `npm view patchdiet version` and `npm exec -- patchdiet --help`
in a clean project.

For trusted internal runners, switch from `--dry-run` to artifact-producing mode and upload `.patchdiet/**`.

## Safety

Hooks must not apply cleanup patches automatically unless the repository owner explicitly opts in with `PATCHDIET_APPLY=1`. If enabled, hooks must apply `.patchdiet/removal.patch` only to the current PR head checkout; cleanup branches should be created with `patchdiet shrink --create-branch`.
