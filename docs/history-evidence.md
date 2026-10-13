# Pinned history and caller-supplied merged-PR evidence

Task 1 of the post-MVP plan (2026-10-07). This document describes the bounded
git history facts stored in the semantic index, how merged-PR snapshots are
ingested, and the exact limits of what history can and cannot do.

## What history evidence is

History facts are **weak, neutral, repository-local observations** collected at
an exact pinned commit. They carry real source/commit identity (full 40-hex
commit SHAs, the pinned snapshot commit, and real recorded file paths).

They are **not**:

- a symbol dependency graph (co-change is a file-level, same-commit heuristic);
- a task-similarity score (no similarity is ever computed or stored);
- a merged-PR authentication (labels are unverified caller assertions);
- a completeness claim (a shallow or truncated log is reported as such);
- a removability proof. Absence of history never proves a change is unused,
  and presence of history never proves it is required.

History evidence **never** changes scope state, eligibility, risks,
protections, candidates, grouping, command selection or oracle authority.
In the Scope Map it appears as `category: "history"`, `polarity: "neutral"`,
`reliability: "weak"` records: per-atom records with the path's real commit
identities, plus one GLOBAL record per caller-asserted merged-PR snapshot
record (below).

## Enabling history ingestion

`knowledge.history.git` (default `true`) controls history collection during
`patchdiet index`:

```yaml
version: 2
knowledge:
  database: .patchdiet/semantic-index.db
  history:
    git: true        # bounded pinned history (default on)
    merged_prs: false # caller-supplied merged-PR snapshots (default off)
```

```bash
patchdiet index --ref agent/bloated --json
```

The JSON result reports a truthful `history` block: `enabled`, `collected`,
`commits`, `truncated`, `shallow`, `cochangePairs`, `mergedPrs` and explicit
`diagnostics` (truncation, shallow, path-bound overruns). The text output
prints the same facts, including merged-PR unavailability diagnostics.

### Bounds (fail closed, never silently unbounded)

| Bound | Value |
| --- | --- |
| Commits per snapshot | 100 (`MAX_HISTORY_COMMITS`); one extra commit is examined only to detect truncation |
| Per git command | 30 s wall clock, capped output; the child is killed on overrun |
| Paths per commit | 200 recorded; overruns are counted into diagnostics |
| Total (commit, path) rows | 20 000 |
| Distinct co-change pairs | 20 000 |
| Commit subject | 200 characters |

Truncation, shallowness and every bound overrun are reported as explicit
diagnostics stored with the snapshot. A shallow repository never presents its
short log as complete history.

### Isolation and staleness

- History is collected from `git log <pinned-commit>` only: dirty working
  trees are never read and never leak into facts.
- Path framing is exact: the log format prefix (`%x00`) emits a NUL sentinel
  immediately before EVERY commit header, and with `-z` git emits exactly ONE
  format newline before the FIRST path record only (pathless commits such as
  merges emit none). That one newline is stripped; every other byte is the
  real path. Filenames containing LF, TAB or the format's own field separator
  U+0001 — legal in Git tree entry names but unavailable as Windows filenames —
  are preserved byte for byte. Header
  recognition is positional, not syntactic: a header is a record directly
  after the empty sentinel, and because a path can never be empty nor contain
  NUL, even a filename that mimics all six header fields stays a path.
  Verified against git object fixtures, not the filesystem. Records that
  cannot be attributed to a commit header raise an explicit lower-bound
  diagnostic instead of being silently dropped.
- Log records are strict-decoded UTF-8: a record containing invalid UTF-8
  bytes fails the history ingestion explicitly (naming the offending bytes)
  instead of storing a replacement-decoded path that git never reported.
- The database holds exactly ONE snapshot. Re-indexing replaces it inside a
  single transaction (idempotent: re-running the same commit does not
  duplicate rows).
- A snapshot is **current** only when its `pinned_commit` equals the index's
  `meta.last_commit`. `verify`/`explain` (strictly read-only) attach history
  facts **only** from a current snapshot; stale snapshots yield empty facts and
  an explicit diagnostic — never attribution.

## Merged-PR snapshots (caller-supplied, strict, no network)

`knowledge.history.merged_prs: true` plus an explicit
`patchdiet index --merged-prs <repo-local-json>` ingest caller-asserted
merged-PR records. Passing `--merged-prs` while the feature is configured off
is a hard error; enabling it without a snapshot reports `unavailable`.

Schema (`patchdiet-merged-prs/1`, strict — unknown fields are rejected):

