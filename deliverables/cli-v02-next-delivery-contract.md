# Remaining local CLI MVP delivery contract

This is an implementation/review checklist, not a completion or benchmark result. Public interface corrections must pass before their integration.

## Repository-contained labelled benchmark

Implement a documented reproducible runner and input/label fixtures in the repository. Cover JavaScript, TypeScript and Python mixed required/unnecessary changes, dependent edits, redundant alternatives, cross-file dependencies, coarse mixed task edits with a weak configured oracle, protection rules, unsupported parsing/metadata, timeout or inconclusive verification, and source-mutating commands. Reuse established adversarial fixtures where useful without counting one edit twice.

Before running reduction, label original changed statements/spans necessary, unnecessary or uncertain and record base/head identities. Each automatic removal must map back to labels; fail if a removal is unlabelled, necessary or uncertain. Measure detection separately from deletion, retaining conservative cases in denominators. Publish each corpus class separately with actual sample counts and numerator/denominator: removal precision, scope hit rate, necessary behavior retention, independent final oracle rate, hidden regressions and actual wall-clock duration. A zero removal denominator is undefined.

Independently apply every artifact advertised as verified to its exact base, execute full configured checks and held-out necessary behavior checks, and compare artifact tree identity. Retain input patch, labels, result JSON, cleanup patch, hashes and actual command outcomes. Applicable available-corpus gates: precision ≥98%, independent final checks 100%, zero known hidden regressions, nonzero successful removals; synthetic/injected scope hit target ≥80%, with honest detection criteria and corpus composition. Any applicable failure must exit nonzero. Natural human-labelled agent PR corpus remains sample count 0, NOT VERIFIED.

## Documentation and packaging

Document the actual v0.2 CLI: index/verify/explain/shrink/task inputs, AST granularity and fallback, v2 config fields and unavailable local history modes, report switches, advisory checks, targeted-first selection, coverage formats/line basis/context and stale-data limits, mandatory final verification, apply readiness and remaining precision limitations. Use the existing approved specification; do not invent customer/pilot outcomes.

Update package/workspace versions and root lock metadata consistently to v0.2 after implementation acceptance; preserve exact better-sqlite3 12.9.0 and unrelated user files. Do not install through a junction or change dependency versions to fix packaging. Update changelog/examples to match measured behavior. No external publishing, PR, commit, push or customer messages are authorized by this checklist.

## Independent final gates

Fresh typecheck/build, complete regression suite, affected real-Git safety/read-only/coverage/AST positive probes, reproducible labelled benchmark, clean production tarball install under supported Node 20, actual indexed AST cleanup from the installed CLI, exact-base artifact behavior/tree verification, and offline bundled Action. Retain actual exit codes and any failed-run history. Passing one batch does not approve the release; record local functionality acceptance separately from the unavailable natural-PR precision gate.
