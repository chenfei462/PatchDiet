# Security Model

PatchDiet defaults to local-first cleanup.

## Defaults

- Source upload: no.
- LLM calls: no.
- Current branch rewrite: no.
- Cleanup execution: temporary git worktrees plus user-provided verification commands.
- Artifacts: `.patchdiet/reduced.patch`, `.patchdiet/removal.patch`, `.patchdiet/candidates.json`, reports, and `run.json`.

## Trust Boundary

The CLI and Action execute in the user's checkout or GitHub runner. Test commands are trusted user commands. PatchDiet does not sandbox repository scripts.

Preview mode, including the web demo and GitHub App preview, uses diff heuristics only. It must never be described as verified cleanup.

Verified mode means PatchDiet ran the configured checks after candidate removal attempts. It is not a semantic-equivalence proof.

## Sensitive Data

Reports can contain paths, hunk headers, command names, and short stdout/stderr summaries. They should not contain full source files, but logs may include snippets emitted by the user's own test command.

## Vulnerabilities

Report vulnerabilities through GitHub private vulnerability reporting when available. Do not include private source code in public issues.
