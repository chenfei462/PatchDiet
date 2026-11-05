# ADR-MUTATION-ORACLE-001: Keep mutation testing in benchmark mode

- Status: ACCEPTED
- Date: 2026-10-26
- Scope: `packages/testing`, `benchmarks`, reporting

## Decision

Mutation testing is an oracle-strength audit for benchmark and design-partner research. It is not part of normal PatchDiet shrink because mutant execution multiplies runtime and surviving mutants do not identify all missing behavior. Reports may label a configuration `WEAK_ORACLE` and show killed/survived/equivalent categories, while preserving the wording `Verified against configured checks.`

## Required experiment

Source references: `project:strykerjs`. Mutation literature and PIT require separate primary coverage in P1-A.

Run known behavior fixtures, inject representative mutants, run configured tests, classify outcomes, and record mutation score, survivors, equivalent-mutant handling, runtime, and confidence wording. The experiment must never change removal authority based only on the score.
