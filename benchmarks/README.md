# PatchDiet labelled benchmark

Reproducible, repository-contained benchmark for the local CLI: labelled
synthetic/adversarial and injected fixtures only. **No production source is
modified by this directory.** The runner drives the compiled implementation
(`dist/`, or `PATCHDIET_DIST`) and records per-case evidence.

## Run

```text
node benchmarks/run-benchmark.mjs
```

Requires a prior `npm run build`. Runtime prerequisite: the TypeScript strip-types fixture in this
corpus needs a modern Node runtime — the benchmark suite was validated on **Node 24**. This is a
benchmark-runner prerequisite only; the shipped CLI itself supports Node >= 20. Optional environment:

- `PATCHDIET_DIST` — implementation dist root (default `<repo>/dist`).
- `PYTHON` — Python interpreter for Python corpus cases (auto-discovered
  otherwise, including the local Python 3.11 installation).
- `BENCHMARK_ONLY=<id>` — run a single case for focused diagnosis; a filtered
  run's summary is never comparable to a full-corpus run.

Results are written under `benchmarks/results/<stamp>/`:

- `summary.json` — aggregate measurements, gates, corpus composition.
- `<case>-report.json` — the producer's full shrink report for the case.
- `<case>-labels.json` — pre-reduction labels per assessed atom.
- `<case>-input.patch` — the original BASE..HEAD diff.
- plus the emitted cleanup patch and hashes via the producer's own
  `.patchdiet` artifacts referenced by the report.

Never erase a previous `benchmarks/results/` directory; each run gets a unique
timestamped subdirectory. Fixture repositories are unique owned `mkdtemp`
scratch directories with locally configured Git identity, removed with bounded
awaited cleanup after each run.

## Corpus

Three classes, kept strictly separate:

1. **Synthetic adversarial Git histories** (`class: synthetic`): mutually
   redundant alternatives, dependent edits, oscillating (flaky) oracle,
   malformed head syntax with parse fallback, binary/docs-only conservative
   metadata, cross-file dependent necessary edits.
2. **Injected task fixtures** (`class: injected`): JavaScript, TypeScript and
   Python tasks with a known required behavior change and known unrelated
   additions (debug statements/locals, dead helper, protected migration,
   dependency manifest, mutating optional command, targeted test mapping,
   coarse weak-oracle mixed evidence).
3. **Human-labelled natural agent PRs**: **NOT VERIFIED — sample count 0.**
   No such dataset is available. No injected fixture may be presented as a
   natural PR, and no aggregate number may hide this missing class.

### Corpus history and preserved failures

The original corpus had 16 cases. `inj-python-two-debug-sites` (Python debug
local + print in `total.py`, plus a print in `util.py` consumed by the
oracle) first failed the runner itself — its labeler threw on a pure-deletion
AST atom — and was then **dropped from the corpus** in a later run after the
producer's ddmin went INCONCLUSIVE (report `unverified/partial` versus the
case's `verified` expectation) instead of being reported as a failed case.
Dropping it hid both the runner error and the producer's inconclusive result
from every denominator; that is exactly what this runner no longer permits.
The case is restored **unmodified** (labels unchanged, no post-verdict label
edits): it counts in all denominators, its actual outcome is published, and
if it still fails the gate honestly reports the failure as a preserved
counterexample rather than being silently removed. Restoring it exposed the
RUNNER defect that originally produced its INCONCLUSIVE outcome: fixture
repositories were created inside `benchmarks/results/` — nested inside the
outer PatchDiet git worktree — which made the producer's ddmin trial
worktree operations fail into `INCONCLUSIVE`. With the scratch root under
the OS temp directory (as this README always specified), the case passes.
The historical 09-02 INCONCLUSIVE record is preserved and explained by this
runner defect; it is not a producer defect.

### Documented fixture/expectation corrections

