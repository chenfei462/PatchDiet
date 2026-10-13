# CLI v0.2: configuration fields, data schema, and limitations

This is the accepted-field audit for the `version: 2` `patchdiet.yaml` surface and the CLI flags shipped in PatchDiet 0.2.0. It also documents the bounded local coverage DATA JSON schema and the limitations that are honest about what the schema accepts versus what the runtime computes.

Every field below is enforced at load time by strict schemas (`packages/core/src/config.ts`): unknown fields are rejected, blank strings are rejected, and numeric bounds apply. Parser acceptance is not runtime enforcement — fields the runtime does not compute are listed under [Honest limitations](#honest-limitations). Only some of them emit run diagnostics (named explicitly below: `scope.flag_dependency_bumps=false`); the others are simply inert. The history fields ARE computed: bounded pinned git history and caller-supplied merged-PR snapshots are ingested by `patchdiet index` and cited as weak neutral evidence (see `docs/history-evidence.md`).

## `version: 2` `patchdiet.yaml` accepted fields

### Top level

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `version` | `2` (literal) | required | Only `1` and `2` are supported; any other value is a config error. |
| `base` | non-empty string | — (required) | Base ref. Overridable per command with `--base`. |
| `language` | non-empty string | `generic` | Optional in v2 (the index infers per-file languages). |

### `commands`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `required` | array of non-empty strings | `[]` | Required verification commands. Overridable per run with repeated `--test` flags (a non-empty flag list wins; an empty one never shadows the config). |
| `optional` | array of non-empty strings | `[]` | Optional commands, reported but not gating. |

### `intent` (advisory scope gate)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `intent.sources` | array of `cli \| github_pr \| linked_issue \| commits \| agent_plan` | `["cli", "github_pr", "linked_issue", "commits"]` | Which task-description sources may feed the scope gate. |
| `intent.llm` | `auto \| off` | `auto` | Intent classification mode; resolves to local classification (no cloud adapter exists). With an explicit task, AST-granularity shrink positively retains required/supporting/protected/uncertain atoms and only trials unlinked low-risk candidates; readonly `verify`/`explain` remain advisory-only. |

### `knowledge`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `knowledge.database` | repo-local relative path | `.patchdiet/knowledge.sqlite` | Absolute paths and any `..` segment are rejected at load time; the CLI re-checks containment before opening the database. |
| `knowledge.languages` | array of non-empty strings | `["typescript", "javascript", "python"]` | Languages the index covers. |
| `knowledge.rules.auto_discover` | array of repo-relative globs | `["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", "CONTRIBUTING.md"]` | Rule files (max 500 files, 1 MiB each) pinned as git blobs; bodies are stored byte-faithfully. |
| `knowledge.history.git` | boolean | `true` | Ingests bounded pinned git history at the indexed commit (100 commits; bounded per-command time/output and path counts; explicit truncation/shallow diagnostics) into additive `history_*` extension tables. `verify`/`explain` attach weak neutral history evidence from the CURRENT snapshot only; stale/absent snapshots are reported and never attributed. See `docs/history-evidence.md`. |
| `knowledge.history.merged_prs` | boolean | `false` | Enables caller-supplied merged-PR snapshots via `patchdiet index --merged-prs <repo-local-json>`: strict, bounded (≤1 MiB, ≤100 records), no network; labels are unverified caller assertions, not GitHub authentication. Requires `knowledge.history.git`; when enabled but unavailable it is reported explicitly. Records appear in Scope Maps as citable global neutral evidence (PR identity, merge commit, input source/byte hash). See `docs/history-evidence.md`. |

### `reduction`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `reduction.strategy` | `conservative \| ddmin` | `ddmin` | Also settable per run with `--strategy`. |
| `reduction.atom_granularity` | `hunk \| ast` | `ast` | Also settable per run with `--granularity`. |
| `reduction.dependency_grouping` | boolean | `true` | Groups coupled atoms so they are reverted together. |
| `reduction.final_verification` | boolean, must be `true` | `true` | Hard safety rule. Writing `false` is a config error, not a flag. |
| `reduction.max_runtime_minutes` | integer 1–1440 | `20` | Dual role: it is the whole-run reduction budget AND the default per-command timeout (`max_runtime_minutes * 60_000` ms). A per-run `--timeout-ms` overrides the per-command timeout only; it does not extend the whole-run budget. |
| `reduction.retry_flaky_tests` | integer 0–10 | `2` | Per-run `--retry-flaky-tests` overrides. |

### `verification`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `verification.targeted_first` | boolean | `true` | Select tests from the pinned index mapping before falling back to the full required suite. Every unavailable-plan failure mode is recorded verbatim in the run. |
| `verification.full_required_at_end` | boolean, must be `true` | `true` | Hard safety rule. The full required suite always runs at the end; cannot be disabled. |

### `safety`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `safety.mode` | `local` (literal) | `local` | Only local mode exists. |
| `safety.allow_upload` | boolean | `false` | No upload path is implemented; `true` changes nothing. |
| `safety.protect` | array of non-empty globs | `["**/migrations/**", "**/generated/**", "**/vendor/**"]` | Paths never candidates for removal. |
| `safety.dependency_manifests` | `human-review` (literal) | `human-review` | Dependency-manifest changes always go to human review. This cannot be turned off; see limitations. |
| `safety.unsupported_diff` | `human-review` (literal) | `human-review` | Unsupported diffs always go to human review. |

### `report`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `report.html` | boolean | `true` | `.patchdiet/report.html` |
| `report.markdown` | boolean | `true` | `.patchdiet/report.md` |
| `report.github_comment` | boolean | `true` | `.patchdiet/report.github.md` |
| `report.evidence` | boolean | `true` | `.patchdiet/evidence.md` |
| `report.json` | boolean | `true` | Whether the JSON report file is written. Enabled output is `.patchdiet/run.json` in **both** v1 and v2 — the toggle controls physical output, not the filename. `patchdiet report` and `patchdiet card` read `.patchdiet/run.json`. The stdout `--json` output of `shrink` is an explicit request and unaffected by this toggle. |
| `report.github_check` | boolean | `true` | `.patchdiet/github-check.draft.md` (local draft only). |

Disabled formats are never written and never named in the run summary (no ghost artifact paths).

### `scope`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `scope.ignore_paths` | array of non-empty strings | `[]` | Paths excluded from candidate analysis. |
| `scope.allow_format_only_removal` | boolean | `true` | Whether formatting-only hunks may be removed. |
| `scope.flag_dependency_bumps` | boolean | `true` | Parsed but operationally inert: no advisory semver-bump detector exists in this version, so there is nothing for this flag to toggle. Setting `false` records a run diagnostic stating exactly that. It never affects the mandatory dependency-manifest human-review policy. |

### `intelligence` / `performance`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `intelligence.mode` | string | `local-only` | Free-form; no cloud mode exists. |
| `performance.max_parallel_worktrees` | integer ≥ 1 | `1` | Wired into the runner. |
| `performance.cache_tests` | boolean | `false` | Wired into the runner. Parsed default is `false` in both v1 and v2; the v2 template leaves it at the parsed default. |

## CLI flags (per command)

### `init`
- `--v2` — write the version 2 template (ddmin + ast + dependency grouping + final verification on; `targeted_first` off in the template because it needs a built index).

### `index`
- `--ref <ref>` (default `HEAD`), `--database <path>`, `--coverage <path>`, `--merged-prs <path>`, `--json`.
- `--coverage` accepts the four formats below; the command prints a coverage summary and diagnostics.
- `--merged-prs` ingests a caller-supplied merged-PR snapshot (repo-local JSON, strict, bounded; requires `knowledge.history.merged_prs: true` and `knowledge.history.git: true` — otherwise the run fails with an explicit error). With the feature enabled but no snapshot provided, the run reports merged-PR evidence as explicitly unavailable. See `docs/history-evidence.md`.

### `check`
- `--base <ref>`, `--head <ref>`, `--json`.

### `verify`
- `--base <ref>`, `--head <ref>`, `--task <text>`, `--task-file <path>`, `--json` (Scope Map). Read-only: never modifies the repository or runs checks.

### `explain`
- Same base/head/task options as `verify`, plus filters `--atom <id>`, `--file <path>`, `--symbol <name>`, and `--json`.

### `shrink`
- `--base`, `--head`, `--test <command>` (repeatable), `--create-branch`, `--apply`, `--dry-run`, `--allow-test-file-removal`, `--task <text>`, `--task-file <path>` (`--task` wins), `--strategy conservative|ddmin`, `--granularity hunk|ast`, `--timeout-ms <positive int>`, `--retry-flaky-tests <non-negative int>`, `--json`.
- `--final-verify` is accepted and always on. `--no-final-verify` is rejected as an error: final artifact verification is mandatory in every mode.
- Base ref detection order: explicit `--base` → GitHub Actions PR refs → config `base` → `origin/main` → `origin/master` → upstream merge-base.
- Test command detection (when no `--test` and no config `commands.required`): `npm test` / `pnpm test` / `yarn test` / `bun test` (via `packageManager` or lockfile), `pytest`, `go test ./...`, `cargo test`. If nothing is detected, `shrink` fails with guidance instead of guessing.

### `doctor`
- `--base <ref>`, `--head <ref>`, `--test <command>` (repeatable). Exits nonzero when any check fails.

### `report`
- `--format markdown|html|github|json` (default `markdown`). Renders `.patchdiet/run.json` from a previous run.

### `card`
- `--project <name>`, `--format svg|html|png|badge`, `--output <path>`, `--badge-url <url>` (required for `badge`). Defaults write under `.patchdiet/`.

## Bounded local coverage DATA JSON schema

`patchdiet index --coverage <file>` accepts a JSON file matching this schema (`packages/knowledge/src/coverage.ts`), bounded to keep local input cheap to validate:

```json
{
  "schemaVersion": 1,
  "source": "vitest --coverage",
  "tests": [
    {
      "name": "src/shrink.test.ts > keeps passing hunks",
      "files": ["src/shrink.ts"],
      "lines": { "src/shrink.ts": [[10, 24], [31, 31]] }
    }
  ]
}
```

Bounds and rules:

- `schemaVersion` must be exactly `1`; `source` is a provenance string, max 200 chars.
- At most 100,000 test entries; each test name is 1–500 chars; each test maps at most 10,000 file paths; each path is 1–1024 chars.
- `lines` is optional per test: a record of repo path → inclusive `[startLine, endLine]` intervals (positive integers), at most 100,000 intervals per path. Total normalized line rows are capped at 1,000,000.
- The file is capped at 20 MiB.
- Provenance semantics: this is coverage as **reported** by the tool. Per-test context is explicit only — aggregate executed-line data never invents test identities and never enters per-test mapping queries. A mapping derived from it is advisory evidence for targeted test selection, never a substitute for rerunning the required checks.
- The same `--coverage` flag also accepts LCOV tracefiles, Istanbul JSON summaries, and coverage.py JSON, which are normalized into the same bounded model (per-test where the format carries it, aggregate otherwise, with diagnostics for dropped or malformed rows).
- Malformed JSON or schema violations fail with a bounded error message (first five issues) and exit nonzero. Ingestion is not atomic with repository indexing: no coverage rows are inserted, but the repository indexing step may already have committed its pinned files/meta update before coverage parsing fails.

## Honest limitations

Fields and behaviors this version accepts or documents but does **not** fully compute. Only the fields whose code actually emits one surface a run diagnostic (`scope.flag_dependency_bumps=false`); the rest are silently inert rather than diagnosed. (The history fields are computed as of the post-MVP Task 1 batch — see `docs/history-evidence.md` for their exact bounds and limits.)

1. **No advisory semver-bump detector.** A separate detector that classifies dependency bumps by semver impact is not implemented in 0.2.0, and `scope.flag_dependency_bumps` therefore has no separate operational behavior to toggle. Dependency-manifest changes are simply routed to human review unconditionally, and that policy has no off value.
2. **`scope.flag_dependency_bumps=false` is inert but recorded.** Setting it to `false` does not disable anything (there is no detector); the run records a diagnostic stating that the flag toggles no detector behavior and that the dependency-manifest human-review policy remains mandatory and unaffected.
3. **History evidence is bounded and advisory; merged-PR records are caller assertions.** `knowledge.history.git` ingests bounded pinned history (a lower bound under truncation/shallowness, reported explicitly); co-change is a file-level same-commit heuristic, not a symbol dependency or task similarity. `knowledge.history.merged_prs` records are ingested only from an explicit repo-local snapshot whose labels are unverified caller assertions — never GitHub authentication, never a natural benchmark sample. History and merged-PR evidence appear as weak neutral records with real commit/source identities and never change a classification state, eligibility, risk or oracle authority. Enabled-but-unavailable states (no current snapshot; `merged_prs: true` with `history.git: false`; enabled with no snapshot) are reported explicitly rather than silently skipped.
4. **`safety.allow_upload: true` changes nothing, and shell commands are not a sandbox.** No upload path exists; local-first is the only mode, and there is no automatic upload or cloud intent adapter. Conversely, `shrink`/`doctor` execute the user-configured verification commands as ordinary local processes — PatchDiet does not sandbox them, so a configured command that reaches the network does exactly what it would do run by hand.
5. **Targeted-first requires a built, pinned index.** With `verification.targeted_first: true` but no `patchdiet index` run (or a stale index, an unsupported test recipe, or no mapping), the plan is explicitly unavailable and the run falls back to the full required suite. The v2 `init --v2` template ships `targeted_first: false` for this reason. Regardless of targeting, the full required suite always runs at the end.
6. **Coverage data is provenance, not proof.** A per-test mapping from coverage input narrows which tests run first; equivalence is still only ever claimed as "your required checks passed after removal." Ingestion of a malformed coverage file is also not atomic with repository indexing: no coverage rows are inserted, but the pinned files/meta index update may already have committed.
7. **Task evidence is advisory in readonly mode, constraining in AST shrink.** For `verify` and `explain` (and non-AST reduction), `--task` / `--task-file` only classify scope and flag out-of-scope candidates for human review; they never block or auto-remove candidates. With an explicit task under `--granularity ast`, however, scope classification gates the removal search itself: required, supporting, protected, and uncertain atoms are positively retained and only unlinked low-risk candidates are trialed. The task still never authorizes a removal — the configured checks remain the only removal authority.
8. **No LLM, no automatic upload.** `intent.llm: auto` resolves to local classification in this version; the CLI has no automatic upload or cloud adapter, so PatchDiet itself sends nothing anywhere and no cloud intelligence mode exists. This is not a sandbox: user-configured verification commands run as ordinary local processes and can reach the network exactly as they would run by hand (see limitation 4).
