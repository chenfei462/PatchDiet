# PatchDiet evidence-gated continuation handoff

Final status: `RESEARCH_PARTIAL`

Authoritative status: `RESEARCH_DISTILLATION_PARTIAL` / `ENGINEERING_EVIDENCE_NOT_YET_CLOSED`.
Experiments remain `NOT_PERMITTED` because the independent research review has not yet reissued its final gate after the WDD and 2026-source corrections, and several P1-A records remain partially verified. Runtime changes adopted from research: `0`.

## Repository state

- Actual HEAD: `a57b27eeea6d6d3c7ad581334dba10830b7f4730`
- Branch: `codex/hackathon-judge-mode`
- The worktree was already dirty at continuation start. Existing changes were preserved; no reset or automatic commit was performed.
- Initial state: [R0_STATE.json](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/R0_STATE.json)
- `RTK.md` was referenced by AGENTS instructions but was not present at the repository root or repository file listing.

## Research coverage

P0-A audited the 20 legacy sources. P0-B corrected ddmin, HDD, WDD, ProbDD, CDD, Vulcan and LPR provenance and algorithm boundaries. P1-A added separate research records for SCIP TypeScript/Python/Java, Joern, ast-grep, Semgrep, CodeQL, PIT, mutation literature, SWE-rebench, SWE-bench-Live, AIDev, CodeReviewQA, PR tooling, Git libraries and the current OpenSSF baseline.

These additions remain research-only or partially verified until fixed-version, license, data-use and D1–D7 gates pass. No external dataset was imported. `REAL_HUMAN_PR_COUNT = 0`, `REAL_AGENT_PR_COUNT = 0`, and `FRESH_TASK_COUNT = 0`.

## Source and algorithm status

- Primary paper/specification records use `SOURCE_VERIFIED_PRIMARY` only after content and locators were inspected.
- Repository records use `SOURCE_VERIFIED_REPOSITORY` only after fixed commit, root license path/type and retrieval date were captured.
- WDD remains `SOURCE_PARTIALLY_VERIFIED`: GitHub commit `4a6cdd00f3f136867f23f76057a7104961c2e8e4` is recorded, but project-level license/notice scope remains unresolved. Zenodo is a separate artifact.
- The unidentified 2026 LLM reviewer-reliability study has no fabricated citation.
- The seven corrected reduction cards are `RESEARCH_ONLY`; none grants removal authority.

Details: [SOURCE_CORRECTIONS.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/SOURCE_CORRECTIONS.md), [SOURCE_REGISTRY_AUDIT.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/SOURCE_REGISTRY_AUDIT.md), [REPOSITORY_LICENSE_REVIEW.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/REPOSITORY_LICENSE_REVIEW.md).

## Independent reviews

The independent research review records the WDD Zenodo artifact provenance/license scope as resolved with GitHub snapshot/Docker digest/reproduction limitations; mandatory P1-A source coverage and independent re-issuance after the newest records remain open. Gate: `EXPERIMENTS_NOT_PERMITTED`.

The independent engineering/safety review is complete with no unresolved CRITICAL/HIGH engineering finding. ER-001/ER-002 concurrency issues and ER-003 unsupported combined-diff handling were resolved and rechecked. ER-004/ER-006 remain medium coverage follow-ups. P1 is permitted by engineering review only; the research gate still blocks it.

Review: [INDEPENDENT_RESEARCH_REVIEW.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/INDEPENDENT_RESEARCH_REVIEW.md), [INDEPENDENT_ENGINEERING_REVIEW.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/INDEPENDENT_ENGINEERING_REVIEW.md).

## Safety fixes verified

- Candidate worktree names now include a content-bound SHA-256 suffix, preventing sanitized-path collisions under parallel evaluation.
- Candidate workers drain with `Promise.allSettled` before run-root cleanup.
- Combined/unsupported Git forms are detected before normal parsing, retained through `rawSection`, re-emitted byte-for-byte, routed to human review, and preserved by the kept-file builder.

## Experiments and adoption

- Reducer comparison: not started.
- Syntax-candidate experiment: not started.
- SCIP comparison: not started; SQLite remains current baseline.
- Mutation oracle audit: not started; benchmark-only.
- Targeted-first E4 audit: not started; current control flow still requires final full verification.
- Runtime changes adopted: `0`; no PD-E ticket created.
- Runtime changes rejected: no new adoption/rejection decision; existing ADRs keep speculative integrations out of runtime.

## Git support matrix

[git-diff-support-matrix.md](/D:/systemDir/Desktop/PatchDiet/knowledge/research/mappings/git-diff-support-matrix.md) records normative Git semantics, current parser/serializer/reducer/final-verification support, tests and missing coverage. Combined diff is explicitly `UNSUPPORTED_FAIL_CLOSED` with raw human-review preservation. Natural `getDiff` combined-diff coverage remains a medium follow-up.

## Validation evidence

- `npx vitest run tests/unit/research-registry.test.ts`: passed, 1 test.
- `npx vitest run tests/unit/diff.test.ts`: passed, 38 tests.
- `npx vitest run tests/unit/shrink-safety.test.ts`: passed before the final unsupported-diff helper addition, 79 tests; focused post-fix tests for collision, unsupported routing and raw retention pass.
- `npm run typecheck`: passed after the safety fixes.
- `node scripts/validate-research-integrity.mjs`: exit code 0, `RESEARCH_INTEGRITY_VALIDATED`, with zero errors and zero warnings. Partial source/license/data-use gates remain represented in the report. Report: [RESEARCH_INTEGRITY_VALIDATION.json](/D:/systemDir/Desktop/PatchDiet/knowledge/research/reports/RESEARCH_INTEGRITY_VALIDATION.json).
- Full build, full test suite after every final edit, benchmark and release smoke commands were not rerun. No full-regression or production-readiness claim is made.

## External blockers and limitations

- WDD artifact Docker image digest and reproduction remain open limitations; GitHub snapshot license scope is separate. Several P1-A records still need fixed-version/license/data-use inspection and independent research review re-issuance.
- Missing identity for the 2026 reviewer-reliability study.
- Remaining P1-A source/license/data-use verification and independent review re-issuance; P1-B validator syntax/reference validation now passes with zero errors and zero warnings.
- Medium AST graph completeness and targeted-first integration coverage follow-ups.
- Research evidence describes bounded source capabilities and study results. It does not prove PatchDiet benchmark improvement, semantic equivalence, production readiness or safe automatic deletion.



