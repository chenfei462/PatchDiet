# P1-B research integrity validation

Validator: `scripts/validate-research-integrity.mjs`

Current result: `RESEARCH_INTEGRITY_VALIDATED` with exit code `0` on 2026-10-26 after resolving the WDD artifact record and identifying the 2026 reviewer-reliability study.

The validator now checks duplicate IDs within each registry section, path existence, source↔claim references, algorithm/project/ticket source references, peer-reviewed metadata, repository fixed-commit/license fields for `SOURCE_VERIFIED_REPOSITORY`, claim safety fields, ADR source references and D1–D7 application gates. It writes machine-readable output to `RESEARCH_INTEGRITY_VALIDATION.json`.

Remaining research gates are outside validator syntax/reference integrity: many newly added P1-A records remain `SOURCE_PARTIALLY_VERIFIED` and therefore do not pass D1, while legal/data-use and independent review gates remain separate. No runtime ticket is promoted from this result.
