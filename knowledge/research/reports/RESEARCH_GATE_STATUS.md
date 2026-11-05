# Research gate status

Date: 2026-10-27 (America/Los_Angeles). Baseline HEAD: a57b27eeea6d6d3c7ad581334dba10830b7f4730. Reopened for PD-R150–159. This table does not grant experiment authority.

Current state: RESEARCH_DISTILLATION_PARTIAL / ENGINEERING_EVIDENCE_NOT_YET_CLOSED / RESEARCH_PARTIAL.
Experiment gate: EXPERIMENTS_NOT_PERMITTED. Runtime research-derived changes adopted: 0.

| Requirement | Current state | Evidence | Blocking issue | Required action | Final reviewer status |
| --- | --- | --- | --- | --- | --- |
| WDD source/license | IN_REVIEW | sources/program-reduction/wdd-artifact.yaml | GitHub and Zenodo license scopes conflated in existing verified record | PD-R151 separate provenance layers | PENDING |
| 2026 LLM reviewer reliability study | IN_REVIEW | sources/code-review/paper-llm-reviewer-reliability-2026-unidentified.yaml | Named registry entry conflicts with unidentified coverage report | PD-R152 exact identity or removal from evidence chain | PENDING |
| SCIP TypeScript | IN_REVIEW | projects/project-scip-typescript.yaml | Fixed snapshot/license/requirements pending | PD-R153 | PENDING |
| SCIP Python | IN_REVIEW | projects/project-scip-python.yaml | Fixed snapshot/license/requirements pending | PD-R153 | PENDING |
| SCIP Java | IN_REVIEW | projects/project-scip-java.yaml | Fixed snapshot/license/requirements pending | PD-R153 | PENDING |
| Joern | IN_REVIEW | projects/project-joern.yaml | Pin/license/runtime scope pending | PD-R154 | PENDING |
| ast-grep | IN_REVIEW | projects/project-ast-grep.yaml | Pin/license scope pending | PD-R154 | PENDING |
| Semgrep | IN_REVIEW | projects/project-semgrep.yaml | Engine/rules/commercial scope pending | PD-R154 | PENDING |
| CodeQL | IN_REVIEW | projects/project-codeql.yaml | CLI terms distinct from query repository | PD-R154 | PENDING |
| PIT | IN_REVIEW | projects/project-pit.yaml | Pin/license/implementation scope pending | PD-R155 | PENDING |
| mutationtesting.uni.lu | IN_REVIEW | sources/mutation-testing/paper-mutation-testing-survey-2018.yaml | Theory page distinct from academic survey | PD-R155 | PENDING |
| SWE-rebench | IN_REVIEW | benchmarks/benchmark-swe-rebench.yaml | Dataset version/terms/sampling pending | PD-R156 | PENDING |
| SWE-bench Live | IN_REVIEW | benchmarks/benchmark-swe-bench-live.yaml | Dataset version/terms/sampling pending | PD-R156 | PENDING |
| AIDev | IN_REVIEW | benchmarks/benchmark-aidev.yaml | Dataset rights/privacy/redistribution pending | PD-R156 | PENDING |
| CodeReviewQA | IN_REVIEW | benchmarks/benchmark-codereviewqa.yaml | Publication/artifact/data-use pending | PD-R156 | PENDING |
| PR-Agent | IN_REVIEW | projects/project-pr-agent.yaml | Snapshot/license pending | PD-R157 | PENDING |
| Alibaba OpenCodeReview | IN_REVIEW | projects/project-alibaba-open-code-review.yaml | Snapshot/license pending | PD-R157 | PENDING |
| Danger JS | IN_REVIEW | projects/project-danger-js.yaml | Snapshot/license pending | PD-R157 | PENDING |
| libgit2 | IN_REVIEW | projects/project-libgit2.yaml | Snapshot/license/exception pending | PD-R157 | PENDING |
| gitoxide | IN_REVIEW | projects/project-gitoxide.yaml | Snapshot/license scope pending | PD-R157 | PENDING |
| OpenSSF Baseline | IN_REVIEW | sources/security/standard-openssf-baseline-current.yaml | Current version/date publication pending | PD-R157 | PENDING |
| Git normative support matrix | IN_REVIEW | mappings/git-diff-support-matrix.md | Exact row citations/test references and dissimilarity gap | PD-R158 | PENDING |
| D1-D7 validation | IN_REVIEW | reports/RESEARCH_INTEGRITY_VALIDATION.json | Missing gates and inconsistent provenance exposed by stronger checks | PD-R159 reconcile honestly | PENDING |
| Independent research re-review | NOT_STARTED | reports/INDEPENDENT_RESEARCH_REVIEW_V2.md (required output) | Await stable evidence and regression | Fresh independent decision | PENDING |

The integrity validator distinguishes internally consistent partial research from completed distillation. Explicit FAIL states remain visible and cannot be converted to experiment authority by a clean schema/reference report. No external dataset is imported. REAL_HUMAN_PR_COUNT = 0; REAL_AGENT_PR_COUNT = 0; FRESH_TASK_COUNT = 0.
# Research gate status update — 2026-10-27

The strengthened validator now returns `RESEARCH_INTEGRITY_VALIDATED`, `errors = 0`, `warnings = 0`, with `unresolved_gates = 51`. This means the registry is internally consistent and the required provenance/reference checks run; it does not mean the research set is complete or authorize experiments.

The dataset legal gate is `HOLD` for SWE-rebench, SWE-bench Live, AIDev and CodeReviewQA. No rows were imported. WDD artifact GitHub code licensing and Zenodo component applicability remain unresolved. Current experiment gate remains `EXPERIMENTS_NOT_PERMITTED` pending the independent V2 review and full regression closure.

## Fresh independent review result

`reports/INDEPENDENT_RESEARCH_REVIEW_V2.md` issued the required fresh verdict: **EXPERIMENTS_NOT_PERMITTED**. Blocking findings are RG2-H-001 through RG2-H-004: unresolved mandatory source gates, WDD license scope, dataset legal HOLD, and an unclosed full regression. No authorization file is permitted.
