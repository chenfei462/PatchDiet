# PatchDiet — Independent Engineering / Safety Review (P0-D)

Date: 2026-10-26  
Repository state reviewed: a57b27eeea6d6d3c7ad581334dba10830b7f4730  
Review pass: separate engineering/safety review. This pass did not edit runtime code, tests, benchmarks, or research cards.

## Scope and evidence

This review read sections 38–43 of CONTINUATION_REQUIREMENTS.md, STATUS.yaml, registry.yaml, SOURCE_CORRECTIONS.md, INDEPENDENT_RESEARCH_REVIEW.md, the current algorithm/project/ticket records, and all four current ADRs. It inspected reducer, runner, diff/Git/patch-encoder, targeted-first, shrink/final verification, AST atomization/grouping, evidence/scope, knowledge index/coverage identity, and the Git support matrix.

The original pre-mitigation manual probe of the parser with a diff --cc section and an @@@ hunk produced a file with no hunks and dropped the body on serialization. The final recheck below confirms that the mitigation now rejects and preserves this form.

STATUS.yaml correctly reports experiments_authorized: false, runtime_changes_authorized: false, and only PD-R001 as IMPLEMENTED. The reducer, SCIP, semantic-diff, and mutation ADRs keep research-derived strategies out of deletion authority.

## Findings

### ER-001 — HIGH — parallel candidate-name collision (RESOLVED AND RECHECKED)

Before the current fix, sanitizeSegment (packages/core/src/shrink.ts:2698-2700) mapped distinct paths such as src/a/b.js and src/a-b.js to the same worktree/patch name while evaluateAllCandidates ran concurrently (1244-1301). A second worker could prune/remove the first worker's active worktree through createEvalWorktree (231-259).

The current implementation binds a SHA-256 suffix to candidate path, unit, and patch (packages/core/src/shrink.ts:2332-2343; current lines may shift as the branch evolves). This makes worktree and patch identities unique while retaining the original path in evidence. The root-cause regression fixture in tests/unit/shrink-safety.test.ts:1332-1348 (src/a/b.js versus src/a-b.js, two concurrent worktrees, delayed oracle) was red-green verified and now passes.

Mitigation/resolution: unique content-bound suffix plus the collision regression test. Resolved and rechecked; no longer a P1 blocker.

### ER-002 — HIGH — worker rejection racing run-root cleanup (RESOLVED AND RECHECKED)

The previous forEachWithConcurrency used Promise.all (packages/core/src/shrink.ts:2457-2474), so one rejected worker could cause the caller's finally cleanup (1160-1181) while sibling workers still used their worktrees.

The current implementation awaits Promise.allSettled and only rethrows after all worker promises have settled (packages/core/src/shrink.ts:2464-2485). The same failure-drain/concurrency fixture in tests/unit/shrink-safety.test.ts:1332-1348 was red-green verified together with ER-001.

Mitigation/resolution: all-settled worker draining before run-root cleanup. Resolved and rechecked; no longer a P1 blocker.

### ER-003 — HIGH (RESOLVED AND RECHECKED) — combined/unsupported Git forms

Initial finding: the parser previously ignored diff --cc/diff --combined headers and @@@ hunks, causing a lossy serialization path. The mitigation now present in packages/core/src/diff.ts:27-42 detects those forms before ordinary parsing, returns unsupported metadata, stores the complete input in rawSection, and packages/core/src/diff.ts:369-375 re-emits that raw section byte-for-byte. packages/core/src/types.ts:20-27 and 49-54 carry unsupported status, reason, raw bytes, and top-level diagnostics. packages/core/src/shrink.ts:567-571 marks the run partial; getConservativeSkipEvaluation at 2630-2643 routes the sentinel to needs-human-review; buildKept at 793-809 retains unsupported/rawSection zero-hunk files.

Targeted evidence: tests/unit/diff.test.ts:27-50 verifies detection, reasons, and exact parser round-trip; tests/unit/shrink-safety.test.ts:721-732 verifies conservative human-review routing. The parser suite reports 38/38 passing, with related typecheck/targeted checks reported passing. A natural getDiff-produced combined-diff fixture is still absent, so this remains a MEDIUM coverage limitation.

