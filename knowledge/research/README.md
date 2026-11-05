# PatchDiet research knowledge base

Authoritative status: `RESEARCH_DISTILLATION_PARTIAL` / `ENGINEERING_EVIDENCE_NOT_YET_CLOSED`.
The prior completion and source-verification claims are superseded by the evidence-gated continuation. See `STATUS.yaml` and `reports/R0_STATE.json`.

This directory is a documentation trust domain used to develop PatchDiet. It is deliberately separate from `.patchdiet/knowledge.sqlite`, which stores knowledge about the user repository at runtime.

## Provenance

- Protocol baseline: `2a02dad9cd1859c9b7c232c5a4b67446bf004d89`
- Observed repository HEAD at research start: `a57b27eeea6d6d3c7ad581334dba10830b7f4730`
- Worktree state: already dirty with takeover/productization changes; those changes are preserved and were not reset.
- Registry retrieval date: `2026-10-26` (America/Los_Angeles)

The observed HEAD differs from the protocol baseline. The intervening history was inspected with `git log`; repository reality is authoritative and no reset was performed.

## Safety boundary

Research evidence can guide candidate generation, scope evidence, verification selection, and engineering decisions. Research claims, static analysis, history, semantic matching, and LLM suggestions never authorize automatic removal. Only the configured executable verification path can authorize a verified automatic removal, and final output must say what was checked rather than claim semantic proof.

## Record lifecycle

Source verification distinguishes `SOURCE_VERIFIED_PRIMARY`, `SOURCE_VERIFIED_REPOSITORY`, `SOURCE_PARTIALLY_VERIFIED`, `SOURCE_UNVERIFIED`, `SOURCE_INVALID`, and `SOURCE_SUPERSEDED`. A reachable URL is insufficient. Repository verification requires an inspected fixed commit, root license path/type/text and retrieval date. Primary verification requires reading the relevant content and recording version/locators. These statuses do not establish distillation completion; D1–D7 and both independent review passes remain separate gates.

Partial or research-only work must never claim `DISTILLED_AND_APPLIED` without every applicable D1–D7 gate passing. `D6_NOT_APPLICABLE` must be explicit for a research-only disposition. Existing research tickets retain their prior status; only PD-R001 is IMPLEMENTED.

Allowed decisions: `ADOPT`, `ADAPT`, `EXPERIMENT`, `RESEARCH_ONLY`, `REJECT`, and `ALREADY_IMPLEMENTED`.

## Directory layout

- `sources/` verified primary sources and reference implementations
- `claims/` atomic, falsifiable claims with limitations and safety mapping
- `algorithms/` independently written algorithm cards
- `projects/` open-source architecture cards with license review
- `benchmarks/` benchmark and evaluation designs
- `mappings/` component matrix and research-to-code links
- `adr/` architecture decisions with alternatives and evidence
- `reports/` synthesis and reviewer passes
- `tickets/` research-derived engineering tickets

Generated binaries and full paper PDFs are excluded. Records use canonical links, identifiers, and original summaries.
