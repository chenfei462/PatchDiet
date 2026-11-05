# ADR-CODE-INTELLIGENCE-001: Keep the SQLite graph and prototype optional SCIP import

- Status: ACCEPTED FOR EXPERIMENT
- Date: 2026-10-26
- Scope: `packages/evidence/src`, `packages/knowledge/src`, `packages/core/src/symbols.ts`

## Options

All comparative time, size, precision, incremental and installation metrics are NOT_MEASURED on the same fixture set. Qualitative cost guesses in the previous matrix are withdrawn. Retaining the current SQLite graph is a decision to avoid an unproven replacement, not a claim of measured superiority.

| Option | Decision | Required evidence |
| --- | --- | --- |
| Current SQLite graph | KEEP_CURRENT | Measure as the same-fixture baseline |
| SCIP import or hybrid | Research prototype only | Per-indexer symbol/reference ground truth, installation and cost metrics |
| SCIP as primary graph | No adoption authorized | Same comparison and safety gates |
| Joern | RESEARCH_ONLY | Primary architecture research and a bounded workload comparison before any adoption |

Source references: `project:scip`. Joern and each SCIP indexer require separate source/project cards in P1-A; they are not covered by protocol verification.

## Decision

Retain the lightweight SQLite graph as the default. Build an optional SCIP import benchmark only after a fixture measures symbol precision, reference precision, index time, index size, incremental update cost, monorepo handling, Windows support, and CI setup. Do not make SCIP or Joern a runtime dependency from research alone.

## Safety invariant

Graph absence means unknown. It never means unused and never authorizes deletion.
