# PatchDiet — Research Closure / Evidence-Gated Continuation

Repository:

`D:/systemDir/Desktop/PatchDiet`

Current known repository state:

- Current HEAD reported by latest audit: `a57b27e...`
- Research KB exists under:
  `knowledge/research/`
- Current research ledger:
  `knowledge/research/registry.yaml`
- Only `PD-R001` may currently be treated as `IMPLEMENTED`.
- Other existing research tickets must NOT be promoted without new evidence.
- Previous run reported `708 tests passed`, but this proves only that the tested code state passed those tests. It does NOT prove:
  - source correctness
  - research completeness
  - algorithm-card accuracy
  - license verification
  - research distillation completion
  - benchmark improvement
  - engineering benefit
  - production readiness

The previous completion claim was too strong.

This continuation MUST correct that.

---

# 0. AUTHORITATIVE STATUS

Immediately update project status to:

```text
RESEARCH_DISTILLATION_PARTIAL
ENGINEERING_EVIDENCE_NOT_YET_CLOSED
```

Do NOT use:

```text
RESEARCH_COMPLETE
DISTILLATION_COMPLETE
PROJECT_COMPLETE
LOCAL_ENGINEERING_COMPLETE
```

until the gates below are actually passed.

---

# 1. EXECUTION ORDER IS NOW FIXED

You MUST perform work in this order:

```text
P0-A  Correct research provenance
P0-B  Correct algorithm cards
P0-C  Independent research review
P0-D  Independent engineering/safety review

P1-A  Complete mandatory research coverage
P1-B  Build complete citation/license/reference validation
P1-C  Run research-driven comparison experiments
P1-D  Implement only experimentally justified runtime changes
P1-E  Re-run correctness and benchmark gates

P2    Correct final handoff and repository status
```

Do NOT skip directly to new engineering features.

Do NOT implement speculative improvements before the research baseline is trustworthy.

---

# 2. PHASE R0 — FREEZE CURRENT STATE