Status: RESOLVED AND RECHECKED. No remaining HIGH risk was found for this finding.
### ER-004 — MEDIUM — AST graph completeness is overstated for changed-only edges

packages/core/src/ast-shrink.ts:223-257 builds graph facts only from changed AST edits and sets incompleteReasons: [] once changed files parse. packages/scope/src/analyze.ts:644-685 can then use graphComplete plus no path as candidate evidence. The executable oracle and final artifact gates remain mandatory (ast-shrink.ts:512-525,613-693; shrink.ts:830-855), so this is not a direct deletion bypass.

Risk: a path through unchanged files is absent from the changed-only graph, so scope evidence can be stronger than the available facts.

Mitigation: use a repository-complete graph or mark changed-only graphs incomplete; add a changed-to-unchanged intermediary fixture and require uncertain. Open MEDIUM; not an independent P1 blocker after ER-003 is fixed.

### ER-005 — MEDIUM — configured command exit status is the oracle-strength boundary

packages/core/src/shrink.ts:2430-2450 validates only nonblank required commands; 2388-2412 treats zero exit status as an individually removed candidate, and combined/final stages rerun those commands (1533-1571,1846-1897). A weak command can pass without testing the changed behavior.

Mitigation: keep configured executable checks as the sole removal authority, state the limitation in receipts/experiments, run the benchmark-only mutation-strength audit, and never turn mutation score or heuristic confidence into authority. Open MEDIUM; no fail-closed bypass observed.

### ER-006 — MEDIUM — targeted-first E4 integration coverage remains incomplete

packages/core/src/targeted.ts:10-20,129-220 explicitly falls back for missing, stale, unreadable, unmapped, and unsupported plans. shrink.ts:1508-1533,2247-2307 runs mappings on actual removal state, while 830-855,1846-1897 require full final verification before mode: verified.

No targeted-only VERIFIED bypass was found. Add E4 integration cases for targeted PASS/full FAIL, incomplete/wrong mapping, and assert zero automatic removals on full failure. Current control flow is safe; MEDIUM test gap remains.

### ER-007 — LOW — reducer cache identity is incomplete if persistence is added

packages/core/src/reducer.ts:30-42 includes base/head SHAs, required commands, environment digest, and tool version. The reducer map is in-memory per invocation (59-86), so no current cross-process or cross-commit reuse was found. The digest assembled in shrink.ts:1375-1385 and ast-shrink.ts:426-436 omits PATH, lockfile/toolchain state, arbitrary environment, Git configuration, runner image, and repository root. packages/core/src/pro.ts:218-224 exposes only a policy cache key, not an active cache.

Mitigation: keep caches run-local; any future persistence must include repository/tree, patch, command/order, lockfile/toolchain/environment/image/Git identity, schema version, and must never bypass final verification. Open LOW; not a P1 blocker.

### ER-008 — LOW — history/co-change and LLM signals are non-authoritative

packages/scope/src/analyze.ts:713-746 marks history/memory weak and limits them to ranking. packages/cli/src/scope-analysis.ts:287-295 says local history/merged-PR facts are not computed. packages/intent/src/normalize.ts:413-447 records llmRequested but always returns llmUsed: false and emits llm-not-authoritative. Scope classifications require the runtime oracle (packages/scope/src/analyze.ts:415-418).

No active history/co-change or LLM oracle path was found. Preserve these limits for future integrations. Resolved in current control flow; monitor future changes.

### ER-009 — LOW — SCIP, semantic-diff, and mutation adapters remain quarantined

ADR-CODE-INTELLIGENCE-001 keeps SQLite default and SCIP/Joern optional research; ADR-SEMANTIC-CHANGE-001 keeps GumTree/RefactoringMiner advisory/research-only; ADR-MUTATION-ORACLE-001 keeps mutation in benchmark mode. No runtime imports or execution paths for SCIP, Joern, GumTree, RefactoringMiner, Stryker, or PIT were found.

Resolved/safe as currently implemented. Adoption still requires the specified fixture, ground-truth, cost, precision/recall, and final-verification evidence.

## Control checks

