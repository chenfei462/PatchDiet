# Authoritative Research Registry and Distillation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create a durable, source-verified PatchDiet research registry and convert the first high-value findings into traceable claims, algorithm cards, architecture decisions, and tickets without changing deletion authority.

**Architecture:** Keep `knowledge/research/` as a documentation-only trust domain separate from `.patchdiet/knowledge.sqlite`. Store source metadata, atomic claims, algorithm/project cards, ADRs, mappings, tickets, and reports as reviewable YAML/Markdown. Add a small Vitest validation test so malformed registry records fail in CI; do not add runtime research heuristics in this phase.

**Tech Stack:** YAML 2.x, Markdown, Vitest, Git official docs, NIST CSRC, peer-reviewed papers, and official project repositories.

---

### Task 1: Capture current repository state and create the research tree

**Files:**
- Create: `knowledge/research/README.md`
- Create: `knowledge/research/taxonomy.yaml`
- Create: `knowledge/research/registry.yaml`
- Create: `knowledge/research/sources/README.md`
- Create: `knowledge/research/claims/README.md`
- Create: `knowledge/research/algorithms/README.md`
- Create: `knowledge/research/projects/README.md`
- Create: `knowledge/research/benchmarks/README.md`
- Create: `knowledge/research/mappings/README.md`
- Create: `knowledge/research/adr/README.md`
- Create: `knowledge/research/reports/README.md`

- [x] **Step 1: Record the actual HEAD and dirty-worktree rule**

Use `git rev-parse HEAD`, `git status --short`, and the baseline from the protocol. Record the result in `knowledge/research/README.md` as provenance; do not reset or clean files.

- [x] **Step 2: Define the trust-domain and status vocabulary**

Write the README with the mandatory distinction that research evidence can guide engineering but never authorizes removal. Define statuses `SOURCE_VERIFIED`, `DISTILLED`, `ALREADY_IMPLEMENTED`, `EXPERIMENTAL`, `IMPLEMENTED`, `BENCHMARKED`, `REJECTED`, `BLOCKED`, and `NOT_VERIFIED`.

- [x] **Step 3: Add taxonomy and empty directory markers**

Define authority tiers A-D, evidence types, decision values, and claim scopes in `taxonomy.yaml`. Add a README to each required directory so Git preserves the research layout.

- [x] **Step 4: Run the repository file check**

Run `rg --files knowledge/research | sort` and verify every required top-level directory exists.

### Task 2: Verify and register authoritative seed sources

**Files:**
- Create: `knowledge/research/sources/program-reduction/*.yaml`
- Create: `knowledge/research/sources/git-diff/*.yaml`
- Create: `knowledge/research/sources/security/*.yaml`
- Create: `knowledge/research/sources/benchmarks/*.yaml`
- Create: `knowledge/research/sources/code-intelligence/*.yaml`
- Modify: `knowledge/research/registry.yaml`

- [x] **Step 1: Verify URLs and metadata**

Check official pages/repositories for Git diff format, Git apply, NIST SP 800-218, Perses, C-Reduce, Picire, Tree-sitter, GumTree, RefactoringMiner, SCIP, SWE-bench, and StrykerJS. Record retrieval date `2026-10-26`, canonical URL, title, repository license, and whether verification was complete.

- [x] **Step 2: Write source records**

Each record must include `id`, `title`, `source_type`, `authority_tier`, `year`, `canonical_url`, authors when applicable, `topics`, `problem`, `technique`, `claims`, `assumptions`, `limitations`, `patchdiet_relevance`, `license_review`, and `status`.

- [x] **Step 3: Register every source**

Make `registry.yaml` the index of all source IDs, file paths, authority tiers, verification dates, and status. Mark only sources whose title, canonical location, and license/repository state were checked as `SOURCE_VERIFIED`; mark unresolved items `NOT_VERIFIED` instead of guessing.

### Task 3: Atomize the first claims and algorithm cards

**Files:**
- Create: `knowledge/research/claims/program-reduction/*.yaml`
- Create: `knowledge/research/claims/scope/*.yaml`
- Create: `knowledge/research/claims/verification/*.yaml`
- Create: `knowledge/research/claims/security/*.yaml`
- Create: `knowledge/research/claims/testing/*.yaml`
- Create: `knowledge/research/algorithms/ddmin.yaml`
- Create: `knowledge/research/algorithms/hierarchical-delta-debugging.yaml`
- Create: `knowledge/research/algorithms/syntax-guided-reduction.yaml`
- Create: `knowledge/research/algorithms/change-impact-analysis.yaml`
- Create: `knowledge/research/algorithms/regression-test-selection.yaml`
- Create: `knowledge/research/algorithms/mutation-testing.yaml`
- Create: `knowledge/research/algorithms/ast-differencing.yaml`

