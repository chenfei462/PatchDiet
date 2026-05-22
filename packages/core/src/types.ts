export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  newPath?: string;
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

export interface EvidenceItem {
  filePath: string;
  hunkHeader: string;
  reason: string;
  confidence: "high-confidence removal" | "kept" | "needs-human-review";
  category: EvidenceCategory;
}

export type EvidenceCategory =
  | "formatting-only"
  | "dependency-bump"
  | "docs-comment-only"
  | "unrelated-path"
  | "required-by-check"
  | "reverse-apply-failed"
  | "needs-human-review"
  | "ignored-path";

export interface ShrinkReport {
  baseRef: string;
  input: DiffSummary;
  output: DiffSummary;
  removals: EvidenceItem[];
  kept: EvidenceItem[];
  needsHumanReview: EvidenceItem[];
  reportPath?: string;
  reportJsonPath?: string;
  cleanupBranch?: string;
  cleanupWorktreePath?: string;
  patchPath?: string;
}
