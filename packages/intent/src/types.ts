/**
 * Intent normalization types.
 *
 * These are the serializable, local-first input contracts for the Scope Engine.
 * Nothing here touches the network, the filesystem or a model: a caller may
 * supply explicit CLI text, a structured agent plan, a PR/issue snapshot or
 * commit messages as plain documents, and normalization is deterministic.
 */

/**
 * Where an intent document came from. The order of this union is the
 * deterministic resolution precedence documented in `SOURCE_PRECEDENCE`:
 * explicit CLI / task-file beats a structured agent plan, which beats the PR
 * title/body, which beats a linked issue, which beats commit messages.
 */
export type IntentSourceKind =
  | "cli"
  | "task_file"
  | "agent_plan"
  | "pr"
  | "issue"
  | "commit";

/** Lower number wins. `cli` and `task_file` share the explicit tier. */
export const SOURCE_PRECEDENCE: Record<IntentSourceKind, number> = {
  cli: 0,
  task_file: 0,
  agent_plan: 1,
  pr: 2,
  issue: 3,
  commit: 4
};

/** Kinds that count as an explicitly stated task (the strongest intent). */
export const EXPLICIT_SOURCE_KINDS: ReadonlySet<IntentSourceKind> = new Set<IntentSourceKind>([
  "cli",
  "task_file"
]);

/**
 * A UTF-8 source span. `startByte`/`endByte` are byte offsets into the source
 * document text (UTF-8), so they stay correct for multilingual content where a
 * character may be several bytes. Line numbers are 1-based and inclusive.
 */
export interface SourceSpan {
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}

/**
 * One raw intent input. All fields are JSON-serializable. `plan` is only used
 * for `kind: "agent_plan"` and is strictly validated before use; a malformed
 * plan is rejected rather than silently downgraded.
 */
export interface IntentSourceDocument {
  /** Stable caller-chosen id, e.g. `"cli"`, `"task_file:docs/task.md"`, `"pr#184"`. */
  id: string;
  kind: IntentSourceKind;
  /** Raw text for cli / task_file / pr / issue / commit documents. */
  text?: string;
  /** PR/issue title, when the source has one. */
  title?: string;
  /** PR/issue body, when the source has one. */
  body?: string;
  /** Structured agent plan, validated when `kind === "agent_plan"`. */
  plan?: unknown;
  /** Path of a task file, when `kind === "task_file"`. */
  path?: string;
  /** Optional source URL (never fetched; provenance only). */
  url?: string;
  /** Tie-break within the same precedence tier. Defaults to 0. */
  order?: number;
}

/** A single extracted requirement, constraint, must-preserve or acceptance criterion. */
export interface IntentStatement {
  /** Stable content-addressed id, e.g. `req-1a2b3c4d`. */
  id: string;
  /** The statement text as it appears in the source (no paraphrase). */
  text: string;
  sourceId: string;
  sourceKind: IntentSourceKind;
  /** Source file path, when the document has one. */
  path?: string;
  /** UTF-8 span of the statement inside its source document. */
  span: SourceSpan;
  /** Verbatim excerpt from the source, used to prove the statement is sourced. */
  excerpt: string;
  /** Lower number = higher precedence. */
  priority: number;
}

/** A conflict observed while resolving sources, kept for the reviewer. */
export interface IntentConflict {
  type: "goal-conflict" | "shadowed-fallback" | "ambiguous-goal";
  /** Human-readable, deterministic explanation. */
  message: string;
  /** Source ids that contributed to the conflict, highest precedence first. */
  sourceIds: string[];
}

/** A non-fatal resolution note (e.g. no task source was supplied). */
export interface IntentDiagnostic {
  code:
    | "no-intent-source"
    | "missing-explicit-task"
    | "llm-disabled"
    | "llm-not-authoritative"
    | "source-empty";
  message: string;
  sourceIds: string[];
}

/**
 * How much the normalized intent can be trusted:
 * - `explicit`   — an explicit CLI/task-file task was supplied.
 * - `structured` — a validated structured agent plan was supplied.
 * - `inferred`   — only PR/issue/commit prose was available.
 * - `uncertain`  — no task-bearing source; the Scope Engine must never classify
 *                  an atom as a confident removal candidate on this alone.
 */
export type IntentConfidence = "explicit" | "structured" | "inferred" | "uncertain";

/** The deterministic, serializable output of `normalizeIntent`. */
export interface NormalizedIntent {
  schemaVersion: "patchdiet-intent/1";
  goal: string;
  requirements: IntentStatement[];
  constraints: IntentStatement[];
  mustPreserve: IntentStatement[];
  acceptanceCriteria: IntentStatement[];
  mentionedPaths: string[];
  mentionedSymbols: string[];
  /** Path/symbol mentions with provenance, so a match can cite its source. */
  mentions: IntentMention[];
  sources: IntentSourceRef[];
  conflicts: IntentConflict[];
  diagnostics: IntentDiagnostic[];
  confidence: IntentConfidence;
  /** Always false: normalization never calls a model or the network. */
  llmUsed: false;
  /** True when the caller requested LLM normalization; still not performed. */
  llmRequested: boolean;
}

/** A path or symbol explicitly named in an intent source, with provenance. */
export interface IntentMention {
  kind: "path" | "symbol";
  value: string;
  sourceId: string;
  sourceKind: IntentSourceKind;
  priority: number;
  span?: SourceSpan;
  excerpt?: string;
}

/** A resolved source reference kept on the normalized intent for provenance. */
export interface IntentSourceRef {
  id: string;
  kind: IntentSourceKind;
  priority: number;
  /** True when this source contributed the adopted goal. */
  adoptedGoal: boolean;
  /** True when a higher-precedence source shadowed this source's goal. */
  shadowed: boolean;
  path?: string;
  url?: string;
}

/** Options for `normalizeIntent`. LLM normalization is off by default. */
export interface NormalizeIntentOptions {
  /**
   * `"off"` (default) never requires credentials or network. `"auto"` records
   * that the caller wanted LLM normalization, but this module deliberately does
   * not perform it — an LLM judgement alone must never authorise removal, so the
   * deterministic result is returned and a diagnostic is recorded.
   */
  llm?: "off" | "auto";
}

/** Thrown when a structured plan or source document fails strict validation. */
export class IntentValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "IntentValidationError";
    this.issues = issues;
  }
}
