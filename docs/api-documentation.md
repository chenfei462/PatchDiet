# API Documentation

This document describes the internal APIs of PatchDiet, organized by package.

## Table of Contents

- [Core Package (`@patchdiet/core`)](#core-package-patchdietcore)
  - [Types](#types)
  - [Configuration](#configuration)
  - [Diff Parsing](#diff-parsing)
  - [Git Operations](#git-operations)
  - [Shrink Engine](#shrink-engine)
  - [Report Rendering](#report-rendering)
- [CLI Package (`@patchdiet/cli`)](#cli-package-patchdietcli)
- [Report Package (`@patchdiet/report`)](#report-package-patchdietreport)
- [Action Package (`patchdiet`)](#action-package-patchdiet)

---

## Core Package (`@patchdiet/core`)

The core package provides the shrink engine, diff parsing, git operations, and configuration management.

### Entry Point

```typescript
export * from "./config.js";
export * from "./diff.js";
export * from "./git.js";
export * from "./runner.js";
export * from "./shrink.js";
export * from "./types.js";
```

### Types

#### `DiffLineKind`

```typescript
type DiffLineKind = "context" | "add" | "remove";
```

Represents the kind of a diff line.

#### `DiffLine`

```typescript
interface DiffLine {
  kind: DiffLineKind;
  text: string;
}
```

A single line in a diff hunk.

#### `DiffHunk`

```typescript
interface DiffHunk {
  header: string;   // e.g., "@@ -1,5 +1,6 @@"
  lines: DiffLine[];
  binary?: boolean;
}
```

A contiguous block of changes within a file.

#### `DiffFile`

```typescript
interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}
```

A file in a diff with its changes.

#### `ParsedDiff`

```typescript
interface ParsedDiff {
  files: DiffFile[];
}
```

A fully parsed unified diff.

#### `DiffSummary`

```typescript
interface DiffSummary {
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
  changedLineCount: number;
}
```

Statistics about a diff.

#### `CandidateCategory`

```typescript
type CandidateCategory =
  | "formatting-only"
  | "docs-only"
  | "dependency-related"
  | "generated-like"
  | "unknown";
```

Category for candidate hunks to help humans review.

#### `CandidateVerdict`

```typescript
type CandidateVerdict = "removed" | "kept" | "needs-human-review";
```

The final decision on a candidate hunk.

#### `EvidenceItem`

```typescript
interface EvidenceItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  reason: string;
  confidence: "high-confidence removal" | "kept" | "needs-human-review";
}
```

Evidence for decision making.

#### `CandidateItem`

```typescript
interface CandidateItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  verdict: CandidateVerdict;
  reason: string;
}
```

A candidate item with its verdict.

#### `TestCommandStatus`

```typescript
interface TestCommandStatus {
  command: string;
  status: "passed" | "failed" | "not-run";
  durationMs: number;
  attempts: number;
}
```

Status of a test command execution.

#### `ShrinkReport`

```typescript
interface ShrinkReport {
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
```

The complete shrink report returned after processing.

### Configuration (`config.ts`)

#### `PatchDietConfig`

```typescript
interface PatchDietConfig {
  base: string;
  language: string;
  commands: {
    required: string[];
    optional: string[];
  };
  reduction: {
    strategy: "conservative";
    atomGranularity: "hunk";
    maxRuntimeMinutes: number;
    retryFlakyTests: number;
  };
  scope: {
    ignorePaths: string[];
    allowFormatOnlyRemoval: boolean;
    flagDependencyBumps: boolean;
  };
  report: {
    html: boolean;
    markdown: boolean;
    githubComment: boolean;
  };
}
```

Configuration loaded from `patchdiet.yaml` or defaults.

#### Functions

```typescript
function loadPatchDietConfig(cwd: string): PatchDietConfig
function mergeConfigWithFlags(
  config: PatchDietConfig,
  flags: ConfigFlags
): PatchDietConfig
```

### Diff Parsing (`diff.ts`)

#### `parseUnifiedDiff`

```typescript
function parseUnifiedDiff(input: string): ParsedDiff
```

Parses a unified diff string into structured data.

#### `summarizeDiff`

```typescript
function summarizeDiff(parsed: ParsedDiff): DiffSummary
```

Computes statistics from a parsed diff.

### Git Operations (`git.ts`)

#### `DiffResult`

```typescript
interface DiffResult {
  diff: string;
}
```

Result from a git diff operation.

#### Functions

```typescript
async function getDiff(
  cwd: string,
  baseRef: string,
  headRef: string
): Promise<DiffResult>

async function runGit(args: string[], cwd: string): Promise<string>
```

### Shrink Engine (`shrink.ts`)

#### `RunShrinkOptions`

```typescript
interface RunShrinkOptions {
  cwd: string;
  baseRef: string;
  headRef: string;
  requiredCommands: string[];
  createBranch?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  ignorePaths?: string[];
  allowTestFileRemoval?: boolean;
  commandTimeoutMs?: number;
  retryFlakyTests?: number;
}
```

Options for the shrink operation.

#### Main Function

```typescript
async function runShrink(options: RunShrinkOptions): Promise<ShrinkReport>
```

Executes the shrink algorithm:

1. Runs required test commands to establish passing baseline
2. Gets diff between base and head refs
3. Parses diff into files and hunks
4. For each candidate, creates temporary worktree and tests reverse-apply
5. Builds cleanup patch from verified removals
6. Returns full shrink report

#### Helper Functions

```typescript
function countCandidates(paths: string[]): number
```

Counts candidate paths (unrelated demo paths).

### Runner Utilities (`runner.ts`)

#### `runCommand`

```typescript
async function runCommand(
  command: string,
  cwd: string,
  options?: { timeoutMs?: number }
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>
```

Runs a shell command with optional timeout.

### Report Rendering (`report/src/index.ts`)

#### Functions

```typescript
function renderMarkdownReport(report: ShrinkReport): string

function renderHtmlReport(report: ShrinkReport): string

function renderGitHubComment(report: ShrinkReport): string
```

Render the shrink report in different formats.

---

## CLI Package (`@patchdiet/cli`)

### Entry Point

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();
```

### Commands

#### `init`

```bash
patchdiet init
```

Creates `patchdiet.yaml` in the current directory with default configuration.

#### `check`

```bash
patchdiet check [--base <ref>] [--head <ref>] [--json]
```

Inspects diff statistics without making changes.

**Options:**
- `--base <ref>`: Override base git ref
- `--head <ref>`: Override head git ref
- `--json`: Output machine-readable JSON

**Default Detection:**
- Base: GitHub PR base, `origin/main`, `origin/master`, upstream merge-base
- Head: `HEAD`

#### `shrink`

```bash
patchdiet shrink [options]
```

Generates a cleanup patch after verifying test passes.

**Options:**
- `--base <ref>`: Override base git ref
- `--head <ref>`: Override head git ref
- `--test <command>`: Required check command (can be specified multiple times)
- `--create-branch`: Create a cleanup branch in a separate worktree
- `--apply`: Apply the cleanup patch to the current checkout
- `--dry-run`: Verify and print summary without writing artifacts
- `--allow-test-file-removal`: Allow removal of changed test files
- `--timeout-ms <ms>`: Timeout for each required command
- `--retry-flaky-tests <count>`: Retry failed tests before giving up
- `--json`: Output machine-readable JSON

**Test Command Detection:**
- Node: `pnpm test`, `npm test`, `yarn test`, `bun test`
- Python: `pytest`
- Go: `go test ./...`
- Rust: `cargo test`

#### `doctor`

```bash
patchdiet doctor [--base <ref>] [--head <ref>] [--test <command>]
```

Checks whether PatchDiet can run in this repository. Reports:
- Git availability
- Repository status
- Base/head ref detection
- Worktree status
- PatchDiet writable status

#### `report`

```bash
patchdiet report --format <format>
```

Renders an existing shrink report.

**Formats:** `markdown`, `html`, `github`, `json`

---

## Report Package (`@patchdiet/report`)

### Entry Point

```typescript
// packages/report/src/index.ts
export function renderMarkdownReport(report: ShrinkReport): string

export function renderHtmlReport(report: ShrinkReport): string

export function renderGitHubComment(report: ShrinkReport): string
```

### Report Sections

All reports include:
- **Summary**: Base/head refs, input/output stats, test command status
- **Removed**: Candidates verified as removable
- **Kept**: Candidates that must be retained
- **Needs human review**: Candidates requiring human judgment

Markdown reports also include:
- **Artifacts**: Paths to generated files

---

## Action Package (`patchdiet`)

The GitHub Action is defined in `action.yml` and the bundled entrypoint is `packages/action/dist/index.mjs`.

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `base` | Base git ref | GitHub PR base, `origin/main`, `origin/master`, upstream merge-base |
| `head` | Head git ref | `HEAD` |
| `test` | Required check command | Detected package/language test command |
| `github-token` | Token for PR comments | None (falls back to step summary) |

### Outputs

| Output | Path |
|--------|------|
| `report-md` | `.patchdiet/report.md` |
| `report-github` | `.patchdiet/report.github.md` |
| `report-html` | `.patchdiet/report.html` |
| `run-json` | `.patchdiet/run.json` |
| `cleanup-diff` | `.patchdiet/cleanup.diff` |

### Generated Artifacts

- `cleanup.diff`: The cleanup patch to apply
- `report.md`: Full Markdown analysis report
- `report.github.md`: Compact PR comment body
- `report.html`: Browser-friendly HTML report
- `run.json`: Machine-readable full report (JSON)

---

## Configuration Schema (`patchdiet.yaml`)

```yaml
version: 1
base: origin/main                # Base ref for diff
language: generic                  # Language hint (future)
commands:
  required:
    - npm test                    # Commands that must pass
  optional: []                     # Optional verification commands
reduction:
  strategy: conservative           # Only "conservative" supported
  atom_granularity: hunk           # Only "hunk" supported
  max_runtime_minutes: 20          # Per-command timeout
  retry_flaky_tests: 2             # Retry count for failed tests
scope:
  ignore_paths: []                 # Paths to always keep
  allow_format_only_removal: true  # Remove whitespace-only changes
  flag_dependency_bumps: true      # Flag package.json changes
report:
  html: true
  markdown: true
  github_comment: true
```

---

## Candidate Classification

Candidates are classified to help human reviewers:

| Category | Description | Default Verdict |
|----------|-------------|-----------------|
| `formatting-only` | Whitespace/indentation changes only | `removed` if `allowFormatOnlyRemoval` |
| `docs-only` | Changes to `.md`, `.txt` files | `needs-human-review` |
| `dependency-related` | Changes to lockfiles, `package.json` | `needs-human-review` |
| `generated-like` | Files in `dist/`, `build/`, `.min.*` | `removed` if tests pass |
| `unknown` | Other changes | `needs-human-review` |

Test files are always kept by default for human review.

---

## Error Handling

PatchDiet uses these error patterns:

```typescript
// No test command detected
throw new Error(noTestCommandMessage());

// Base ref not found
throw new Error("Could not detect a base ref. Set the action 'base' input, for example: base: origin/main");

// Command timeout
throw new Error(`required command timed out after ${options.timeoutMs}ms: ${command}`);

// Command failure
throw new Error(`required command failed: ${command}`);
```

---

## API Versioning

Current stable version: `0.1.1`

Breaking changes tracked under `codex/hackathon-judge-mode` branch for development.