- [x] **Step 1: Write atomic claims**

Each claim must contain a falsifiable statement, source ID, evidence type, scope, confidence, assumptions, limitations, PatchDiet mapping, possible action, safety effect, and `automatic_removal_authority: false`.

- [x] **Step 2: Write algorithm cards**

Use the required schema: problem, input/output, independent pseudocode, complexity, oracle calls, termination, correctness scope, assumptions, failure modes, variants, current state, gap, recommendation, non-recommendation, tests, and benchmark metrics.

- [x] **Step 3: Preserve safety boundaries**

Explicitly state in each card that only the configured executable verification oracle can authorize a verified automatic removal; syntax, history, static analysis, and LLM evidence remain advisory.

### Task 4: Produce architecture decisions, mapping matrix, and tickets

**Files:**
- Create: `knowledge/research/adr/ADR-REDUCER-001.md`
- Create: `knowledge/research/adr/ADR-SEMANTIC-CHANGE-001.md`
- Create: `knowledge/research/adr/ADR-CODE-INTELLIGENCE-001.md`
- Create: `knowledge/research/adr/ADR-MUTATION-ORACLE-001.md`
- Create: `knowledge/research/mappings/component-matrix.md`
- Create: `knowledge/research/projects/*.yaml`
- Create: `knowledge/research/tickets/PD-R001.yaml`
- Create: `knowledge/research/tickets/PD-R002.yaml`
- Create: `knowledge/research/tickets/PD-R003.yaml`
- Create: `knowledge/research/tickets/PD-R010.yaml`
- Create: `knowledge/research/tickets/PD-R020.yaml`
- Create: `knowledge/research/tickets/PD-R040.yaml`
- Create: `knowledge/research/tickets/PD-R050.yaml`

- [x] **Step 1: Compare current reducer and graph with research**

Use the current files under `packages/core/src`, `packages/evidence/src`, `packages/knowledge/src`, and `packages/scope/src` as evidence. Classify each decision as `ALREADY_IMPLEMENTED`, `ADAPT`, `EXPERIMENT`, `RESEARCH_ONLY`, or `REJECT`; do not claim a measured improvement without a benchmark artifact.

- [x] **Step 2: Write ADRs**

Reducer ADR compares ddmin, HDD, syntax-guided reduction, WDD, ProbDD, and CDD. Semantic-change ADR compares Git diff, Tree-sitter, GumTree, and RefactoringMiner. Code-intelligence ADR compares lightweight SQLite, SCIP import, SCIP-primary, hybrid, and Joern adapter. Mutation ADR keeps mutation testing in benchmark/research mode.

- [x] **Step 3: Build the component matrix**

Include all minimum rows from the protocol and point every row to current code, claims, projects, gap, decision, ticket, and validation evidence.

### Task 5: Add registry validation and synthesis report

**Files:**
- Create: `tests/unit/research-registry.test.ts`
- Create: `knowledge/research/reports/AUTHORITATIVE_RESEARCH_SYNTHESIS.md`
- Create: `deliverables/codex-full-takeover/FINAL_HANDOFF.md`
- Modify: `package.json` only if a test script is needed (prefer existing `npm test`)

- [x] **Step 1: Write the failing registry test**

Load `knowledge/research/registry.yaml` and assert every registered source points to an existing record with a valid authority tier, verification status, decision, and retrieval date; assert every referenced claim file has `automatic_removal_authority === false`.

- [x] **Step 2: Run the focused test and observe the expected failure**

Run `npx vitest run tests/unit/research-registry.test.ts`. It must fail before the registry is populated, proving the test checks the intended contract.

- [x] **Step 3: Populate the registry and make the test pass**

Implement only the YAML/Markdown data needed by the test. Re-run the focused test and then `npm test`.

- [x] **Step 4: Write the synthesis report**

Use the required section order from the protocol, distinguish verified findings from inference, and list what remains research-only or unverified.

- [x] **Step 5: Update the final handoff**

Add the `## Authoritative Research Distillation` section with source counts, claims, algorithm cards, project cards, ADRs, tickets, implemented/rejected/research-only items, and measured improvement. Do not state implementation or validation without repository evidence.

- [x] **Step 6: Run final verification**

Run `npx vitest run tests/unit/research-registry.test.ts`, `npm run typecheck`, `npm test`, and `git diff --check`; inspect exit codes and outputs before reporting status.

