# Security Policy

PatchDiet is designed to be local-first.

## Security Model

- PatchDiet does not upload repository source code.
- PatchDiet does not require an LLM or remote inference service.
- PatchDiet runs git operations and test commands in local temporary worktrees.
- PatchDiet writes cleanup artifacts under `.patchdiet/`.
- PatchDiet does not rewrite the current branch unless you explicitly pass an apply-oriented flag.

## Reporting a Vulnerability

Please report security issues through GitHub private vulnerability reporting if it is enabled for the repository. If that is unavailable, open a minimal public issue that does not include exploit details or private source code, and ask for a maintainer contact path.

Include:

- affected PatchDiet version or commit
- operating system and Node.js version
- command or workflow used
- impact summary
- reproduction steps using a minimal public fixture when possible

## Scope

Security issues include source disclosure, unsafe branch rewriting, command injection in PatchDiet-controlled command construction, and unsafe handling of GitHub tokens in the action.

PatchDiet executes user-provided test commands by design. Treat `--test` and repository scripts as trusted local commands.
