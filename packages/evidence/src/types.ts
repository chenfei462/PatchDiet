/**
 * Evidence types for the Scope Engine.
 *
 * Evidence is the only thing a scope decision may cite. It is deliberately
 * typed by category, carries provenance (source id + span) and an explicit
 * reliability, and can carry `limits` so a report never hides what it does not
 * know. Nothing here collapses evidence into one opaque probability: a
 * user-visible classification cites the contributing records.
 */

export type EvidenceCategory =
  | "intent"
  | "graph"
  | "repository-rule"
  | "test"
  | "history"
  | "static"
  | "runtime"
  | "developer-memory";

/** Every evidence category, in the deterministic order reports use. */
export const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "intent",
  "graph",
  "repository-rule",
  "test",
  "history",
  "static",
  "runtime",
  "developer-memory"
];

/**
 * What a record argues. Orthogonal to category: a `graph` record may support a
 * supporting classification or, when the graph is incomplete, limit certainty.
 */
export type EvidencePolarity =
  | "supports-required"
  | "supports-supporting"
  | "supports-protected"
  | "supports-candidate"
  | "neutral"
  | "limits";

/** How much a single edge/record can be trusted. */
export type EdgeReliability = "strong" | "medium" | "weak";

/** A UTF-8 span into an evidence source document. */
export interface EvidenceSpan {
  sourceId: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  excerpt: string;
}

/** Command execution evidence captured from a prior verification attempt. */
export interface CommandEvidence {
  command: string;
  /** `passed` / `failed` / `not-run` / `inconclusive`. */
  status: "passed" | "failed" | "not-run" | "inconclusive";
  attempts: number;
  durationMs?: number;
  /** True when the result came from a candidate cache rather than a fresh run. */
  cached: boolean;
  /** True when a pass/fail oscillation was observed across retries. */
  flaky?: boolean;
}

/**
 * One atomic, citable piece of evidence. Ids are stable and content-addressed
 * so the same evidence keeps the same id across runs.
 */
export interface EvidenceRecord {
  id: string;
  category: EvidenceCategory;
  polarity: EvidencePolarity;
  confidence: number;
  /** Id of the source this evidence came from (intent source, file path, command). */
  sourceId: string;
  /** The change atom this record is attached to, when atom-scoped. */
  atomId?: string;
  /** Span inside the source document, when the evidence quotes text. */
  span?: EvidenceSpan;
  /** Reliability of the edge/relationship this record rests on. */
  reliability?: EdgeReliability;
  /** Command evidence for `runtime` records. */
  command?: CommandEvidence;
  /** Human-readable, deterministic explanation of the record. */
  detail: string;
  /** Explicit limitations of this record; never empty for a limiting record. */
  limits?: string[];
}

/** A graph edge as a serializable fact. */
export interface GraphEdgeFact {
  fromId: string;
  toId: string;
  edgeType: "import" | "reference" | "call" | "extends" | "export" | "test-of" | "contains";
  reliability: EdgeReliability;
  /** Provenance of the edge, e.g. a parser id or file path. */
  sourceId: string;
}

/** Serializable graph facts plus completeness diagnostics. */
export interface GraphFacts {
  edges: GraphEdgeFact[];
  /**
   * Non-empty when the graph is known to be incomplete (parse failures,
   * unsupported languages, skipped files). Any scope decision made with
   * incomplete graph facts must be downgraded to `uncertain`.
   */
  incompleteReasons: string[];
  /** Languages the indexer could not parse, if any. */
  unsupportedLanguages?: string[];
}

/** A discovered repository rule with traceable provenance and scope. */
export interface RepositoryRule {
  id: string;
  /** The instruction file the rule was found in. */
  sourceId: string;
  path: string;
  /** `path-protect` blocks removal of matching paths; others are informational. */
  kind: "path-protect" | "invariant" | "policy";
  /** Glob the rule is scoped to, when the rule is path-scoped. */
  scopePattern?: string;
  text: string;
  span?: EvidenceSpan;
  /** Reliability is `medium` at best: rules are prose, not executable code. */
  reliability: EdgeReliability;
}

/** One discovered instruction document, kept for provenance. */
export interface RuleSource {
  sourceId: string;
  path: string;
  /** True when the file existed and was read; false when absent. */
  present: boolean;
  /** Byte length of the raw content, when present. */
  byteLength?: number;
}

