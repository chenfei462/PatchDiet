# Provisional injected-fixture review

Measured 2026-10-06 on the current 0.1.1 development build. This is a three-case reviewer subset, not the complete release benchmark.

| Fixture | Automatically removed statements | Labelled safe removals | Independent final oracle | Shrink wall time |
|---|---:|---:|---|---:|
| js-mixed-semantic | 2 | 2 | passed | 3.5 s |
| python-mixed-semantic | 2 | 2 | passed | 3.94 s |
| typescript-mixed-semantic | 2 | 2 | passed | 7.64 s |

Subset statement precision: 6/6. Scope-violation hit rate: 3/3. Independent final-oracle pass rate: 3/3. Known labelled behavior regressions: 0 in these three cases.

The input labels precede reduction. Every remaining nonblank line, including indentation, is compared with the pinned HEAD after removing only labelled debug statements. Blank separators retained by the AST encoder are allowed in these simple fixtures without multiline strings. Each exact cleanup patch is applied to a clean BASE worktree and tested independently; its tree hash must match the recorded evidence.

Natural agent PRs: sample count 0, precision NOT VERIFIED. No inference about general real-world precision, customer adoption or large-repository performance is justified.

Release: NOT APPROVED. Remaining runtime controls, a broader reproducible release corpus and final delivery documentation are still pending.

Machine context: Windows, Node 24.15.0; TypeScript fixture invokes the explicit development compiler and Python fixture invokes the installed Python runtime. Separate Node 20 production-tarball smoke verification passed.

See cli-v02-injected-review-results.json and cli-v02-benchmark-methodology.md for raw measurements and limits.