| Safety question | Conclusion |
| --- | --- |
| Could research-derived deletion strategies create unsafe deletion? | ddmin/HDD/WDD/ProbDD/CDD/LPR remain research-only; executable candidate, combined, and final verification remain mandatory. ER-001/ER-002 can corrupt evidence under parallelism and were fixed/rechecked. |
| Could fail-closed behavior weaken? | Required command, inconclusive, tree-identity, and final artifact gates exist. Unsupported combined forms are now rejected and preserved; natural getDiff coverage remains a MEDIUM gap. |
| Could graph absence be treated as dependency absence? | Scope guards incomplete graphs, but changed-only AST graph completeness is overstated (ER-004). |
| Could a heuristic become authority? | Parser/AST grouping, weights, history, memory, semantic labels, and LLM request state do not authorize removal. |
| Could an LLM become an oracle? | No. LLM normalization is recorded as requested but not executed. |
| Could historical co-change become authority? | No history is computed locally; fields are weak/ranking-only. |
| Could targeted tests replace full verification? | No current bypass; full required final verification is mandatory. |
| Could cache reuse cross commit/environment boundaries? | No current persistent reuse; future persistence must expand identity as ER-007 requires. |
| Could unsupported Git forms silently disappear? | No for detected combined forms: they are rejected, retained as rawSection, routed to human review, and re-emitted byte-for-byte. A natural getDiff fixture remains a MEDIUM coverage gap. |

## P1 decision

P1 experiments are PERMITTED BY THIS ENGINEERING REVIEW.

ER-001, ER-002, and ER-003 are resolved and independently rechecked. No engineering CRITICAL/HIGH finding blocks reducer comparison, syntax-candidate, SCIP, mutation-oracle, or targeted-first experiments.

Before P1 begins:

1. Keep parser raw-preservation and human-review tests in the required regression suite.
2. Resolve or explicitly bound ER-004 and add the ER-006 E4 integration cases.
3. Keep full required verification and artifact tree identity mandatory in every experiment.
4. Preserve the separate research/status gates before promoting any experiment or runtime change.

No CRITICAL finding was established in this pass. The engineering gate is closed for P0-D; P1 is permitted by engineering safety review, while research completeness and STATUS.yaml authorization remain separate controls.


## Final ER-003 recheck

The new parser-side mitigation was inspected and targeted tests were reviewed:

- packages/core/src/diff.ts:27-42 detects diff --cc, diff --combined, and @@@ before normal parsing, returns unsupported metadata, and retains the complete input in rawSection.
- packages/core/src/diff.ts:369-375 re-emits rawSection byte-for-byte for unsupported files.
- packages/core/src/types.ts:20-27 and 49-54 carry unsupported status, reason, raw bytes, and top-level diagnostics.
- packages/core/src/shrink.ts:567-571 marks an unsupported parse partial; getConservativeSkipEvaluation at 2630-2643 routes it to needs-human-review.
- tests/unit/diff.test.ts:27-50 verifies detection, reasons, and exact parser round-trip; tests/unit/shrink-safety.test.ts:721-732 verifies conservative human-review routing.

The previous buildKept gap is resolved: packages/core/src/shrink.ts:793-809 now retains zero-hunk files when file.unsupported or rawSection is present, in addition to extendedHeaders. The unsupported raw bytes therefore reach serializeUnifiedDiff and are re-emitted verbatim.

Targeted evidence is present: tests/unit/diff.test.ts:27-50 verifies detection, reasons, and exact parser round-trip; tests/unit/shrink-safety.test.ts:721-732 verifies conservative human-review routing; the parser suite reports 38/38 passing, and the related typecheck/targeted checks were reported passing. The only remaining coverage limitation is that a natural getDiff-produced combined-diff fixture is not present; the parser API and shrink safety path are directly covered. This is a MEDIUM coverage limitation, not a remaining HIGH finding.

ER-003 is RESOLVED AND RECHECKED. ER-001 and ER-002 remain resolved and rechecked. The engineering/safety gate has no unresolved CRITICAL/HIGH finding; P1 is permitted by this review, subject to the separate research/status gates.

P1 is permitted by this engineering review.



