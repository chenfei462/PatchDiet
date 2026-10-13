# Intent, Scope and Evidence modules (isolated batch)

This batch adds three self-contained, local-first packages that turn a task
description plus repository facts into an explainable **Scope Map**. It is an
isolated module batch: the CLI/core wiring that consumes it lands separately
after independent review, so nothing here changes existing command behaviour.

```
packages/
├── intent/     normalizeIntent()      — deterministic intent extraction
├── evidence/   evidence records, graph helpers, rule discovery
└── scope/      analyzeScope(), explainAtom(), report renderers
```

Everything is serializable. The reviewed semantic parser/index module can feed
these APIs by constructing plain `ChangeAtom` / `GraphFacts` objects; there is
no import dependency in either direction.

## Intent (`@patchdiet/intent`)

`normalizeIntent(documents, options)` resolves intent sources in a fixed
precedence order:

```
explicit --task / --task-file  >  structured agent plan  >  PR title/body  >  linked issue  >  commit messages
```

Rules the implementation enforces:

- **Explicit outranks contradictory fallback.** A CLI/task-file goal always
  wins over a conflicting commit or PR goal. The lower-priority goal is *not*
  discarded: it stays on the result and a `shadowed-fallback` conflict records
  which source was shadowed and by whom.
- **Missing intent is uncertain.** With no task-bearing source, `confidence` is
  `uncertain` and the Scope Engine must never emit a confident candidate.
- **Raw structured plans are validated strictly** (zod `strictObject`); an
  unknown key or wrong type throws `IntentValidationError` instead of being
  silently reinterpreted.
- **UTF-8 source spans.** Every statement carries `sourceId`, `path`, a
  `SourceSpan` with byte offsets and 1-based line numbers, and a verbatim
  `excerpt`. A statement that is not literally present in the source is never
  fabricated.
- **Stable ids.** `statementId`/`atomId` are SHA-256-derived and depend only on
  content, so repeated runs produce identical ids.
- **LLM is optional and non-authoritative.** `llm: "off"` (default) needs no
  credentials or network. `llm: "auto"` records that normalization was
  requested but does not perform it, and emits a diagnostic stating that an LLM
  judgement alone must never authorise removal.

```ts
const intent = normalizeIntent([
  { id: "cli", kind: "cli", text: "Fix session expiry in src/auth/session.ts" },
  { id: "commit:abc", kind: "commit", text: "Unrelated reformatting" }
]);
// intent.confidence === "explicit"
// intent.conflicts includes a shadowed-fallback entry for commit:abc
```

## Evidence (`@patchdiet/evidence`)

Evidence is typed by category — `intent`, `graph`, `repository-rule`, `test`,
`history`, `static`, `runtime`, `developer-memory` — with `polarity`,
`confidence`, `sourceId`, optional `span`, `reliability`, `command` and explicit
`limits`. Nothing collapses into one opaque score.

- **Graph helpers** (`findDependencyPath`, `graphIsComplete`) traverse only
  non-weak edges, so a similarity/reference edge never becomes a support claim.
  `GraphFacts.incompleteReasons` is the completeness contract: any reason means
  absent dependency evidence cannot be trusted.
- **Rule discovery** (`discoverRules`) reads only the conventional instruction
  files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
  `.github/copilot-instructions.md`, `CONTRIBUTING.md`) plus explicitly
  configured protected patterns. It is read-only, keeps the source path on
  every rule, and does not treat arbitrary prose as an executable instruction.
- **Command evidence** records attempt count, cache state and flakiness so an
  `inconclusive`/flaky check can block a high-confidence removal.

## Scope (`@patchdiet/scope`)

`analyzeScope(intent, facts, options)` is pure and read-only: it never touches
the filesystem, never spawns a subprocess and never runs the oracle
(`readOnly: true`, `oracleExecuted: false`).

Exactly five principal states:

| State | Meaning |
|---|---|
| `required` | Directly named by explicit intent, or matches a stated requirement/acceptance criterion |
| `supporting` | No direct intent match, but a required atom depends on it via graph/test evidence |
| `candidate` | Explicit task + complete graph, and no intent/graph/test/protection link |
| `uncertain` | Evidence absent, incomplete or conflicting |
| `protected` | An explicit protection rule or must-preserve invariant covers it |

Precedence and safety invariants:

- **Protection beats candidate.** A matching protection rule or must-preserve
  invariant is checked first and always wins.
- **No intent ⇒ uncertain.** Without an explicit/structured task, an atom can
  never be a confident candidate. Inferred prose intent alone is insufficient.
- **Incomplete graph ⇒ uncertain.** A missing dependency edge never proves a
  change unused when `incompleteReasons` is non-empty.
- **Risk is orthogonal to state.** `dependency-manifest`, `lockfile`,
  `migration`, `security`, `public-api` and `generated` are reported as risk
  flags that never change the scope state: a required public-API change is
  `required` *and* `public-api`-flagged; a risky-but-unreferenced migration can
  still be a `candidate`.
- **Ambiguous symbols never become support.** A bare symbol name appearing in
  more than one module is reported as ambiguous and classified `uncertain`.
- **History/similarity/memory only rank.** They are recorded with an explicit
  limit and never authorise removal.
- **The runtime oracle is still required.** Every classification carries
  `requiresRuntimeOracle: true`; scope evidence decides only what to *try*.

`explainAtom(atomId, report)` and `explainAtoms({file?, symbol?}, report)` are
read-only evidence retrieval. A missing id is reported safely (`found: false`
plus a message) instead of throwing.

## Reports

`renderScopeJson` emits deterministic JSON (recursively sorted keys);
`renderScopeMarkdown` emits the Scope Map; `renderExplanationMarkdown` emits the
Evidence Report with the mandatory limitation:

> Passing the configured checks does not prove semantic equivalence outside
> behaviours exercised or encoded by those checks.

Byte-identical inputs always produce byte-identical output (verified by test).

## What this batch does **not** do

- It does not delete anything, and no classification claims an automatic
  deletion. Removal requires the runtime oracle in the verifier package.
- It does not implement or promise any installed connector. `github_pr`/`issue`
  inputs are caller-supplied local snapshots; there is no network adapter and no
  source upload.
- It does not wire `patchdiet verify/explain` CLI commands or config v2; that is
  the follow-up integration batch.

## Tests

`tests/unit/intent.test.ts`, `tests/unit/evidence.test.ts` and
`tests/unit/scope.test.ts` cover precedence conflicts, missing-intent
uncertainty, malformed-schema rejection, UTF-8 spans, deterministic ids,
required-vs-supporting cross-file graphs, protected invariants and path rules,
unrelated low-risk candidates with traceable positive evidence, graph
incompleteness, public-API risk orthogonality, ambiguous names, rule provenance,
explanation evidence ids, stable report JSON and read-only analysis.
