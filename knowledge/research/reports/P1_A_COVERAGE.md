# P1-A mandatory research coverage

Date: 2026-10-26. This report records the continuation pass after P0-C. It separates capability evidence from PatchDiet benefit claims. `SOURCE_PARTIALLY_VERIFIED` means a primary page or documentation was inspected but the fixed repository/license/data-use gate is still open.

| Area | Records added | Evidence | Decision | Open gate |
| --- | --- | --- | --- | --- |
| SCIP indexers | `project:scip-typescript`, `project:scip-python`, `project:scip-java` | Official repository/documentation pages describe language and install/build behavior | `RESEARCH_ONLY` | Fixed commit, root license, Windows/CI and precision comparison |
| Joern | `project:joern` | Official CPG docs and repository describe AST/CFG/data-flow/CPG/query model and JDK 21 requirement | `RESEARCH_ONLY` | Fixed commit/license and bounded workload comparison |
| ast-grep | `project:ast-grep` | Official docs describe AST structural search/rewrite/lint and language coverage | `RESEARCH_ONLY` | Fixed repository/license and candidate experiment |
| Semgrep | `project:semgrep` | Official rule syntax and repository docs describe pattern matching, propagation and data-flow boundaries | `RESEARCH_ONLY` | Version/license terms and structural/dataflow precision comparison |
| CodeQL | `project:codeql` | Official docs establish QL query and code-scanning model | `RESEARCH_ONLY` | Terms, version, query/data-flow scope and integration cost |
| PIT | `project:pit` | Official basic-concepts docs describe mutant execution and equivalent-mutation limits | `RESEARCH_ONLY` | Repository pin and JVM fixture audit |
| Mutation literature | `paper:mutation-testing-survey-2018` | University of Luxembourg theory page records CPH, coupling, human oracle and equivalence problems | `RESEARCH_ONLY` | Original survey primary text and citation pin |
| SWE-rebench | `benchmark:swe-rebench` | Official organization and repository pages describe automated collection/decontamination | `RESEARCH_ONLY` | Exact release/task snapshot and terms |
| SWE-bench-Live | `benchmark:swe-bench-live` | Official site and primary paper describe live updates, Docker, multiple languages/OS and curation | `RESEARCH_ONLY` | Data license, snapshot and reproducible sample |
| AIDev | `benchmark:aidev` | Primary arXiv metadata reports dataset scale, agent labels and repository scope | `RESEARCH_ONLY` | Dataset license/privacy/redistribution and legal sample plan |
| CodeReviewQA | `benchmark:codereviewqa` | Primary arXiv record establishes review-comprehension benchmark purpose | `RESEARCH_ONLY` | Full paper, artifact, languages/sample/terms |
| 2026 reviewer reliability | `paper:llm-reviewer-reliability-2026-unidentified` | Requirement names a study without bibliographic identity | `RESEARCH_ONLY` | Title/authors/DOI/URL required before any claim |
| PR tooling | `project:pr-agent`, `project:alibaba-open-code-review`, `project:danger-js` | Records created from required source URLs; no fixed verification asserted | `RESEARCH_ONLY` | Pin, license, architecture and output-flow inspection |
| Git libraries | `project:libgit2`, `project:gitoxide` | Records created from required source URLs; no replacement proposal | `RESEARCH_ONLY` | Pin, license, diff/tree/mode/path behavior inspection |
| OpenSSF baseline | `standard:openssf-baseline-current` | Current official URL recorded | `RESEARCH_ONLY` | Fresh version/date/control-group inspection |

No new runtime dependency or experiment was introduced. The registry intentionally remains partial. A source card is not a claim card, and a project README is not a benchmark result.

## Required comparison dimensions

The SCIP comparison must create separate rows for TypeScript, Python and Java and measure install complexity, Windows, CI, monorepo/incremental behavior, output size, symbol precision, reference precision, index time and cold start against the current SQLite graph. The Joern decision remains `RESEARCH_ONLY` unless a bounded fixture demonstrates value at acceptable operational cost.

The static-analysis comparison must keep structural pattern matches, static findings, data-flow results and semantic proofs as separate output types. None is a removal oracle. The mutation lane must use tool-native mutant states and manual suspected-equivalent review; it must not turn mutation score into deletion authority.

The dataset lane must keep synthetic, human-authored, agent-authored and fresh-task data separate. `REAL_HUMAN_PR_COUNT = 0` and `REAL_AGENT_PR_COUNT = 0` remain the honest local status until a legal and reproducible sample is imported.