Before editing:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
```

Record:

```text
ACTUAL_HEAD
WORKTREE_STATUS
UNTRACKED_FILES
MODIFIED_FILES
RESEARCH_KB_STATUS
```

Do not commit automatically unless explicitly permitted by the existing project workflow.

Do not reset user changes.

---

# 3. PD-R100 — SOURCE REGISTRY FORENSIC AUDIT

Audit every currently registered source in:

`knowledge/research/registry.yaml`

For each source, verify:

```text
source id
title
authors
year
venue
DOI / canonical URL
source type
authority tier
primary/secondary
retrieval date
license if repository
repository URL if applicable
repository commit/tag used
paper version used
claim references
```

Every source must end in exactly one status:

```text
SOURCE_VERIFIED_PRIMARY
SOURCE_VERIFIED_REPOSITORY
SOURCE_PARTIALLY_VERIFIED
SOURCE_UNVERIFIED
SOURCE_INVALID
SOURCE_SUPERSEDED
```

### Hard rule

A webpage existence check is NOT sufficient to mark:

`SOURCE_VERIFIED_PRIMARY`

A GitHub repository URL existing is NOT sufficient to mark:

`SOURCE_VERIFIED_REPOSITORY`

Repository verification must include:

```text
repository URL
license
license path
license type
specific inspected commit/tag
retrieval date
```

If no fixed commit was previously recorded:

downgrade the source status.

---

# 4. PD-R101 — REMOVE OR CORRECT INVALID CITATIONS

Search all research files for:

```text
zikirov
ddmin
CDD
ProbDD
Vulcan
WDD
LPR
HDD
```

The currently suspicious citation:

`paper:zikirov-1999-ddmin`

must be treated as invalid until independently verified.

If invalid:

```text
remove reference
replace with correct original source
record correction
record files changed
record reason
```

Do not silently repair history.

Create:

`knowledge/research/reports/SOURCE_CORRECTIONS.md`

with:

```text
Old claim/reference
Problem
Correct source
Reason
Affected files
Correction status
```

---

# 5. PD-R102 — ORIGINAL DDMIN PAPER

Locate and verify the original Delta Debugging source.

Required target:

Andreas Zeller / Ralf Hildebrandt work on Delta Debugging / failure-inducing input minimization.

Verify:

```text
exact title
authors
year
venue/journal
DOI or authoritative publication page
algorithm definition
dd / ddmin distinction
1-minimality claim
assumptions
termination
oracle model
```

Create or repair:

```text
sources/program-reduction/ddmin.yaml
algorithms/ddmin.yaml
claims/program-reduction/ddmin-*.yaml
```

Algorithm card MUST distinguish:

```text
1-minimal
globally minimal
subset-minimal
minimum-size
```

Do not conflate them.

---

# 6. PD-R103 — HDD

Verify original Hierarchical Delta Debugging source.

Distill:

```text
tree hierarchy
level-by-level reduction
structural decomposition
advantages over flat ddmin
limitations
oracle assumptions
```

Create:

```text
sources/program-reduction/hdd.yaml
algorithms/hierarchical-delta-debugging.yaml
```

Map to PatchDiet:

```text
AST hierarchy
file → symbol → node → token/atom
```

But do NOT implement HDD yet.

Research first.

---

# 7. PD-R104 — WDD

Verify original WDD paper and official artifact.

Capture:

```text
weight definition
selection strategy
how WDD differs from ddmin
evaluation setup
reported benefits
limitations
```

Create:

```text
sources/program-reduction/wdd.yaml
algorithms/weighted-delta-debugging.yaml
```

PatchDiet hypotheses may include:

```text
risk-weighted candidates
test-cost-weighted candidates
scope-confidence-weighted candidates
AST-size-weighted candidates
```

These are hypotheses only until benchmarked.

---

# 8. PD-R105 — ProbDD

Verify the original Probabilistic Delta Debugging work.

Capture:

```text
probability model
candidate ordering
probability updates
termination
assumptions
performance claims
limitations
```

Do not derive ProbDD behavior only from later papers.

Record the original source separately from later analyses.

---

# 9. PD-R106 — CDD

Verify the original/primary source for Counter-based Delta Debugging.

Do not claim a complete CDD algorithm card until the original source is confirmed.

If CDD appears only in a later comparative paper:

record that explicitly.

Do not fabricate a standalone original citation.

---

# 10. PD-R107 — VULCAN

Verify the primary Vulcan paper.

Distill:

```text
problem with local minima / 1-minimality
core search idea
how it differs from baseline reducers
evaluation
tradeoffs
```

Create:

```text
sources/program-reduction/vulcan.yaml
algorithms/vulcan.yaml
```

---

# 11. PD-R108 — LPR

Verify:

`LPR: Large Language Models-Aided Program Reduction`

Capture the actual architecture.

Critical PatchDiet question:

```text
What does the LLM propose?
What does the deterministic reducer verify?
What property/oracle remains authoritative?
```

Distill the safety boundary.

Do NOT summarize LPR as:

“LLM safely removes code.”

That would be an invalid interpretation.

---

# 12. PHASE R1 — CODE INTELLIGENCE RESEARCH

Complete all missing mandatory project research.

---

# 13. PD-R110 — SCIP CORE

Verify:

```text
scip-code/scip
```

Record:

```text
license
commit
schema version
symbol identity model
definition/reference model
documentation model
relationship model
language neutrality
```

Then separately verify:

```text
sourcegraph/scip-typescript
sourcegraph/scip-python
scip-code/scip-java
```

Each must have its own project card.

Do NOT group all indexers under one generic “SCIP verified” claim.

---

# 14. PD-R111 — SCIP INDEXER COMPARISON

Create a comparison matrix:

```text
Indexer
Language
License
Install complexity
Windows
CI
Monorepo
Incremental behavior
Output size
Symbol precision
Reference precision
Maintenance status
```

Target:

```text
scip-typescript
scip-python
scip-java
```

No runtime integration yet.

---

# 15. PD-R112 — JOERN

Verify Joern.

Distill:

```text
Code Property Graph
AST
CFG
data flow
call graph
query model
language coverage
runtime/storage cost
```

Decision should likely remain:

`RESEARCH_ONLY`

unless benchmark evidence later proves otherwise.

---

# 16. PD-R113 — AST-GREP / SEMGREP / CODEQL

Research independently:

```text
ast-grep
Semgrep
CodeQL
```

For each:

```text
what it represents
what it can prove
what it cannot prove
runtime cost
language support
license/integration constraints
PatchDiet relevance
```

Important distinction:

```text
structural pattern
static finding
data-flow result
semantic proof
```

must NOT be conflated.

---

# 17. PHASE R2 — TESTING / ORACLE RESEARCH

---

# 18. PD-R120 — REGRESSION TEST SELECTION

Complete the mandatory RTS literature.

At minimum cover:

```text
Rothermel
Harrold
safe regression test selection
coverage-based selection
change-based selection
test prioritization
test minimization
```

Create atomic claims around:

```text
safe selection
precision
cost
coverage relationship
limits of “safe”
```

Map to PatchDiet:

```text
targeted-first candidate verification
```

Critical invariant remains:

```text
targeted-first != final verification
```

---

# 19. PD-R121 — PIT

Verify PIT / PITEST.

Capture:

```text
mutation operators
test impact
history
incremental features
JVM constraints
mutation score semantics
equivalent mutant limitations
```

---

# 20. PD-R122 — MUTATION TESTING RESEARCH REPOSITORY

Verify:

`mutationtesting.uni.lu`

Identify and record:

```text
major survey papers
historical development
mutation-testing terminology
equivalent mutants
competent programmer hypothesis
coupling effect
test adequacy limits
```

Only primary literature claims may enter algorithm/claim cards.

---

# 21. PHASE R3 — BENCHMARK / AGENT RESEARCH

---

# 22. PD-R130 — SWE-REBENCH

Verify official paper/project.

Capture:

```text
task collection pipeline
freshness
environment construction
contamination resistance
grading
known limitations
```

PatchDiet mapping:

```text
fresh benchmark generation
```

---

# 23. PD-R131 — SWE-BENCH LIVE

Verify the authoritative source.

Capture:

```text
repo count
task count
Docker/environment method
freshness mechanism
task generation
limitations
```

Use exact source-backed counts only.

---

# 24. PD-R132 — AIDEV

Verify the AIDev paper/dataset.

Capture:

```text
agent types
PR count
repo sampling
collection method
labels
limitations
licensing/data-use constraints
```

Do not automatically import the entire dataset.

First define a legal and reproducible sampling plan.

---

# 25. PD-R133 — CODEREVIEWQA

Verify official paper and dataset.

Capture:

```text
languages
sample count
task format
human curation
evaluation metrics
model comparison scope
limitations
```

Map only to:

```text
review/scope comprehension evaluation
```

not removal correctness.

---

# 26. PD-R134 — 2026 LLM REVIEWER RELIABILITY

Verify the original 2026 study.

Capture exactly:

```text
research question
dataset
models
error mode
overcorrection
false positives
requirement-conformance judgment
limitations
```

Do not turn one study into a universal statement.

Allowed conclusion:

```text
LLM review judgment requires independent verification.
```

Not:

```text
LLMs cannot review code.
```

---

# 27. PHASE R4 — PR TOOLING / GIT / SECURITY

---

# 28. PD-R140 — PR-AGENT

Verify:

```text
repository
license
commit
architecture
Git provider abstraction
comment/check flow
deployment models
```

Extract only reusable architectural patterns.

---

# 29. PD-R141 — ALIBABA OPEN-CODE-REVIEW

Verify:

```text
repository
license
commit
deterministic pipeline
LLM role
Git integration
context acquisition
review output
```

---

# 30. PD-R142 — DANGER JS

Verify repository and architecture.

Extract:

```text
policy-as-code
PR metadata
file-sensitive rules
review routing
```

---

# 31. PD-R143 — LIBGIT2

Verify:

```text
repository
license
commit
diff model
tree/blob semantics
mode handling
rename representation
symlink/submodule handling
```

---

# 32. PD-R144 — GITOXIDE

Verify:

```text
repository
license
commit
Git object model
diff support
safe path handling
platform support
```

Do not propose replacing `git` CLI yet.

---

# 33. PD-R145 — OPENSSF BASELINE

Verify current official OpenSSF baseline.

Record:

```text
version
publication date
control groups
project applicability
supply-chain controls
CI/release relevance
```

Do not rely on stale cached version numbers.

---

# 34. PHASE R5 — GIT NORMATIVE MATRIX

This is mandatory.

Use Git official documentation as normative source.

Create:

`knowledge/research/mappings/git-diff-support-matrix.md`

Rows:

```text
modified text
new file
deleted file
rename
copy
binary
mode-only
symlink
submodule
combined diff
similarity index
dissimilarity index
extended headers
/dev/null
quoted paths
spaces in paths
non-ASCII paths
```

Columns:

```text
Git normative semantics
PatchDiet parser support
PatchDiet serializer support
PatchDiet reducer support
PatchDiet final-verification support
Current tests
Missing tests
Runtime safety status
```

Allowed statuses:

```text
SUPPORTED_VERIFIED
SUPPORTED_PARTIAL
HUMAN_REVIEW
UNSUPPORTED_FAIL_CLOSED
BUG
NOT_TESTED
```

Do NOT rewrite existing tests that already cover binary/mode/symlink/submodule cases.

Only add missing coverage.

---

# 35. PHASE R6 — RESEARCH INTEGRITY VALIDATOR

The current validation tests are insufficient.

Build a stronger validator.

Required checks:

```text
all source ids unique
all claim source refs resolve
all algorithm source refs resolve
all project source refs resolve
all ticket source refs resolve
all ADR source refs resolve
all SOURCE_VERIFIED repos have:
  - repository
  - license
  - inspected commit/tag
  - retrieval date