- `syn-cross-file-dependency`: the original head body `helper(n) + helper(0)`
  added a term whose value is always 0, so the labelled-necessary app.js edit
  was behavior-neutral and the oracle could not discriminate it — the producer
  correctly removed it once the runner environment made trials reliable (a
  genuine precision failure of the FIXTURE, not of the producer). The fixture
  was corrected to `helper(n) * 2` with oracle `main(2) === 20`, under which
  removing the app.js edit provably changes behavior, so both edits are
  genuinely necessary. No label was changed after a verdict; the case's
  original counterexample output is preserved in the earlier results
  directories.

## Labels

Every assessed atom is labelled `necessary`, `unnecessary` or `uncertain`
BEFORE reduction, by rules matched against the changed bytes (HEAD-side
content per atom) using the SAME deterministic identity pipeline as the
public Scope Map: hunks are built exactly like the public
`buildHunkAtom` (header line; context lines prefixed with SPACE, removals
with `-`, additions with `+`; binary section) and identified by the shared
`packages/intent` `atomId()` over the content hash; AST atoms come from the
shared atomizer with stable edit ids. Full prelabel provenance — per-atom
base/head byte spans and source slices — is persisted to `<case>-labels.json`
BEFORE reduction, so a forged or incorrect removal header cannot hide a
necessary deletion. Labels never derive from the reducer verdict; a
rule-unmatched atom fails the case.

Documented labeling decisions:

- *Conditionally redundant alternatives* (mutually redundant A/B): each
  alternative alone is unnecessary given the other exists in HEAD — a
  pre-reduction fact. Both atoms are labelled `unnecessary` with the pair
  declared as a redundant group; removing BOTH is caught by the held-out
  oracle as a hidden regression, not by labels.
- *Coarse mixed task atoms*: a coarse edit whose span contains required
  behavior is labelled per its content; under a weak oracle the producer must
  retain it (mixed-evidence rule) — asserted per case.
- *Task-required changes a weak oracle does not test* remain `necessary`.

## Measurements — three stages, published separately

Per class and in aggregate, with numerator/denominator shown. The three
stages are NEVER merged into one score:

- **Stage 1 — static detection (readonly, pre-reduction)**: the PUBLIC
  readonly Scope Map (the verify analysis path, queried before reduction with
  matching granularity and task) ties an explicit task-exclusion intent
  record (`category: intent`, `polarity: limits`, exclusion detail) or a
  no-risk candidate classification to a prelabelled-unnecessary atom,
  matched by EXACT stable atom id (shared `atomId()` for hunk atoms built
  with the public construction; shared atomizer edit id for AST atoms). No
  hunkHeader-only or file-name-only matching. This is pre-reduction readonly
  analysis ONLY: it does not identify runtime redundancy and its rate is
  **never advertised as >= 80%** — it stays published as measured, with
  misses listed by id. Known limitation, disclosed: without a task text the
  public map conservatively yields no exclusion evidence, so no-task
  synthetic fixtures are expected non-detected; a hunk that mixes a required
  change with an excluded change can carry the exclusion record on the
  combined hunk atom while the labeler labels lines separately, so per-atom
  static and runtime stages can legitimately disagree.
