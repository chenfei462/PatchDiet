# Local feedback data schema

The version 1 format below describes the accepted **0.2.0** delivery. That delivery has no feedback reader or writer: version 1 files are manually authored and consumer-managed. Its machine-checkable contract remains [`feedback.schema.json`](feedback.schema.json). The separate post-MVP development format and CLI are described under [Version 2](#version-2-post-mvp-development) below; they do not change the accepted 0.2.0 package.

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

## Version 2: post-MVP development

The isolated development candidate adds `patchdiet feedback record --candidate <zero-based-ordinal> --path <repo-relative-path> --verdict <accepted|rejected|wrong_scope|uncertain> [--note <text>] [--json]` and `patchdiet feedback show [--json]`. These commands record and query only. They do not run an oracle, modify source, send data over the network, or change a shrink decision. The reviewer must use the candidate's ordinal **and** path from the current `run.json`; path plus hunk header alone is not a unique identifier.

Version 2 records live in `.patchdiet/feedback/<report-SHA-256>.json` so a later shrink run does not silently overwrite earlier decisions. The CLI checks the current report bytes, the emission-time `cleanupDiffSha256` in `run.json`, the actual cleanup patch bytes, the pinned base/head commit identities and current refs, and the local repository root before recording or showing a decision. Old reports without an emission-time cleanup hash are refused; rerun shrink with the development build. Missing, redirected, hardlinked, oversized and malformed inputs are refused. A repeated identical decision is idempotent; a conflicting verdict for the same candidate and run is refused. Separate processes serialize writes with a repository-local lock and write the JSON atomically.

The [version 2 JSON schema](feedback-v2.schema.json) is separate from version 1. It records the repository root fingerprint, pinned base/head commit hashes, report and cleanup patch hashes, candidate ordinal, the run-bound candidate digest and a source-content digest independent of the verdict, optional inert note, and review time. It does not identify or authenticate the human reviewer. The hashes detect accidental or uncoordinated changes to local artifacts; a writer who can rewrite the report, patch, and feedback store together can forge local records. These development records are **not** natural human-labelled PR validation samples without independent provenance. The accepted 0.2.0 tarball remains unchanged.

`patchdiet shrink --feedback-ranking` explicitly enables advisory ordering memory. At least two different report identities from the same local repository must have `accepted` decisions for the same source-content digest; each run counts once, and any `rejected` decision vetoes that digest. The bounded loader disables ranking with a diagnostic if its local store is malformed or redirected. Only candidates already eligible under the existing scope, risk, protection and format rules may move in the trial order, including AST groups. Feedback does not create eligibility, change a verdict, cache oracle outcomes, skip required commands, or replace combined and final full verification. The report records the number of prioritized content digests and any loader diagnostic. These local records are unauthenticated heuristics, not measured model accuracy or independently labelled PRs.
