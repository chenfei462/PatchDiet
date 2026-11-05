# Local feedback data schema

This documents the bounded, local-only JSON format for recording human feedback about a PatchDiet shrink run's candidates. It is a **data format specification only**: PatchDiet 0.2.0 has no feedback reader or writer — the CLI and core contain no feedback collection, storage, or read path. Files in this format are manually authored and consumer-managed local records. There is no built-in collection, no network access, and no adaptive behavior; `safety.allow_upload` has no effect (see `docs/cli-v02.md`, limitations). The machine-checkable contract for this format is [`feedback.schema.json`](feedback.schema.json) in this directory.

The coverage input interface (`patchdiet index --coverage`, schemaVersion:1 per-test JSON, LCOV, Istanbul, coverage.py) is a **separate** schema, documented in `docs/cli-v02.md`. Feedback data is an output-side record of a completed run, not an input to test selection.

## Purpose

A reviewer inspects `.patchdiet/report.md` (or `run.json`) and may want to record per-candidate verdicts — accepted, rejected, wrong — alongside the run receipt, in a stable machine-readable shape that a later tool release can still read. This schema fixes that shape with strict bounds so the file stays small, reviewable, and diff-friendly.

## File location and size

- Conventional path: `.patchdiet/feedback.json`, next to the run artifacts it refers to.
- Size requirement: files SHOULD be at most 4 MiB. This is a consumer requirement — PatchDiet's CLI performs no automatic enforcement (it does not read or write these files); any tooling that consumes this format rejects larger files.
- Encoding: UTF-8, one JSON object, no trailing data.

## Schema

Top-level object (additional properties rejected):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | integer, literal `1` | yes | Only `1` is defined. |
| `runRef` | object | yes | Provenance binding to the reviewed run (see below). |
| `feedback` | array of feedback entries, 1–10,000 | yes | One entry per assessed candidate. |

`runRef` (all required, additional properties rejected):

| Field | Type | Notes |
| --- | --- | --- |
| `baseRef` | string, 1–200 chars | Base ref as recorded in the run report. |
| `headRef` | string, 1–200 chars | Head ref as recorded in the run report. |
| `cleanupDiffSha256` | string, 64 lowercase hex chars | SHA-256 of `.patchdiet/cleanup.diff` at review time. Binds the verdicts to the exact bytes reviewed; a mismatch means the artifacts changed after review and readers must reject the binding. |

Feedback entry (additional properties rejected):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `candidateId` | string, 1–200 chars | yes | The candidate identifier from the run report (file path plus atom/hunk coordinates as rendered in `run.json`). |
| `path` | string, 1–1024 chars, forward slashes | yes | Repo-relative path the candidate touches. Absolute Unix/Windows/UNC/drive-letter paths, `.`/`..` traversal segments, backslashes, and NUL/control characters are rejected. |
| `verdict` | `accepted \| rejected \| wrong_scope \| uncertain` | yes | Human verdict. `wrong_scope` means the removal itself was safe but did not match the task intent. |
| `note` | string, 0–2000 chars | no | Free-text reviewer note. Stored verbatim, never interpreted. |
| `reviewedAt` | string, ISO 8601 date-time, 20–64 chars | yes | When the verdict was recorded (RFC 3339 with explicit UTC offset or `Z`). |

No other fields exist. Verdicts carry no numeric score, no model output, and no user identity.

## Example

```json
{
  "schemaVersion": 1,
  "runRef": {
    "baseRef": "origin/main",
    "headRef": "HEAD",
    "cleanupDiffSha256": "9f2c1a4e0b6d8f7a3c5e1d9b0a7c4e2f6d8b1a3c5e7f9d0b2a4c6e8f0d3b5a7c"
  },
  "feedback": [
    {
      "candidateId": "src/generated/notes.ts@hunk:1",
      "path": "src/generated/notes.ts",
      "verdict": "accepted",
      "note": "Planning notes the agent committed by mistake.",
      "reviewedAt": "2026-10-06T09:15:00Z"
    },
    {
      "candidateId": "src/cart/pricing.ts@hunk:2",
      "path": "src/cart/pricing.ts",
      "verdict": "rejected",
      "reviewedAt": "2026-10-06T09:16:30Z"
    }
  ]
}
```

## Boundary guarantees

- **Local only.** Nothing reads or writes this file over the network; no field is collected, and no adaptive behavior consumes it in 0.2.0. A later release may use accumulated local feedback to improve candidate ordering, and this schema is the contract it would read — but that behavior does not exist in this version.
- **No identity.** The schema has no author, account, machine, or repository-URL field. Provenance is limited to the run's own refs and the cleanup-diff hash.
- **Reviewer authority.** A `rejected` verdict is documentation of human judgment; it does not gate, revert, or annotate anything automatically in this version.
- **Rejection behavior.** Readers implementing this schema reject unknown top-level or entry fields, oversize files, out-of-range array lengths, non-hex or non-64-char hashes, and verdicts outside the enum, with the first few issues named — the same strict-parse style as the v2 config and coverage schemas.