export interface RuleDiscoveryResult {
  rules: RepositoryRule[];
  sources: RuleSource[];
  diagnostics: string[];
}

/** Static (non-graph) change facts about an atom. */
export interface StaticFacts {
  /** e.g. "formatting-only", "comment-only", "whitespace". */
  changeKinds?: string[];
  /** True when the atom only reorders or reformats existing code. */
  formattingOnly?: boolean;
  /** True when the change is generated code. */
  generated?: boolean;
}

/** Test-to-symbol mapping facts. */
export interface TestFacts {
  /** Test ids that reference the atom's symbol/file. */
  mappedTestIds: string[];
  /** How the mapping was established. */
  mappingType?: "coverage" | "explicit" | "static" | "naming" | "history" | "similarity";
  /** Coverage intervals (1-based inclusive line ranges) when available. */
  coveredLines?: { start: number; end: number }[];
}

/** Historical facts about the atom's path/symbol. */
export interface HistoryFacts {
  /** Number of historical commits that touched this path. */
  changeCount?: number;
  /** Co-change coupling with a task symbol, if measured. */
  coChangeWithTaskSymbol?: number;
  /** Similarity score in [0,1] to the task text, if computed. */
  similarity?: number;
  /**
   * Real commit SHAs of the most recent recorded commits that touched this
   * path (bounded list; from the pinned history snapshot). Empty/absent means
   * no real commit identity is known — callers must never fabricate one.
   */
  sourceCommits?: string[];
  /** Pinned commit the history snapshot was collected at, when known. */
  snapshotCommit?: string;
  /** File-level co-change partners (same-commit heuristic, NOT a symbol dependency). */
  coChangedWith?: { path: string; count: number }[];
}

/**
 * A caller-asserted merged-PR record stored with the pinned history snapshot.
 * Purely provenance: it never claims any file/symbol relation to an atom and
 * never changes a classification. Labels are unverified caller assertions.
 */
export interface MergedPrEvidence {
  /** Caller-cited PR identity, e.g. "#7". */
  pr: string;
  /** Full 40-hex merge commit, verified reachable from the indexed commit. */
  mergeCommit: string;
  /** Local snapshot provenance path cited by the caller. */
  snapshotPath: string;
  /** Unverified caller labels. */
  labels: string[];
  /** Repo-local input file the record came from. */
  inputPath: string;
  /** SHA-256 over the actual input file bytes. */
  inputContentSha: string;
  /** The pinned commit the record was ingested at. */
  indexedCommit: string;
}

/**
 * A serializable change atom: the unit the Scope Engine classifies.
 *
 * This is the stable boundary between the (separately reviewed) parser/index
 * module and this batch. The parser may be integrated later; for now any caller
 * can construct atoms from a diff without importing it.
 */
export interface ChangeAtom {
  /** Stable id. When omitted, `atomId()` derives one from the identity facts. */
  id?: string;
  filePath: string;
  /** Dotted symbol path, e.g. `Session.rotateToken`, when the atom is symbol-scoped. */
  symbolPath?: string;
  /** Symbol kind, e.g. `function` / `class` / `import` / `statement`. */
  symbolKind?: string;
  /** Hunk header the atom came from, when hunk-scoped. */
  hunkHeader?: string;
  /** Stable hash of the atom content, when available. */
  contentHash?: string;
  /** Positional index within the diff, used only when no content hash exists. */
  index?: number;
  /** Lines added by this atom. */
  addedLines?: number;
  /** Lines removed by this atom. */
  removedLines?: number;
  /** The atom's own patch text. */
  patchText?: string;
}

/**
 * All serializable facts a caller can supply for a scope analysis. Every field
 * is optional and local: supplying none is legal and yields an `uncertain`
 * analysis rather than a guess.
 */
export interface ScopeFacts {
  atoms: ChangeAtom[];
  graph?: GraphFacts;
  rules?: RepositoryRule[];
  tests?: Record<string, TestFacts>;
  history?: Record<string, HistoryFacts>;
  /** Caller-asserted merged-PR records (global provenance, never per-atom). */
  mergedPrs?: MergedPrEvidence[];
  static?: Record<string, StaticFacts>;
  /** Prior command evidence keyed by atom id (never a fresh oracle run here). */
  runtime?: Record<string, CommandEvidence[]>;
  /** Developer-memory facts keyed by atom id; never authorises removal. */
  memory?: Record<string, { support: number; reject: number; note?: string }>;
}

