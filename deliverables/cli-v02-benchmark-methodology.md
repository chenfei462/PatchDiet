# CLI v0.2 benchmark review contract

This document defines acceptance checks; it contains no measured results. Implement and run the reproducible benchmark before recording a result. A successful unit test run is not a precision measurement.

## Corpus and labels

Keep three corpus classes separate:

1. Synthetic adversarial Git histories: mutually redundant changes, dependent edits, flaky oracle, malformed syntax, unsupported metadata, and cross-file dependencies.
2. Injected task fixtures: TypeScript/JavaScript and Python tasks containing a known required behavior change and known unrelated additions. Label the atoms before reduction; retain the original input files, base/head SHA and label file with each result.
3. Human-labelled natural agent PRs: unavailable. The user confirmed that no such dataset is available. Record this class as NOT VERIFIED, with sample count 0; do not substitute injected fixtures or claim production precision.

Label every assessed edit necessary, unnecessary or uncertain. Labels must describe original changed bytes or stable atom identity, independent of the reducer verdict. A task-required change that a weak oracle fails to test remains necessary. An automatically removed uncertain edit is not a proven-safe deletion and must not count as a true positive.

## Measurements

For each available corpus class record actual input count, atom label counts, automatic removals, safe automatic removals, false or uncertain removals, necessary edits retained, scope violations found, and elapsed time. Show numerator and denominator next to each rate.

Removal precision = benchmark-labelled unnecessary atoms automatically removed / all assessed atoms automatically removed. A zero denominator is undefined, not 100%. Avoid double-counting an atom represented in multiple report sections or dependency groups. An unlabelled removal fails the label-coverage gate.

Scope-violation hit rate = fixtures with at least one confirmed unnecessary change found / labelled fixtures containing at least one unnecessary change. Report detection and actual deletion separately. Keep conservative retained/uncertain cases visible.

Final-oracle pass rate = delivered artifacts independently passing the configured full required checks / all artifacts advertised as verified. Materialize each exact cleanup.diff on a clean worktree at the recorded base SHA, then independently execute the required commands and compare the resulting tree SHA with the recorded final evidence. The producer's status field alone is insufficient evidence.

Hidden regressions = known necessary labeled behaviors broken by artifacts advertised as verified, checked with a held-out behavior oracle. Report weak-oracle cases explicitly. Do not claim semantic equivalence from passing configured tests.

Record wall-clock timing per case and the actual machine/runtime; do not infer large-repository speed or compare with an unmeasured baseline. Performance targets are observations on this corpus, not customer outcomes.

## Gates

Available labelled corpus: precision at least 98%, zero known hidden regressions, 100% independent final-oracle pass rate, and nonzero positive reduction cases. Synthetic/injected hit-rate target is at least 80%; publish its sample count and composition.

Natural agent PR precision: NOT VERIFIED until genuine human-labelled PR data is supplied and assessed. No aggregate benchmark may hide the missing class. Local functionality acceptance and release approval must be recorded separately.

Retain per-case JSON, input patch, labels, emitted cleanup patch, command outcomes, hashes and summary under a documented output directory. The runner must fail nonzero when an applicable gate fails. Use unique owned scratch directories and bounded awaited cleanup; never erase arbitrary repositories or pre-existing benchmark results.
