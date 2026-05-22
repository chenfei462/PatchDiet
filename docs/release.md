# Release Copy

## Show HN

Show HN: PatchDiet - shrink bloated AI-generated PRs into minimal patches

I built PatchDiet after seeing coding agents produce PRs that pass checks but still include unrelated files and scope creep. PatchDiet takes a git diff, removes unnecessary changes conservatively, and outputs a smaller cleanup patch plus a report explaining what was removed and why. It is local-first and does not upload your code.

## X / LinkedIn

Title:
Your AI agent passed the tests. PatchDiet still deleted 71% of the patch.

Body:
PatchDiet takes an already-generated PR, reverts candidate hunks in temporary worktrees, reruns your checks, and emits a smaller cleanup patch plus an auditable report. Local-first. No source upload. Not a PR review bot.

## Release checklist

1. Run `npm run smoke:release`.
2. Confirm the packaged CLI works from a fresh install and can run `patchdiet --help` plus one end-to-end `shrink`.
3. Publish the npm package with `npm publish --access public`.
4. Create the GitHub release notes and update the Action example if inputs changed.
5. Re-run the post-publish verification against the published package.

## Notes

- The primary onboarding command is `npx patchdiet shrink --base origin/main --head HEAD` for supported root JS repos.
- `patchdiet init` belongs in the main onboarding path as the way to make detected or explicit commands durable.
- The GitHub Action example omits `test` for supported root JS repos.
- Non-JS repos and monorepo-targeted checks still need explicit commands.
- The release smoke job is the same gate used in CI.