all peer-reviewed sources have:
  - title
  - authors
  - year
  - venue
  - canonical source
all claims have:
  - statement
  - source
  - limitations
  - PatchDiet mapping
  - automatic_removal_authority=false
```

Also validate D1–D7.

---

# 36. D1–D7 MACHINE VALIDATION

Every high-priority source/project must expose:

```text
D1_SOURCE_VERIFIED
D2_CLAIMS_EXTRACTED
D3_LIMITATIONS_CAPTURED
D4_PATCHDIET_MAPPED
D5_DECISION_RECORDED
D6_TICKET_CREATED_IF_REQUIRED
D7_VALIDATED_IF_IMPLEMENTED
```

Allowed completion:

```text
DISTILLED_AND_APPLIED
```

only if D1–D7 all pass.

If D6 not required because decision is `RESEARCH_ONLY`:

record:

```text
D6_NOT_APPLICABLE
```

Never leave it implicit.

---

# 37. PHASE R7 — INDEPENDENT RESEARCH REVIEW

This pass must be separate from implementation.

For EVERY Tier-A source and high-impact claim:

re-derive the conclusion independently.

Questions:

```text
Is this really the primary source?
Does the source actually support the claim?
Is the claim stronger than the evidence?
Were limitations removed?
Was a later survey confused with the original algorithm?
Was a repository confused with the paper?
Was benchmark evidence generalized beyond its domain?
Was correlation rewritten as causation?
```

Output:

`knowledge/research/reports/INDEPENDENT_RESEARCH_REVIEW.md`

Every issue must be classified:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

All CRITICAL/HIGH issues must be fixed before experiments.

---

# 38. PHASE R8 — INDEPENDENT ENGINEERING / SAFETY REVIEW

Separate pass.

Review all research-derived proposals.

Questions:

```text
Could this create unsafe deletion?
Could this weaken fail-closed behavior?
Could absence of graph evidence be treated as absence of dependency?
Could a heuristic become automatic authority?
Could an LLM become an oracle?
Could historical co-change become removal authority?
Could targeted tests replace full verification?
Could cache reuse cross commit/environment boundaries?
Could unsupported Git forms silently disappear?
```

Output:

`knowledge/research/reports/INDEPENDENT_ENGINEERING_REVIEW.md`

No P1 experiment begins until CRITICAL/HIGH findings are resolved.

---

# 39. PHASE E0 — REDUCER COMPARISON EXPERIMENT

Only now begin engineering experiments.

Do NOT replace the current reducer.

Build an experiment harness comparing:

```text
current reducer
classic ddmin
HDD
```

Optionally add WDD only if implementation cost is small and algorithm card is verified.

Use the existing benchmark corpus.

Do NOT rebuild the existing synthetic benchmark.

Measure:

```text
final removals
Removal Precision
Removal Recall
oracle calls
runtime
candidate evaluations
final verification result
hidden regression rate
```

Use identical oracle and fixtures.

Output:

`benchmarks/research/reducer-comparison/`

Decision gate:

A new reducer strategy may be adopted only if it shows a measurable benefit without reducing safety.

---

# 40. PHASE E1 — SYNTAX-CANDIDATE EXPERIMENT

Question:

> Does syntax-aware candidate generation materially reduce oracle calls or improve reduction quality?

Compare:

```text
hunk/text candidates
AST-aware candidates
syntax-filtered candidates
```

Measure:

```text
candidate count
invalid candidate rate
oracle calls
runtime
Removal Precision
Removal Recall
final verification
```

Do not assume fewer candidates automatically means better performance.

---

# 41. PHASE E2 — SQLITE VS SCIP EXPERIMENT

Do NOT replace current SQLite graph.

Build a bounded prototype.

Compare:

```text
current SQLite graph
SCIP TypeScript
SCIP Python
```

Only use Java if a suitable fixture exists.

Metrics:

```text
index time
index size
symbol recall
reference precision
reference recall
monorepo behavior
incremental update cost
Windows install
CI install
cold start
```

Create manually curated ground truth for a small fixture set.

Output:

`benchmarks/research/scip-comparison/`

Decision:

```text
KEEP_SQLITE
ADD_OPTIONAL_SCIP_IMPORT
HYBRID
REJECT_SCIP_FOR_MVP
```

No other outcome allowed without evidence.

---

# 42. PHASE E3 — MUTATION ORACLE-STRENGTH AUDIT

Do NOT put mutation testing into normal `patchdiet shrink`.

Benchmark-only.

Use:

```text
StrykerJS
```

for suitable JS/TS fixtures.

Use PIT only if JVM fixtures exist.

Measure:

```text
mutants generated
mutants killed
mutants survived
tests covering relevant files
PatchDiet behavior under surviving mutants
```

Research question:

> How often can PatchDiet's configured tests pass despite meaningful behavioral mutations?

Output:

```text
ORACLE_STRENGTH_REPORT.md
```

Do not convert mutation score into deletion authority.

---

# 43. PHASE E4 — TARGETED-FIRST AUDIT

Audit:

```text
targeted-first
full-required-at-end
```

Test:

```text
index missing
index stale
mapping missing
mapping incomplete
wrong mapping
unsupported test runner
targeted test pass / full suite fail
targeted test fail / full suite fail
```

Required invariant:

```text
Targeted pass MUST NOT produce VERIFIED final result
unless full required final verification also passes.
```

---

# 44. PHASE E5 — REAL DATA EVALUATION PREPARATION

Existing synthetic/injected/hidden-check benchmark stays.

Do not rebuild it.

Create separate evaluation lanes:

```text
human-authored-real
agent-authored-real
fresh-task
```

Natural data MUST remain separate from synthetic data.

Current expected status:

```text
REAL_AGENT_PR_COUNT = 0
```

until actual data is imported.

Do not fabricate PRs and label them “real”.

---

# 45. HUMAN PATCH DATA

Build an importer for real historical human PRs.

Requirements:

```text
repository identity
base SHA
head SHA
diff
task/issue if available
tests if reproducible
license / data-use status
source provenance
```

No claims about “unnecessary change” without labels.

---

# 46. AGENT PR DATA

Build a legal/reproducible sampling workflow for publicly available agent-authored PR datasets such as AIDev if licensing permits.

Do not download/import blindly.

First produce:

```text
DATASET_USAGE_REVIEW.md
```

including:

```text
license
terms
redistribution
privacy
repository licensing
reproducibility
sampling method
```

Only then import.

---

# 47. FRESH TASK DATA

Study SWE-rebench/SWE-bench Live methodologies.

Design a PatchDiet-specific fresh-task pipeline.

Do NOT implement a large crawler unless necessary.

A small reproducible pilot is enough.

---

# 48. PHASE E6 — ENGINEERING ADOPTION GATE

After each experiment, use:

```text
ADOPT
ADAPT
KEEP_CURRENT
REJECT
MORE_DATA_REQUIRED
```

Only `ADOPT` or `ADAPT` creates runtime-change tickets.

No benchmark benefit:

→ no runtime change.

No measurable correctness/performance value:

→ no runtime change.

---

# 49. RUNTIME IMPLEMENTATION TICKETS

Only after experiment evidence exists, create:

```text
PD-E###
```

Every ticket must cite:

```text
research sources
claims
experiment
measured result
expected gain
safety invariants
```

No speculative runtime ticket.

---

# 50. PHASE V0 — FULL REVALIDATION

After any accepted runtime changes:

run:

```bash
npm run typecheck
npm run build
git diff --check
npm test -- --maxWorkers=1
```

Then applicable:

```bash
npm run bench:cli-v02
npm run bench:examples
npm run smoke:release
npm run smoke:github-app
npm run smoke:vscode
npm run pro:readiness
```

Do not assume the previous 708-test result remains valid.

Record new numbers.

---

# 51. FINAL RESEARCH STATUS

Final research status may only become:

```text
RESEARCH_DISTILLATION_COMPLETE
```

if:

```text
all mandatory sources covered
all P0 source errors fixed
all algorithm cards have verified provenance
all project licenses fixed to inspected commits
all claims resolve
D1–D7 validator passes
independent research review has no unresolved critical/high
independent engineering review has no unresolved critical/high
```

---

# 52. FINAL ENGINEERING EVIDENCE STATUS

May only become:

```text
ENGINEERING_EVIDENCE_CLOSED
```

if:

```text
reducer comparison completed
syntax candidate experiment completed
SCIP comparison completed or formally rejected with evidence
mutation oracle audit completed
targeted-first audit completed
real-data lane implemented
runtime changes adopted only where supported
full regression revalidated
```

Real external datasets may still remain:

`NOT_VERIFIED`

if unavailable.

That does not block local engineering closure if the infrastructure is complete and status is honest.

---

# 53. FINAL HANDOFF CORRECTION

Rewrite completion claims in:

`deliverables/codex-full-takeover/FINAL_HANDOFF.md`

Do not say the project is complete merely because tests pass.

Required final sections:

```text
Repository state
Actual HEAD
Uncommitted files

