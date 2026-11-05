# Authoritative Research Synthesis

SUPERSEDED HISTORICAL REPORT. Its verification, distillation, safety and performance assessments are not authoritative. See `../STATUS.yaml`, `SOURCE_REGISTRY_AUDIT.md`, `REPOSITORY_LICENSE_REVIEW.md` and `SOURCE_CORRECTIONS.md`. Statements below are retained for audit history and require independent re-derivation. In particular, determinism alone does not make a reducer safer; no strategy advantage has been demonstrated on PatchDiet workloads.

## Executive Summary

PatchDiet already has the central safety boundary required by the research: a candidate is acceptable only after the configured executable verification path succeeds. The current repository also contains deterministic reduction, explicit `INCONCLUSIVE` handling, context-keyed caching, AST/symbol grouping, targeted-first verification, and Git-aware diff parsing. The first research pass records these as existing evidence rather than reimplementing them.

The strongest decisions are to keep deterministic reduction as the runtime baseline, treat syntax and semantic analysis as candidate and scope evidence, preserve a mandatory full verification gate after targeted tests, and keep mutation testing, SCIP, GumTree, RefactoringMiner, and stochastic reduction in benchmark or adapter mode until PatchDiet workloads demonstrate value. Git documentation is the fidelity authority; NIST SSDF informs provenance and runner controls; benchmark datasets inform evaluation design rather than product claims.

## Research Method

Sources were located at canonical project, standards, or paper URLs on 2026-10-26. Repository metadata and license identifiers were checked through the official GitHub repository pages/API where available. Records distinguish paper-era findings from current project state. Claims are atomic and include assumptions, limitations, PatchDiet mapping, and `automatic_removal_authority: false`. Unresolved seed sources are registered as `NOT_VERIFIED` rather than guessed.

The observed repository HEAD was `a57b27eeea6d6d3c7ad581334dba10830b7f4730`, while the protocol baseline is `2a02dad9cd1859c9b7c232c5a4b67446bf004d89`. The worktree already contained uncommitted takeover changes; those changes were preserved.

## Source Quality Model

Tier A contains normative specifications and original peer-reviewed research. Git diff/apply documentation, NIST SP 800-218, the SARIF 2.1.0 standard, the Perses ICSE paper, the Rothermel/Harrold regression-selection paper, and the Microsoft and Google review studies are Tier A. Tier B contains reference implementations such as Tree-sitter, C-Reduce, Picire, GumTree, RefactoringMiner, SCIP, StrykerJS, reviewdog, Harden-Runner, and Scorecard. Tier C contains benchmark datasets such as SWE-bench. Tier D vendor claims are excluded from scientific conclusions.

Reference implementations establish useful architecture patterns and edge cases, not scientific truth. Benchmark results are reported within their task distribution. Runtime repository knowledge remains in `.patchdiet/knowledge.sqlite`; research records remain under `knowledge/research/`.

## Program Reduction

The classic ddmin model remains the safest baseline because its behavior is deterministic and its oracle boundary is easy to audit. PatchDiet's current reducer already uses deterministic ordering, context-aware cache keys, and `INCONCLUSIVE`, so the appropriate next step is a benchmark rather than a rewrite.

Perses supports the claim that syntax-guided candidates can avoid oracle calls on invalid variants. The limitation is direct: syntax validity is not semantic equivalence, and the result depends on parser coverage and oracle quality. PatchDiet should measure parse rejection rate and oracle savings before making syntax-guided filtering the default.

C-Reduce and Picire reinforce explicit interestingness-test abstraction, isolated candidate execution, complement testing, cache keys, and bounded parallelism. Their code is not copied; C-Reduce and Picire repository license metadata require additional review before reuse.

Weighted, probabilistic, and counter-based strategies are search policies. They can improve time to a useful candidate but do not alter removal authority. They remain research-only until a benchmark demonstrates higher removal precision or lower verification cost with deterministic traces and fixed or recorded seeds.

## Semantic Diff

