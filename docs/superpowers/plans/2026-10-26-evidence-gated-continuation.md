# Evidence-gated research continuation plan

**Goal:** Correct research provenance before experiments, and adopt runtime changes only when measured evidence supports them.
**Architecture:** Preserve the existing dirty worktree. Research records and benchmark tooling stay outside the production removal path. Independent review findings gate experiments.
**Tech stack:** YAML, Markdown, Node.js, Vitest, official papers/specifications and pinned repository artifacts.

The user supplied the execution order and authorized inline execution. Do not commit, reset, rebuild the synthetic corpus, or promote existing tickets other than PD-R001 to IMPLEMENTED. Independent review uses separate reviewers after provenance/card correction.

- [x] R0: capture HEAD, branch, dirty/untracked paths and recent history in `knowledge/research/reports/R0_STATE.json` before edits.
- [x] Immediately mark partial status in `knowledge/research/STATUS.yaml`, research README and final handoff.
- [ ] P0-A / PD-R100–101: inspect every registered source; preserve prior metadata, record provenance gaps and citation corrections in `reports/SOURCE_REGISTRY_AUDIT.*` and `reports/SOURCE_CORRECTIONS.md`. Pin repository licenses to inspected commits.
- [ ] P0-B / PD-R102–108: independently inspect ddmin, HDD, WDD, original ProbDD, CDD, Vulcan and LPR; correct source/algorithm/claim records. Explicitly distinguish unresolved details and hypotheses.
- [ ] P0-C: independent research review, `reports/INDEPENDENT_RESEARCH_REVIEW.md`; fix critical/high findings before experiments.
- [ ] P0-D: independent engineering/safety review, `reports/INDEPENDENT_ENGINEERING_REVIEW.md`; fix critical/high findings before experiments.
- [ ] P1-A: cover PD-R110–145, separate indexer cards and comparison, original testing/benchmark/security sources, Git normative matrix. Preserve unavailable evidence as unverified.
- [ ] P1-B: strengthen integrity validation and negative fixtures for references, commit/license provenance and D1–D7. A validator must report honest closure blockers, never make partial research look complete.
- [ ] P1-C: E0 reducer, E1 syntax, E2 SCIP, E3 mutation, E4 targeted-first, E5 separate real-data lanes. Use existing corpus and identical oracles. Do not experiment until review gates pass.
- [ ] P1-D: issue PD-E tickets only for experimentally justified ADOPT/ADAPT decisions; otherwise retain the runtime.
- [ ] P1-E: fresh correctness/build/full-suite and applicable existing benchmark/smoke checks; record command, exit and metrics.
- [ ] P2: rewrite `deliverables/codex-full-takeover/FINAL_HANDOFF.md` with every requested section, current evidence and exact partial/closed status. Generate ticket reports in the requested format.

Verification is evidence-specific: source metadata does not prove algorithms, license metadata does not prove code permissions, integrity tests do not prove source truth, and configured tests do not prove semantic equivalence. Missing `RTK.md` is recorded, not guessed.