Research coverage

Source verification status

Algorithm-card status

License verification status

Independent research review

Independent engineering review

Reducer experiment

Syntax candidate experiment

SCIP experiment

Mutation audit

Targeted-first audit

Synthetic benchmark

Real human PR count

Real agent PR count

Fresh task count

Runtime changes adopted

Runtime changes rejected

Full regression result

External blockers

Known limitations
```

---

# 54. FINAL STATUS LABELS

Use one exact final status:

```text
RESEARCH_AND_ENGINEERING_CLOSED
```

only when all local gates pass.

Otherwise:

```text
RESEARCH_PARTIAL
```

or:

```text
ENGINEERING_EXPERIMENTS_PARTIAL
```

or:

```text
BLOCKED_EXTERNAL_DATA
```

or:

```text
BLOCKED_UNRESOLVED_CORRECTNESS
```

---

# 55. EXECUTION REPORT FORMAT

After every ticket:

```text
TICKET:
STATUS:

SOURCE EVIDENCE:
FILES CHANGED:
CLAIMS ADDED/CORRECTED:

LICENSE CHECK:
COMMIT/TAG PIN:

IMPLEMENTATION:
TESTS:

EXPERIMENT:
METRICS:

INDEPENDENT REVIEW:
KNOWN LIMITATIONS:

NEXT:
```

---

# 56. IMMEDIATE NEXT ACTION

Start with:

```text
PD-R100 — Source Registry Forensic Audit
```

Then:

```text
PD-R101 — Invalid Citation Correction
PD-R102 — Original ddmin
PD-R103 — HDD
PD-R104 — WDD
PD-R105 — ProbDD
PD-R106 — CDD
PD-R107 — Vulcan
PD-R108 — LPR
```

Do NOT start reducer experiments before these cards are corrected.

Do NOT add runtime features before the two independent review passes.

The previous completion claim is superseded.

Repository reality and evidence are authoritative.

Correct first.
Verify second.
Experiment third.
Implement last.