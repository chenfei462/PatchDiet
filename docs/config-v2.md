# Config v2 (`patchdiet.yaml` version 2)

Config v2 implements the configuration surface of the AI change scope verification plan
(`docs/superpowers/plans/2026-10-03-ai-change-scope-verification-plan.md`, lines 287–349).
It is parsed and fully resolved by `loadPatchDietConfig` in `packages/core/src/config.ts`.

## Versioning

- `version` may only be `1` or `2`. Future versions, `0`, negative values and non-integers
  are rejected with `Invalid patchdiet.yaml`.
- A file without a `version` key is treated as v1 (backward compatible).
- v1 semantics are unchanged: `createPresetConfig()` still returns a v1 config with
  `conservative` / `hunk` defaults, and v1 files load exactly as before.
- v2 defaults differ per the plan: `reduction.strategy: ddmin`, `reduction.atom_granularity: ast`.

## Complete v2 example

```yaml
version: 2
base: origin/main

commands:
  required:
    - pnpm test
    - pnpm typecheck
  optional:
    - pnpm lint

intent:
  sources:
    - cli
    - github_pr
    - linked_issue
    - commits
  llm: auto

knowledge:
  database: .patchdiet/knowledge.sqlite
  languages:
    - typescript
    - javascript
    - python

  rules:
    auto_discover:
      - AGENTS.md
      - CLAUDE.md
      - GEMINI.md
      - .github/copilot-instructions.md
      - CONTRIBUTING.md

  history:
    git: true
    merged_prs: false

reduction:
  strategy: ddmin
  atom_granularity: ast
  dependency_grouping: true
  final_verification: true
  retry_flaky_tests: 2
  max_runtime_minutes: 20

verification:
  targeted_first: true
  full_required_at_end: true

safety:
  protect:
    - "**/migrations/**"
    - "**/generated/**"
    - "**/vendor/**"
  dependency_manifests: human-review
  unsupported_diff: human-review

report:
  evidence: true
  json: true
  markdown: true
  github_check: true
```

## Sections and defaults

All sections are optional; unspecified fields resolve to the defaults below. The loader
returns a complete camelCase resolved object — nothing is left for the runtime to guess.

### Shared with v1

| Field | Default |
| --- | --- |
| `base` (required) | — |
| `language` (optional in v2) | `generic` |
| `commands.required` / `commands.optional` | `[]` |
| `scope.ignore_paths` / `allow_format_only_removal` / `flag_dependency_bumps` | `[]` / `true` / `true` |
| `intelligence.mode` | `local-only` |
| `performance.max_parallel_worktrees` / `cache_tests` | `1` / `false` |

### v2-only sections

| Field | Default | Notes |
| --- | --- | --- |
| `intent.sources` | `[cli, github_pr, linked_issue, commits]` | Allowed values: `cli`, `github_pr`, `linked_issue`, `commits`, `agent_plan`. **Local signals only — `llm` never calls a model in this milestone.** |
| `intent.llm` | `auto` | `auto` or `off`. |
| `knowledge.database` | `.patchdiet/knowledge.sqlite` | Local SQLite path. |
| `knowledge.languages` | `[typescript, javascript, python]` | e.g. `typescript`, `javascript`, `python`. |
| `knowledge.rules.auto_discover` | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `CONTRIBUTING.md` | `verify` reads matching files from the pinned HEAD Git blobs. |
| `knowledge.history.git` / `merged_prs` | `true` / `false` | Local git history on by default; merged-PR history off. |
| `reduction.dependency_grouping` | `true` | Parsed but not yet applied by the reducer; current ddmin groups by file. |
| `reduction.final_verification` | `true` | **Hard rule: `false` is a config error.** |
| `verification.targeted_first` | `true` | Parsed; targeted-first scheduling is not yet implemented. |
| `verification.full_required_at_end` | `true` | **Hard rule: `false` is a config error.** |
| `safety.protect` | `["**/migrations/**", "**/generated/**", "**/vendor/**"]` | Glob paths never removed. |
| `safety.dependency_manifests` | `human-review` | Only `human-review` is accepted. |
| `safety.unsupported_diff` | `human-review` | Only `human-review` is accepted. |
| `report.evidence` / `json` / `github_check` | `true` | Parsed; output toggles and GitHub Check generation are not yet fully wired. |

### Safety hard rules

`reduction.final_verification` and `verification.full_required_at_end` cannot be `false`.
The schema rejects `false` at load time — a config setting them to `false` fails with
`Invalid patchdiet.yaml` naming the offending path. The parser preserves the resolved `reduction.finalVerification` and
`verification.fullRequiredAtEnd` fields. The current `shrink` runtime always executes the complete required commands on the exact final artifact. Its reduction unit is still a hunk even when v2 defaults request `ast`; the separately tested AST patch encoder has not yet been connected to candidate selection. Use `patchdiet init --v2` for a template that explicitly sets supported `hunk` granularity and file-level ddmin settings.

The CLI now enforces `safety.protect` and dependency-manifest human review before candidate evaluation. `verify` accepts `--task` or `--task-file`, analyzes a pinned diff without running an oracle, and keeps unmatched changes uncertain when the dependency graph cannot be proven complete. These scope results do not authorize deletion.

`mergeConfigWithFlags` spreads the resolved config, so v2 sections survive CLI flag
merging unchanged, and an empty `--test` array never overrides `commands.required`.

## Strictness

- Unknown keys at any nesting level are rejected (zod `strictObject` for every section).
- Empty **and whitespace-only** commands (and `base` / `language` / `protect` entries) are rejected.
- `reduction.max_runtime_minutes` stays bounded to 1–1440 and `retry_flaky_tests` to 0–10 in both versions.

## Validation

Tests live in `tests/unit/config-v2.test.ts` (full example, defaults, version matrix,
strictness, hard safety rules, merge preservation, v1 compatibility) and the pre-existing
`tests/unit/config.test.ts` (v1 matrix, unchanged and still passing).
