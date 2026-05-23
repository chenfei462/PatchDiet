export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  binary?: boolean;
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
}

export interface DiffSummary {
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
  changedLineCount: number;
}

export type CandidateCategory =
  | "formatting-only"
  | "docs-only"
  | "dependency-related"
  | "generated-like"
  | "unknown";

export type CandidateVerdict = "removed" | "kept" | "needs-human-review";

export interface EvidenceItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  reason: string;
  confidence: "high-confidence removal" | "kept" | "needs-human-review";
}

export interface CandidateItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  verdict: CandidateVerdict;
  reason: string;
}

export interface TestCommandStatus {
  command: string;
  status: "passed" | "failed" | "not-run";
  durationMs: number;
  attempts: number;
}

export interface ShrinkReport {
  baseRef: string;
  headRef: string;
  input: DiffSummary;
  output: DiffSummary;
  testCommand: TestCommandStatus;
  candidates: CandidateItem[];
  removals: EvidenceItem[];
  kept: EvidenceItem[];
  needsHumanReview: EvidenceItem[];
  artifacts: string[];
  reportPath?: string;
  reportJsonPath?: string;
  cleanupBranch?: string;
  cleanupWorktreePath?: string;
  patchPath?: string;
}
