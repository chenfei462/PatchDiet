# Independent Research Review V2

Review date: 2026-10-27 (America/Los_Angeles)
Reviewer: fresh RG-2 review against the current working tree, performed after PD-R150–159 evidence reconciliation; this decision does not reuse the prior `INDEPENDENT_RESEARCH_REVIEW.md` verdict.

## Verdict

**EXPERIMENTS_NOT_PERMITTED**

No `EXPERIMENT_AUTHORIZATION.json` is created. The research state remains `RESEARCH_PARTIAL`; the experiment gate remains `EXPERIMENTS_NOT_PERMITTED`.

## Review method

I independently checked the current registry and source-card paths, the strengthened validator output, the adversarial validator tests, the reduction algorithm cards, the WDD and reviewer-study closure report, the mutation and benchmark closure report, the dataset usage gate, the Git support matrix, and the fresh regression evidence. I asked whether each primary source supports its claim, whether a repository was being used as a paper, whether a later analysis was being used as an original algorithm, whether a neighboring license was being transferred, whether dataset rights were actually established, whether benchmark numbers had primary support, and whether syntax/static evidence was being treated as removal proof.

## Gate evidence

| Check | Result | Review consequence |
| --- | --- | --- |
| Integrity validator | `RESEARCH_INTEGRITY_VALIDATED`, errors=0, warnings=0 | Internal consistency prerequisite passes; this is not research completion. |
| Unresolved D1–D7 states | 51 | Mandatory research items remain incomplete or explicitly failed. |
| Dataset usage review | HOLD for SWE-rebench, SWE-bench Live, AIDev, CodeReviewQA | No import, redistribution or real-data lane is authorized. |
| WDD GitHub/artifact provenance | Partial | Root GitHub license is absent; Zenodo resource declaration, metadata default and supplied GPL text lack component applicability mapping; Docker digest/reproduction remain unavailable. |
| 2026 reviewer-reliability study | Identified and bounded | Study findings are limited to its datasets/models and do not authorize deletion or replace executable verification. |
| Git normative matrix | Bounded and cited | Dissimilarity, quoted-path, symlink/gitlink and combined-diff boundaries remain safety evidence, not semantic proof. |
| Fresh regression | Not closed | Earlier full run failed with Action timeouts and a CLI dry-run timeout; a later full Action rerun stalled. Typecheck/build and focused validator/diff tests pass. |

## Blocking findings

| ID | Severity | Affected record | Exact defect | Required correction |
| --- | --- | --- | --- | --- |
| RG2-H-001 | HIGH | All mandatory P1-A partial source cards: SCIP indexers, Joern, ast-grep, Semgrep, CodeQL, PIT-related scope, PR/Git/security projects | The registry is internally consistent, but 51 D1–D7 gates remain unresolved or failed; a clean validator cannot convert missing primary/license/runtime evidence into completion. | Finish each card with exact inspected snapshot, license scope, runtime/Windows/CI facts, claims, limitations and justified D1–D7 terminal states, then repeat independent review. |
| RG2-H-002 | HIGH | `project:wdd-artifact`, WDD GitHub and Zenodo records | GitHub snapshot has no root project license. Zenodo has a deposited-resource CC-BY declaration and a separately supplied GPL-v3 file; their component applicability is not mapped. | Obtain an authoritative component/license mapping or retain the artifact as partial and exclude code reuse/import from any experiment. |
| RG2-H-003 | HIGH | `benchmark:swe-rebench`, `benchmark:swe-bench-live`, `benchmark:aidev`, `benchmark:codereviewqa` | Dataset-level metadata does not grant repository-level code rights, privacy permission or redistribution permission. The usage gate is correctly HOLD. | Complete selected-record licensing, privacy minimization, storage/deletion, sampling and reproducibility review before import. |
| RG2-H-004 | HIGH | Research/engineering handoff | Fresh full regression is not passing: the saved full run contains two Action timeouts and one CLI dry-run timeout; the subsequent full Action run stalled. | Diagnose and rerun the complete required regression. Do not claim engineering closure or runtime adoption until it passes. |
| RG2-M-001 | MEDIUM | Mutation theory and implementation cards | Mutation score, surviving mutants and static findings are correctly bounded, but they remain research evidence about configured verification strength, not semantic adequacy. | Preserve manual suspected-equivalent labels and no automatic-removal authority in any future experiment. |
| RG2-M-002 | MEDIUM | Git support matrix | The matrix has normative citations and bounded tests, but unsupported combinations and final application coverage remain explicit gaps. | Add only true missing fixtures and retain fail-closed behavior for unsupported forms. |

## D1–D7 review

Verified primary/repository records carry required provenance fields. Partial records retain `SOURCE_PARTIALLY_VERIFIED` or D1 `FAIL`. Claims retain limitations, PatchDiet mappings and `automatic_removal_authority=false`. Research-only records use justified `D6_NOT_APPLICABLE` and `D7_NOT_APPLICABLE`; those values do not authorize an experiment. No runtime ticket is permitted from the unresolved findings above.

## Authorization decision

The validator prerequisite passes, but mandatory source, license, dataset-use and regression blockers remain. Therefore the only valid fresh reviewer output is:

**EXPERIMENTS_NOT_PERMITTED**

Experiments, external dataset imports, runtime research-derived changes and `EXPERIMENT_AUTHORIZATION.json` remain prohibited.