- **Stage 2 — runtime-confirmed findings**: fixtures where a
  labelled-unnecessary atom's removal was actually DELIVERED in an artifact
  advertised `verified` AND fully independently re-proven: exact-base
  reverse-apply, producer artifact-tree match, whole-tree byte-level
  HEAD→artifact delta (every tracked path's bytes AND Git mode) equal to
  ONLY the matched unnecessary edits (retained necessary and
  unlabelled bytes survive byte-faithfully; persisted prelabel spans/slices
  are the reference), the full oracle re-executed with per-command tracked
  tree identity, and the held-out oracle passing. A failed/unverified
  removal NEVER grants this credit; raw removal headers or labels alone
  never grant it.
- **Stage 3 — deletion rate (visibility only)**: fixtures with at least one
  labelled-unnecessary atom automatically removed, regardless of
  verification outcome. Non-hit fixtures are listed by id. This is a
  reduction/deletion metric and is explicitly NOT the detection gate.
- **Full-pipeline detection (the gated metric)**: per-case UNION of stage 1
  and stage 2, deduplicated; denominator = ALL original labelled cases
  containing unnecessary edits, including conservative misses and failed
  cases (missing/failed detection or artifact proof is never silently
  counted).
- **Removal precision** = labelled-unnecessary atoms automatically removed /
  all automatically removed atoms. Zero denominator = undefined, never 100%.
- **Independent final-oracle pass rate** = artifacts advertised `verified`
  that independently pass the full configured oracle / all advertised
  verified artifacts. Each artifact is applied to a clean worktree at the
  recorded base SHA, the oracle re-executed, and the tree hash compared with
  the producer's recorded final evidence. Target: 100%.
- **Hidden regressions** = known necessary labeled behaviors broken by
  artifacts advertised as verified, checked with a held-out behavior oracle
  that the producer never sees. Target: 0.
- **Timings**: actual wall-clock per case on the recording machine
  (Node/platform recorded). No unmeasured-scale claims and no baseline
  comparisons.

### Artifact delta assurance

The independent checker verifies the ENTIRE tracked HEAD tree against the
delivered artifact, not just the paths named in removals:

- **Whole-tree byte identity**: the artifact must equal HEAD with EXACTLY
  the matched labelled-unnecessary atoms' head byte spans replaced by their
  persisted base slices (AST) or patch-derived spans (hunk). Every other
  tracked path must be byte-identical to HEAD; a labelled debug removal can
  therefore never hide corruption of a separate required file, and a forged
  removal identity (a necessary change dressed as an unnecessary atom) is
  rejected because the reconstructed expected bytes will not match the
  delivered bytes.
- **Git mode identity**: every tracked path's Git mode (100644/100755/
  120000) must be unchanged from HEAD; an unlabelled executable-bit or
  symlink flip on any path — selected or not — fails the case.
- **File inventory**: file EXISTENCE is anchored to BASE, independently of
  expected byte length — a path tracked in BASE must remain in the artifact
  (empty, with its HEAD mode) even when reverting the added bytes empties
  it, because baseline file existence is unlabelled metadata that no
  removal covers. Whole-file absence is legitimate only when BASE lacks the
  path and the labelled full creation was actually undone (expected bytes
  empty); the worktree file must really be gone. Added files (staged but
  untracked in HEAD) and untracked worktree files fail.
- **Span soundness**: overlapping unnecessary atom spans are rejected as
  unreconstructable rather than silently merged.

The checker is self-contained and its ACTUAL implementation is imported
verbatim by the regression tests (`benchmarks/tests/artifact-delta.test.mjs`)
and by the independent root review, so neither can drift from the code the
benchmark executes. Fixtures are simple (no multiline strings inside changed
lines); held-out oracles and tree identity remain mandatory regardless.

## Gates (runner exits nonzero on any failure)

- Removal precision >= 98% (available labelled corpus).
- Full-pipeline detection (stage 1 UNION stage 2) >= 80% — NOT the deletion
  rate; the static-only rate is published as measured and is not gated.
- Independent final-oracle pass rate = 100%.
- Zero hidden regressions.
- Nonzero successful reduction cases.
- Every automatic removal maps to an `unnecessary` label; necessary,
  uncertain or unlabelled automatic removals fail.
- Natural agent PRs: this benchmark contains no natural-corpus cases, so
  natural-PR precision is NOT VERIFIED (sample count 0) and is disclosed as
  such. The available synthetic and injected corpus gates pass separately and
  say nothing about real-world efficacy; no real-world efficacy or release
  precision claim is made. Local functionality acceptance is recorded
  separately from release approval.

## Implementation identity

Each `summary.json` records the actual `package.json` version (currently
0.2.0 in the local workspace metadata), the workspace HEAD, and the SHA-256
of the compiled shrink module. This is local metadata only — it is not a
publishing or release claim; published packages and tags are managed
separately in the main integration path.
