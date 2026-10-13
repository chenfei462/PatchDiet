/**
 * Scope classification types.
 *
 * Five principal states, exactly as the plan specifies, plus orthogonal risk
 * flags. Risk is deliberately NOT collapsed into the scope state: a change can
 * be `required` and carry a `public-api` risk flag, or `candidate` and be
 * low-risk. Equating "risky" with "out of scope" would be unsound.
 */

import type { EvidenceRecord } from "../../evidence/src/index.js";

export type ScopeState = "required" | "supporting" | "candidate" | "uncertain" | "protected";

/** The five states in deterministic report order. */
export const SCOPE_STATES: readonly ScopeState[] = [
  "required",
  "supporting",
  "candidate",
  "uncertain",
  "protected"
];

/**
 * Orthogonal risk flags. These never change the scope state on their own.
 */
export type RiskFlag =
  | "dependency-manifest"
  | "lockfile"
  | "migration"
  | "security"
  | "public-api"
  | "generated";

/** Risk flags in deterministic report order. */
export const RISK_FLAGS: readonly RiskFlag[] = [
  "dependency-manifest",
  "lockfile",
  "migration",
  "security",
  "public-api",
  "generated"
];

/** A risk flag with the evidence that raised it. */
export interface RiskAnnotation {
  flag: RiskFlag;
  detail: string;
  /** Evidence record ids that justify this flag. */
  evidenceIds: string[];
}

/** One classified atom. */
export interface AtomClassification {
  atomId: string;
  filePath: string;
  symbolPath?: string;
  state: ScopeState;
  /** Evidence ids that contributed to the state. */
  evidenceIds: string[];
  /** Evidence ids that argue against the state, or limit it. */
  counterEvidenceIds: string[];
  /** Deterministic explanation of the classification. */
  explanation: string;
  /** What inputs were missing that would have changed the classification. */
  missingInputs: string[];
  /** Conflicting inputs that made the atom uncertain. */
  conflicts: string[];
  risks: RiskAnnotation[];
  /** True when removal is permitted by this classification (candidate only). */
  removalEligible: boolean;
  /**
   * Always true: a scope classification never authorises deletion on its own.
   * The runtime oracle is still required. Present so a consumer cannot forget.
   */
  requiresRuntimeOracle: true;
}

export interface ScopeSummary {
  required: number;
  supporting: number;
  candidate: number;
  uncertain: number;
  protected: number;
  /** Number of atoms carrying at least one risk flag. */
  flagged: number;
}

/** The deterministic, serializable Scope Map report. */
export interface ScopeReport {
  schemaVersion: "patchdiet-scope/1";
  /** Stable hash of the intent + atoms + facts the analysis was derived from. */
  analysisId: string;
  intent: {
    goal: string;
    confidence: string;
    sourceIds: string[];
  };
  atoms: AtomClassification[];
  /** All evidence records cited by any classification, by id. */
  evidence: EvidenceRecord[];
  summary: ScopeSummary;
  /** Graph/index completeness diagnostics propagated from the facts. */
  graphDiagnostics: string[];
  /** Global limitations that apply to every classification in this report. */
  limits: string[];
  /** Always true: this report is produced by a read-only analysis. */
  readOnly: true;
  /** Always true: no deletion or subprocess oracle ran during analysis. */
  oracleExecuted: false;
}

/** The result of explaining one atom (or filtering by file/symbol). */
export interface AtomExplanation {
  schemaVersion: "patchdiet-explain/1";
  /** Requested atom id, echoed for correlation. */
  atomId?: string;
  /** True when the requested id was found; false means it was reported safely. */
  found: boolean;
  /** Present when found. */
  classification?: AtomClassification;
  /** Evidence records that contributed, resolved from the report. */
  evidence: EvidenceRecord[];
  /** Evidence records that argued against or limited the state. */
  counterEvidence: EvidenceRecord[];
  /** Risk annotations for the atom, kept separate from the scope state. */
  risks: RiskAnnotation[];
  /** A safe, deterministic message when the id/file/symbol was not found. */
  message: string;
  /** Always true: explanation is read-only evidence retrieval. */
  readOnly: true;
}

/** Filter for `explainAtoms`: any of atom id, file path or symbol. */
export interface ExplainFilter {
  atomId?: string;
  file?: string;
  symbol?: string;
}

/** Options for `analyzeScope`. */
export interface AnalyzeScopeOptions {
  /** Deterministic timestamp-free id salt is never needed; analysis is pure. */
  /** Optional override for the maximum graph traversal depth. */
  maxGraphDepth?: number;
}

/** Options for `explainAtom`. */
export interface ExplainAtomOptions {
  /** Restrict explanation to one of these filters. */
  file?: string;
  symbol?: string;
}
