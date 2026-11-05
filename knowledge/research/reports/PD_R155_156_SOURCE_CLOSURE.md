# PD-R155 / PD-R156 Source Closure

Date: 2026-10-27. This pass separates mutation implementation, mutation theory, benchmark publication, dataset rights and PatchDiet conclusions.

## Mutation records

- `project:pit`: exact GitHub commit `f7fe5adfa5fb6e727c12d2403a48f5e4e9dd2fc6`, commit date `2026-10-14T07:18:34Z`, root `LICENSE.txt`, Apache-2.0. This is a JVM implementation record. It does not establish TypeScript suitability or deletion authority.
- `project:strykerjs`: implementation record and claims remain separate from mutation theory. Tool-native states include more than killed/survived; suspected equivalence remains manually labelled.
- `paper:mutation-testing-survey-2018`: legacy identifier retained, publication year corrected to 2019; DOI suffix/copyright year are not the publication year. The accepted manuscript and publisher metadata are separately recorded.
- `paper:mutation-testing-survey-2011`: author technical report and 2011 journal metadata are linked but not asserted byte-identical.
- `source:mutationtesting-uni-lu`: theory/bibliography navigation source, partially verified, no explicit reuse license. It is not treated as the original paper.

Mutation score remains an audit signal for configured verification strength. Equivalent mutants, coupling-effect limits and operator bias remain explicit. No mutation mode was added to normal shrink.

## Benchmark records

SWE-rebench, SWE-bench Live, AIDev and CodeReviewQA have primary publication/metadata cards with snapshot, methodology and known freshness/contamination limitations. Task/repository headline counts are omitted where the current primary snapshot does not support a stable count. Dataset legal gate is recorded in `DATASET_USAGE_REVIEW.md` and remains HOLD; no import occurred.

## D1–D7 and decision

Mutation and benchmark cards carry explicit D1–D7 forms. `D6_NOT_APPLICABLE` and `D7_NOT_APPLICABLE` are justified for research-only records with no implementation. Any source with unresolved license or data-use scope retains `SOURCE_PARTIALLY_VERIFIED` and D1 FAIL. Decision: `RESEARCH_ONLY`; no PD-E ticket and no runtime adoption.
