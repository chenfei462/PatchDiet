# Research Gate Closure Implementation Plan

**Goal:** Resolve PD-R150–159 using inspectable primary evidence and obtain a fresh independent decision before any experiment.

**Architecture:** Preserve the dirty working tree and runtime. Capture immutable source evidence separately from interpretations. Keep validation of internal consistency distinct from reviewer assessment of research completeness. Execute inline with parallel source verification and a separate independent reviewer.

**Tech stack:** YAML registry, Node.js integrity validator, Vitest, Git, official publication/repository/dataset sources.

- [ ] PD-R150: inventory partial sources, create RESEARCH_GATE_STATUS.md, reconcile registry with source cards after verification.
- [ ] PD-R151–152: WDD provenance layers and exact reviewer-study identification; record unresolved evidence honestly.
- [ ] PD-R153–154: separate SCIP indexers and static-analysis license scopes, requirements and limitations.
- [ ] PD-R155–156: mutation literature/tool separation and dataset legal-use review; import no data.
- [ ] PD-R157: immutable PR/Git/security repository evidence and current OpenSSF Baseline version.
- [ ] PD-R158: preserve Git matrix, add normative citations and exact existing test references, test only genuine gaps.
- [ ] PD-R159: first add adversarial validator tests, observe failure, strengthen references/provenance/D1–D7 invariants, run focused checks.
- [ ] Reconcile explicit D1–D7 states without turning failed gates into passes. Register every new source, claim and ticket.
- [ ] Run fresh integrity validation, typecheck, build, diff whitespace check and complete single-worker test suite. Save exact outputs/results.
- [ ] Independent reviewer inspects Tier-A sources, reduction algorithms, P1-A/license/dataset cards, Git matrix and D1–D7. Save INDEPENDENT_RESEARCH_REVIEW_V2.md with one verdict and structured blockers.
- [ ] Only if reviewer permits: create experiment authorization with evidence references and gate future experiment entry points before any experiment. Otherwise preserve EXPERIMENTS_NOT_PERMITTED and report blockers.

No runtime feature, reducer/SCIP/mutation experiment, benchmark redesign, real-data relabeling, commit of unrelated work or source-status inflation is authorized by this phase.
