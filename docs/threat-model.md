# Threat Model

## Covered Threats

- Malicious PR changes test commands to exfiltrate secrets.
- Fork PRs try to access runner secrets.
- Patch paths attempt traversal or symlink writes.
- Binary, submodule, rename, delete, or mode-change diffs are unsafe to rewrite automatically.
- Webhook replay sends duplicate GitHub App events.
- Installation tokens leak through logs.
- Runner workspaces retain source or artifacts longer than intended.
- Report HTML includes untrusted diff text.
- Future LLM-assisted mode receives prompt-injection content from diffs.

## Current Controls

- Fork or permission failures degrade to step summary and artifacts.
- Binary, rename, and delete diffs are marked `needs-human-review` or blocked risk instead of silently applying.
- Reports escape HTML.
- GitHub App webhooks verify `x-hub-signature-256` when a secret is configured.
- GitHub App preview jobs deduplicate webhook delivery ids.
- Default mode does not call LLMs or upload source.

## Operator Responsibilities

- Use `actions/checkout` with `fetch-depth: 0` for accurate base diffs.
- Do not expose secrets to untrusted fork PR test commands.
- Review `removal.patch` before applying it to a branch.
- Keep `.patchdiet/` ignored unless artifacts are intentionally committed for fixtures.