```json
{
  "schemaVersion": "patchdiet-merged-prs/1",
  "records": [
    {
      "pr": "#7",
      "mergeCommit": "40-hex commit sha of the merge",
      "snapshotPath": "docs/pr-7.patch",
      "labels": ["local-snapshot"]
    }
  ]
}
```

Validation, all performed BEFORE any database write:

- input is a repo-local regular file ≤ 1 MiB (enforced on the stat size AND
  the bytes actually read), read as raw bytes and strict-decoded as UTF-8 —
  invalid UTF-8 is refused, never replacement-decoded; `inputContentSha`
  recorded in the index is the SHA-256 over those ACTUAL bytes;
- every record cites a PR identity, a full 40-hex merge commit and a
  repo-local `snapshotPath` provenance string. Provenance paths are strictly
  repository-relative POSIX segments: absolute paths, drive letters, ANY
  backslash (including `src\..\outside.patch` traversals), `.`/`..`/empty
  segments, embedded NUL and every control character are rejected; dots,
  spaces and Unicode are legitimate and accepted;
- `labels` (optional, ≤ 16) are stored verbatim as **unverified caller
  assertions** — they are not GitHub authentication;
- every claimed merge commit must be reachable from the indexed commit
  (`git merge-base --is-ancestor`);
- duplicates of PR identity or merge commit are refused; merged status is
  never inferred from a commit subject; no network request is ever made.

Re-indexing with `merged_prs` disabled removes stale caller-asserted rows
together with the replaced snapshot: a disabled option never leaves live data.

## Flag independence

The two flags are honored independently. `merged_prs: true` with
`history.git: false` is never silently ignored: both `patchdiet index` (JSON
and text) and `verify`/`explain` report explicitly that merged-PR evidence
requires `knowledge.history.git` (PR records are anchored to a pinned history
snapshot) and is unavailable. Explicit `--merged-prs` input while the feature
is configured off (either flag) is a hard error. Snapshot records are
caller-asserted provenance only and must never become natural benchmark
samples.

## Storage

History lives in additive `history_*` extension tables (`history_snapshots`,
`history_commits`, `history_commit_paths`, `history_cochange`,
`history_merged_prs`), created transactionally with `IF NOT EXISTS` on the
write connection only — the same additive pattern as the coverage extension.
Readonly connections never create, migrate or write anything: an original
schema-v1 index (or an index created with history disabled) opens normally and
history queries return empty results instead of failing.

## Public query surface (readonly)

On `KnowledgeIndex` (from `openKnowledgeIndexReadonly`):

- `getHistorySnapshot()` — the stored snapshot with `current` staleness flag
  and its diagnostics, or `null`;
- `getHistoryFactsForPaths(paths)` — per path (current snapshot only):
  `changeCount` (distinct commits touching the path; a lower bound when
  truncated/shallow), `sourceCommits` (up to 5 real recent commit SHAs),
  `snapshotCommit`, `coChangedWith` (top 5 file-level same-commit partners);
- `getMergedPrs()` — caller-asserted merged-PR records with their provenance.

In the Scope Map (`patchdiet verify` / `explain` JSON):

- every atom whose path has current history facts carries a weak neutral
  `category: "history"` record with the real commit SHAs and snapshot pin;
- each ingested merged-PR record appears as an additional GLOBAL weak neutral
  `category: "history"` record (sourceId `merged-pr:<pr>`, no atom id) whose
  detail cites the actual PR identity, full merge commit, local snapshot path,
  input file and byte-exact `sha256:<inputContentSha>` — so the record is
  citable and re-verifiable, not just a count. These records carry explicit
  limits (caller assertion, no file/symbol relation, never authorises removal)
  and never change any classification; the analysis id IS sensitive to the
  ingested provenance, so a different snapshot input yields a different
  analysisId while classifications stay identical.

## Limitations

- History is a bounded lower bound, by design; the exact bounds apply.
- Co-change is a heuristic over recorded paths only; merge commits contribute
  no file lists (`git log --name-only` shows none), and none are fabricated.
- Merged-PR evidence is global provenance: no per-atom file/symbol relation is
  claimed or derivable from a merged-PR record alone.
- History facts and merged-PR records do not, and must not, affect what
  PatchDiet removes; the runtime oracle authority is unchanged.
- Merged-PR labels are caller assertions; nothing in the index verifies them
  against GitHub. Ingested snapshot records are caller-supplied provenance and
  must never be presented as natural benchmark samples.
