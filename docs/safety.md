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

## Trust boundary: required commands run as you

PatchDiet runs the commands configured in `patchdiet.yaml` (`commands.required`,
`commands.optional`) and the `--test` flag to establish a baseline and to verify each
candidate removal. **Those commands execute as ordinary processes with your user's
permissions.** PatchDiet does not sandbox them.

That matters when the repository under test is not fully trusted:

- A pull request can edit `patchdiet.yaml` or `package.json` and therefore choose which
  command runs. If you run PatchDiet against a fork's checkout, you are running that fork's
  chosen command.
- The bundled GitHub Action runs with the workflow's permissions. It uses
  `pull_request` with a read-only token, which limits the blast radius, but the command
  still executes on the runner.
- Never reuse the Action under `pull_request_target` with a write token: that combination
  turns a fork's test command into a secret-exfiltration path.

Practical guidance:

1. Treat a run against an untrusted checkout the same way you would treat running
   `npm test` in that checkout yourself — because that is what it does.
2. Review `patchdiet.yaml` changes in a pull request the same way you review changes to CI
   configuration.
3. Prefer a disposable runner or container for runs against forks.
4. Long term, restrict `commands.required` to a vetted allowlist for your repository.

This is a documented boundary, not a sandbox. PatchDiet's git interaction itself uses
`execFile` with argument arrays and no shell, so the diff-reading path is not injectable;
the exposure is the test commands you configure.
