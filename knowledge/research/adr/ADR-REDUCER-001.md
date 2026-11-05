# ADR-REDUCER-001: Keep the current reducer until a controlled comparison justifies adoption

- Status: KEEP_CURRENT; implementation and experimental performance claims require evidence
- Date: 2026-10-26
- Scope: `packages/core/src/reducer.ts`, `packages/core/src/ast-atomizer.ts`, `packages/core/src/ast-shrink.ts`

## Context

PatchDiet already has a deterministic group reducer with context-aware caching and an explicit `INCONCLUSIVE` result. The research sources describe ddmin, hierarchical reduction, syntax-guided reduction, weighted ordering, probabilistic reduction, and counter-guided search. These strategies change search cost and candidate order; none changes deletion authority.

## Comparison

No PatchDiet strategy comparison has been run. Removal precision, recall, query count, runtime and hidden regression rates are **NOT_MEASURED** for every proposed replacement. Determinism helps reproduce a trace; it does not establish safety. Source-level complexity/minimality claims belong to the corrected algorithm cards and must not be presented as workload measurements.

| Strategy | Source-backed distinction | PatchDiet decision |
| --- | --- | --- |
| classic ddmin | Count partitions; completed-run 1-minimality under its test model | Comparison reference only |
| HDD | Breadth-first level-by-level ddmin; a single pass is not generally 1-tree-minimal | Experiment only after review gates |
| syntax-guided | Grammar-guided candidate construction; syntax is not semantics | Experiment only after review gates |
| WDD | Size-weighted partitions/model, not risk sorting | Research-only; artifact pin review required |
| ProbDD | Probability/expected-gain policy, not arbitrary sampling | Research-only |
| CDD | Round-counter size schedule introduced in later ProbDD analysis | Research-only |

Source references: `paper:zeller-hildebrandt-2002-ddmin`, `paper:misherghi-su-2006-hdd`, `paper:perses-icse-2018`, `paper:zhou-2025-wdd`, `paper:wang-2021-probdd`, `paper:zhang-2025-cdd`.

## Decision

Keep the current deterministic reducer as the runtime baseline. Add no stochastic or heuristic deletion path. Evaluate syntax-guided candidate filtering and hierarchical ordering only in benchmark mode, with the same executable oracle and a recorded seed or ordering. Any future adoption must improve removal precision or verification cost on PatchDiet workloads without reducing final validation pass rate.

## Safety invariants

1. A parse result, weight, history signal, counter, or LLM suggestion never authorizes removal.
2. Every accepted candidate passes the configured executable oracle.
3. `INCONCLUSIVE` is preserved and cannot be treated as `PASS`.
4. Final required verification remains mandatory after targeted search.

## Validation

Current evidence: reducer tests cover deterministic ordering, cache keys, and inconclusive outcomes. Missing evidence: a benchmark comparison across synthetic, human, and agent patches.