Git metadata and patch text remain the first source of truth. Tree-sitter provides structural units and changed ranges, but its error-tolerant parse is only syntax evidence. GumTree's insert/delete/update/move actions and RefactoringMiner's rename/move/extract/inline vocabulary are useful for grouping and explanation. They remain evidence adapters because matching heuristics can misclassify code and because JVM integration cost is currently unmeasured.

PatchDiet should use a layered model: text and Git metadata, parser-derived structure, optional semantic/refactoring evidence, then executable verification. A detected rename or refactoring cannot authorize deletion.

## Program Slicing / Change Impact

Program slicing and change-impact analysis can narrow candidate groups and prioritize tests when symbol and dependency graphs are available. The limitation is graph completeness: dynamic dispatch, reflection, generated code, unresolved imports, and stale indexes produce false negatives. Graph absence means unknown and cannot mean unused.

The current lightweight SQLite graph is a sensible default. An optional SCIP import prototype should be evaluated on index time, index size, symbol/reference precision, incremental updates, monorepos, Windows, and CI setup before any dependency change.

## Code Intelligence

SCIP offers stable symbol and occurrence records across language indexers. Joern's AST/CFG/data-flow/code-property-graph model is richer but carries significant installation and operational cost. The code-intelligence ADR keeps SQLite by default, proposes an optional SCIP adapter experiment, and marks Joern research-only.

## Regression Test Selection

Rothermel and Harrold provide the primary safe-selection basis for targeted-first execution when the full required verification remains mandatory. Targeted tests optimize candidate search and feedback; they do not establish final validity. PatchDiet already has targeted mapping and path-to-test configuration. The next evidence is hidden-regression rate across synthetic, human, and agent fixtures.

## Mutation Testing

StrykerJS and mutation-testing literature support killed/survived/equivalent classification and mutation score as a test-adequacy signal. Equivalent mutants and survivor sampling limit interpretation. PatchDiet should run mutation audits in benchmark or design-partner mode, surface `WEAK_ORACLE` as a confidence limitation, and keep the final wording `Verified against configured checks.`

## Modern Code Review

Microsoft and Google case studies show that review supports comprehension, knowledge transfer, defect finding, and scalable tool-assisted routing. Reviewdog demonstrates provider abstraction, diff filtering, and line-level annotations. Those patterns improve routing and evidence transport. They do not establish finding correctness. The required 2026 LLM reviewer reliability source remains unresolved until a primary paper is identified; LLM reviewer output remains advisory.

## AI Coding Agents

SWE-bench provides a useful task bundle shape: issue, base commit, patch, isolated environment, and grading tests. Its success scores do not measure unnecessary-change removal, so PatchDiet must report `NECESSARY`, `UNNECESSARY`, and `UNCERTAIN` labels separately. SWE-rebench, SWE-bench Live, and AIDev are registered as `NOT_VERIFIED` pending primary-source checks.

## Benchmark Methodology

PatchDiet benchmark families must stay separate: synthetic injected noise, real human patches, real agent patches, and fresh repository tasks. Required labels are `NECESSARY`, `UNNECESSARY`, and `UNCERTAIN`. Required metrics include removal precision/recall, scope precision/recall, final validation pass rate, hidden regression rate, human review rate, diff and semantic reduction, oracle calls, runtime, and cache hit rate. Removal Precision is the highest-priority safety metric.

## Git/Patch Semantics

The Git diff-format documentation covers new/deleted files, modes, copies, renames, similarity/dissimilarity, quoted paths, binary sections, and combined diffs. Combined diffs describe a merge relative to multiple parents and cannot be applied as a sequence of independent two-way changes. Git-apply success proves patch fidelity only; it does not prove required behavior.

The current parser already captures many extended headers, binary payloads, no-newline markers, quoted paths, and rename/delete entries. PD-R050 adds an explicit fixture matrix and Git application audit for symlinks, submodules, combined diffs, and mode/type changes.

## Security / Supply Chain

NIST SSDF supports documented provenance, protected build processes, and response practices. Harden-Runner provides a useful model for runner telemetry and network-egress observation around untrusted verification. OpenSSF Scorecard provides heuristic project-posture evidence. None is a deletion proof. Security work remains defense in depth around candidate execution and reporting.

## Open-Source Project Comparison

Perses is the most relevant reduction reference but is GPL-3.0 and JVM-oriented. C-Reduce and Picire provide oracle and scheduling patterns with license metadata requiring review. Tree-sitter is MIT and already informs PatchDiet parsing. GumTree and RefactoringMiner provide structural evidence but add JVM and language-scope cost. SCIP is Apache-2.0 and suitable for an optional adapter experiment. StrykerJS is Apache-2.0 and suitable as an external benchmark tool. reviewdog is MIT and offers report-transport patterns. SWE-bench is MIT and offers reproducible task-bundle patterns.

## What PatchDiet Already Does Correctly

- Keeps executable verification as the only removal authority.
- Preserves `INCONCLUSIVE` instead of treating it as success.
- Uses context-aware cache keys and deterministic group ordering.
- Includes AST, symbol, dependency, targeted verification, and Git-aware evidence layers.
- Separates targeted-first search from required full verification.
- Records safety and review evidence in artifacts and reports.

## What PatchDiet Should Change

- Add a complete Git fidelity fixture and application matrix (PD-R050).
- Benchmark reducer strategies and syntax filtering before changing defaults (PD-R002, PD-R003).
- Benchmark optional SCIP import against the current SQLite graph (PD-R020).
- Add benchmark-only mutation oracle audits with explicit confidence wording (PD-R040).
- Keep benchmark fixture families and ground-truth labels separate (PD-R061).

## What PatchDiet Should NOT Change

- Do not make syntax validity, static analysis, history, semantic matching, mutation score, or LLM confidence delete permission.
- Do not replace the lightweight graph with SCIP or Joern without measured benefit.
- Do not embed Perses, GumTree, or RefactoringMiner JVM runtimes in the MVP without a workload benchmark.
- Do not label targeted-only verification as final `VERIFIED`.
- Do not claim semantic equivalence from configured checks.

## Research → Architecture Mapping

The mapping matrix in `knowledge/research/mappings/component-matrix.md` connects DiffParser, PatchEncoder, AstAtomizer, ScopeEngine, EvidenceGraph, KnowledgeStore, CandidateGenerator, Reducer, VerificationEngine, TargetedVerification, FeedbackRanking, GitHubAction, GitHubApp, and BenchmarkHarness to claims, projects, decisions, tickets, and validation.

## Research → Ticket Mapping

PD-R001 creates and validates the registry. PD-R002 and PD-R003 measure reducer and syntax strategies. PD-R010 evaluates semantic change evidence. PD-R020 evaluates optional SCIP import. PD-R040 audits oracle strength. PD-R050 audits Git fidelity. PD-R030, PD-R061, PD-R070, PD-R080, and PD-R090 remain follow-on tickets from the protocol and current repository gaps.

## Open Questions

- Which hidden regression rate does targeted-first verification achieve on real agent patches?
- Does syntax-guided filtering reduce oracle calls enough to offset parsing overhead on supported languages?
- Does optional SCIP import improve cross-file precision on Windows and monorepos?
- Which primary 2026 LLM reviewer reliability study should be registered?
- Which SARIF fields map cleanly to PatchDiet evidence without implying correctness?
- Can mutation audits be bounded tightly enough for design-partner use?

## Rejected Ideas

A vector database, generic RAG layer, chat UI, general-purpose AI reviewer, custom foundation model, massive CPG service, and multi-tenant platform are outside the measured PatchDiet objective. They do not improve removal precision or scope evidence based on current repository evidence.

## Full Source Registry

The canonical index is `knowledge/research/registry.yaml`. It currently contains 20 source records, 21 atomic claims, 11 algorithm cards, 10 project cards, six benchmark cards, four ADRs, and seven research tickets. SWE-rebench, SWE-bench Live, and AIDev remain explicitly marked `NOT_VERIFIED` where primary-source review remains incomplete.



