# User Guide

**PatchDiet** is a local-first CLI tool that shrinks AI-generated pull requests into smaller, easier-to-review patches. It sits between "the agent passed tests" and "a human has to review this patch." Use PatchDiet after Claude Code, Codex, Cursor, OpenHands, Devin-like agents, or similar AI coding workflows have produced a branch that passes tests but feels bloated.

---

## Quickstart

### From This Repository

```bash
npm ci
npm run build
node dist/packages/cli/src/index.js doctor
node dist/packages/cli/src/index.js shrink
```

### From Another Repository (Until Package Published)

```bash
git clone https://github.com/chenfei462/PatchDiet.git
cd PatchDiet
npm ci
npm run build
npm pack
npm install -g ./patchdiet-*.tgz
```

Then run:

```bash
patchdiet doctor
patchdiet check
patchdiet shrink
```

### Using the Installed Binary

```bash
patchdiet doctor
patchdiet check
patchdiet shrink
```

---

## Commands

### `patchdiet init`

Creates `patchdiet.yaml` in the current directory with a minimal example configuration.

```yaml
# Generated patchdiet.yaml
version: 1
base: origin/main
commands:
  required: []
  optional: []
reduction:
  strategy: conservative
  atom_granularity: hunk
  max_runtime_minutes: 20
  retry_flaky_tests: 2
scope:
  ignore_paths: []
report:
  html: true
  markdown: true
  github_comment: true
```

Use this when starting a new project or resetting your configuration.

### `patchdiet doctor`

Checks whether PatchDiet can run in this repository. Reports:

- Git availability
- Repository worktree status
- Base/head ref detection results
- Test command detection
- `.patchdiet/` directory writability

**Example Output:**

```
PatchDiet doctor

git: ok
repository: ok
base: origin/main
head: HEAD (not found)
worktree: clean

.test: not detected

test hint: patchdiet shrink --test "npm test"

.patchdiet: writable
```

Use `doctor` after `init` or after setting up a new repository.

### `patchdiet check`

Inspects diff statistics without making changes. Shows a human-readable summary by default, or machine-readable JSON with `--json`.

**Human-readable output:**

```
PatchDiet check

Base: origin/main
Head: HEAD
Files: 4
Hunks: 4
Lines: 14 changed (+9/+5)
Candidate paths: 2

Next: run patchdiet shrink to create .patchdiet/cleanup.diff after local tests pass.
```

**Machine-readable output (`--json`):**

```json
{
  "fileCount": 4,
  "hunkCount": 4,
  "addedLineCount": 9,
  "removedLineCount": 5,
  "changedLineCount": 14,
  "candidateCount": 2,
  "base": "origin/main",
  "head": "HEAD"
}
```

Use `check` to preview what PatchDiet would process before running `shrink`.

### `patchdiet shrink`

Generates a conservative cleanup patch after verifying test passes. The core algorithm:

1. **Run tests** on the current head to establish a passing baseline
2. **Get diff** between configured base and head refs
3. **Parse** diff into files and hunk units
4. **Classify** candidates (docs-only, dependency-related, generated-like, etc.)
5. **Test removals** in temporary worktrees to verify safety
6. **Build cleanup patch** from verified removals
7. **Write reports** explaining decisions

**Key behaviors:**

- **Safety first:** Only removes hunks when local tests still pass after reverting them
- **No branch rewrites by default:** Artifacts are written but current branch is untouched
- **Test files are kept by default:** Changed test files go to "needs human review"
- **Binary diffs are marked for review:** Binary files cannot be automatically cleaned up

**Options:**

| Option | Description |
|--------|-------------|
| `--base <ref>` | Override base git ref (e.g., `origin/main`, `main`) |
| `--head <ref>` | Override head git ref (e.g., `HEAD`, `feature/ai-changes`) |
| `--test <command>` | Required check command (can be specified multiple times) |
| `--create-branch` | Create a cleanup branch in a separate worktree |
| `--apply` | Apply the cleanup patch to the current checkout |
| `--dry-run` | Verify and print summary without writing `.patchdiet/` artifacts |
| `--allow-test-file-removal` | Allow PatchDiet to remove changed test files when checks still pass |
| `--timeout-ms <ms>` | Override per-command timeout |
| `--retry-flaky-tests <count>` | Retry failed required checks before giving up |
| `--json` | Output machine-readable JSON |

**Examples:**

```bash
# Zero-config: PatchDiet detects everything automatically
patchdiet shrink

# Explicit test command and base ref
patchdiet shrink --base origin/main --head HEAD --test "npm test"

# Preview without writing artifacts
patchdiet shrink --dry-run

# Apply the cleanup patch immediately
patchdiet shrink --apply

# Create a cleanup branch for PR creation
patchdiet shrink --create-branch

# For slow or flaky tests
patchdiet shrink --timeout-ms 120000 --retry-flaky-tests 1

# Output machine-readable JSON for automation
patchdiet shrink --json
```

**Test Command Detection:**

PatchDiet automatically detects test commands:

- **Node.js projects:** `pnpm test`, `npm test`, `yarn test`, `bun test`
- **Python projects:** `pytest`
- **Go projects:** `go test ./...`
- **Rust projects:** `cargo test`

If detection fails or you need a custom command, specify it with `--test`.

### `patchdiet report`

Renders an existing shrink report in different formats.

**Usage:**

```bash
patchdiet report --format markdown
patchdiet report --format html
patchdiet report --format github
patchdiet report --format json
```

This is useful for:

- Reviewing past shrink results
- Generating PR comments from existing reports
- Displaying reports in web browsers
- Importing reports into automation tools

### `patchdiet card`

Re-renders the shareable Diet Card from an existing `.patchdiet/run.json`, with an optional
project name and output format. `patchdiet shrink` already writes `.patchdiet/diet-card.svg`;
use this command to regenerate it with a different label or format.

**Usage:**

```bash
patchdiet card --project "my-repo" --format svg --output .patchdiet/diet-card.svg
patchdiet card --project "my-repo" --format html --output .patchdiet/diet-card.html
patchdiet card --project "my-repo" --format png --output .patchdiet/diet-card.png
patchdiet card --format badge --badge-url "https://your-host.example/patchdiet/pr-123.svg"
```

The command prints the path it wrote. It requires a previous `patchdiet shrink` run in the
same directory, because it reads the recorded report rather than re-running checks.

---

## Exit Codes

Every command follows the same contract, so scripts and CI can branch on the result:

| Code | Meaning |
| --- | --- |
| `0` | The command completed and every check it performs passed. |
| `1` | The command ran but something it checked failed — `doctor` found a repository readiness problem, `check` found the diff unusable, or `shrink` could not produce a verified cleanup patch. |

A non-zero exit code from `patchdiet shrink` means PatchDiet could not verify a cleanup; it
does not mean the pull request is bad. Inspect `.patchdiet/report.md` for the reason, and
remember that candidates PatchDiet could not verify are kept or sent to human review rather
than removed.

---

## Configuration

### Configuration File

PatchDiet uses `patchdiet.yaml` in the project root (can be created with `patchdiet init`):

```yaml
version: 1
base: origin/main
language: generic
commands:
  required:
    - npm test
  optional: []
reduction:
  strategy: conservative
  atom_granularity: hunk
  max_runtime_minutes: 20
  retry_flaky_tests: 2
scope:
  ignore_paths: []
  allow_format_only_removal: true
  flag_dependency_bumps: true
report:
  html: true
  markdown: true
  github_comment: true
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `base` | string | `origin/main` | Git ref to compare against |
| `language` | string | `generic` | Language hint (reserved for future) |
| `commands.required` | array | `[]` | Commands that must pass to allow removals |
| `commands.optional` | array | `[]` | Optional verification commands |
| `reduction.strategy` | string | `conservative` | Only "conservative" supported |
| `reduction.atomGranularity` | string | `hunk` | Only "hunk" supported |
| `reduction.maxRuntimeMinutes` | number | `20` | Per-command timeout in minutes |
| `reduction.retryFlakyTests` | number | `2` | Retry count for failed tests |
| `scope.ignorePaths` | array | `[]` | Paths to always keep in cleanup |
| `scope.allowFormatOnlyRemoval` | boolean | `true` | Remove whitespace-only changes |
| `scope.flagDependencyBumps` | boolean | `true` | Flag package.json changes for review |
| `report.html` | boolean | `true` | Generate HTML report |
| `report.markdown` | boolean | `true` | Generate Markdown report |
| `report.githubComment` | boolean | `true` | Generate GitHub comment report |

### Detection Logic

When flags are omitted, PatchDiet tries to detect:

1. **Base ref:**
   - GitHub Actions PR context: `origin/PR_NUMBER`
   - Configuration `base` value
   - `origin/main`, `origin/master`
   - Upstream merge-base (`upstream/main`, `upstream/master`)

2. **Head ref:** Default to `HEAD`

3. **Test command:**
   - Node: `pnpm test`, `npm test`, `yarn test`, `bun test`
   - Python: `pytest`
   - Go: `go test ./...`
   - Rust: `cargo test`

If detection is not possible, pass the missing values explicitly:

```bash
patchdiet shrink --base origin/main --head HEAD --test "npm test"
```

---

## Outputs

PatchDiet writes artifacts under `.patchdiet/`:

### Generated Files

- `cleanup.diff`: The cleanup patch (see applying below)
- `report.md`: Full Markdown analysis report
- `report.github.md`: Compact PR comment body
- `report.html`: Browser-friendly HTML report
- `run.json`: Machine-readable full report (JSON)

### Report Formats

#### Markdown Report

Contains:
- Summary with before/after diff stats
- Test command status and duration
- Removed candidates (with evidence)
- Kept candidates (with evidence)
- Needs human review candidates
- Artifacts list

#### HTML Report

Interactive web page with:
- Side-by-side before/after statistics
- Color-coded candidate sections
- Full evidence details
- Printable format

#### GitHub Comment

Compact table format optimized for GitHub's markdown rendering:

```
| Metric | Before | After |
|--------|--------|-------|
| Files | 4 | 2 |
| Hunks | 4 | 1 |
| Changed lines | 14 | 10 |

Tests: passed with `npm test` (2.3s, 1 attempt)
Removed: 1 | Kept: 1 | Needs review: 2

Cleanup patch: .patchdiet/cleanup.diff
```

#### JSON Report

Structured data for automation:

```json
{
  "baseRef": "origin/main",
  "headRef": "HEAD",
  "input": { "fileCount": 4, ... },
  "output": { "fileCount": 2, ... },
  "testCommand": { "command": "npm test", "status": "passed", ... },
  "candidates": [...],
  "removals": [...],
  "kept": [...],
  "needsHumanReview": [...],
  "artifacts": [...]
}
```

### Outputs Feature

When running within GitHub Actions, the Action sets outputs:

- `report-md`: Path to `.patchdiet/report.md`
- `report-github`: Path to `.patchdiet/report.github.md`
- `report-html`: Path to `.patchdiet/report.html`
- `run-json`: Path to `.patchdiet/run.json`
- `cleanup-diff`: Path to `.patchdiet/cleanup.diff`

These can be used in subsequent steps:

```yaml
tasks:
  - uses: actions/download-artifact@v4
    with:
      pattern: patchdiet-report
      merge-multiple: true
  - run: patchdiet report --format markdown
    continue-on-error: true
```

---

## Applying the Cleanup Patch

### Inspection

Before applying, always review the cleanup patch:

```bash
# View the patch
cat .patchdiet/cleanup.diff

# Or generate a Markdown report first
patchdiet report --format markdown
```

### Safe Application

**Option 1: Inspect and apply manually**

```bash
# View patch
cat .patchdiet/cleanup.diff

# Apply if it looks good
git apply .patchdiet/cleanup.diff
```

**Option 2: Use `patchdiet shrink --apply`**

```bash
patchdiet shrink --apply
```

This will:
1. Generate the cleanup patch
2. Apply it to the current checkout
3. Write all reports
4. Leave you with a cleaned repository

**Option 3: Create a cleanup branch**

```bash
patchdiet shrink --create-branch
```

This will:
1. Generate the cleanup patch
2. Create a new branch in a worktree
3. Apply the patch to that branch
4. Write all reports
5. Leave you with both the original branch and a clean branch

### Dry Run

To preview the shrink without writing artifacts:

```bash
patchdiet shrink --dry-run
```

This will:
1. Run the same verification logic
2. Print the summary to stdout
3. NOT write any `.patchdiet/` files
4. Exit with success/failure based on verification

---

## Common Workflows

### 1. Post-Agent PR Processing

After an AI agent has created a PR that passes tests but feels bloated:

```bash
# Navigate to repository with agent PR
cd /path/to/repo

# Run doctor to ensure everything works
patchdiet doctor

# Check what would be processed
patchdiet check

# Run shrink (safe - will not modify branch)
patchdiet shrink

# Review the cleanup patch
cat .patchdiet/cleanup.diff

# Create a new branch with cleanup (recommended)
patchdiet shrink --create-branch

# Or apply the patch immediately if you're confident
patchdiet shrink --apply
```

### 2. CI/CD Integration

In GitHub Actions:

```yaml
name: PatchDiet PR

on:
  pull_request:

jobs:
  patchdiet:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: chenfei462/PatchDiet@v0.1.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: patchdiet-report
          path: .patchdiet/**
```

### 3. Local Development Debugging

When debugging why a specific hunk is being kept or marked for review:

```bash
# Run doctor for diagnostics
patchdiet doctor

# Check candidate classification
patchdiet check --json

# For more details about classification
node dist/packages/cli/src/index.js check --json
```

### 4. Zero-Config in Unknown Repository

When PatchDiet cannot detect the test command or base ref:

```bash
# Use zero-config detection
patchdiet shrink --test "npm test" --base origin/main

# Or create a patchdiet.yaml first
patchdiet init
```

---

## Advanced Usage

### Configuring Test Commands

For projects with custom test commands:

```yaml
# In patchdiet.yaml
commands:
  required:
    - "npm run ci"  # Instead of just "npm test"
    - "npx eslint ." # Additional lint check
  optional: []
```

### Custom Ignore Paths

To keep certain files regardless of their content:

```yaml
scope:
  ignore_paths:
    - "README.md"
    - "CHANGELOG.md"
    - "*.md"
    - "dist/**"
    - "build/**"
```

### Timeout and Retry

For slow CI environments:

```yaml
reduction:
  max_runtime_minutes: 30  # 30 minutes per command
  retry_flaky_tests: 3      # Retry up to 3 times
```

Or override with command-line flags:

```bash
patchdiet shrink --timeout-ms 1800000 --retry-flaky-tests 3
```

### Skipping Test File Removal

By default, changed test files are kept for human review. To allow PatchDiet to remove them when tests still pass:

```bash
patchdiet shrink --allow-test-file-removal
```

Or in configuration:

```yaml
scope:
  allow_test_file_removal: true
```

### Reporting for Automation

To integrate with external tools, use the JSON format:

```bash
patchdiet shrink --json > shrink-report.json
```

This gives you complete programmatic access to:
- Candidate decisions
- Test command results
- Artifacts locations
- Before/after statistics

---

## Troubleshooting

### "No test command detected"

**Solution:**

1. Run `patchdiet doctor` to see the hint
2. Add `--test "your-test-command"` to `patchdiet shrink`
3. Or detect automatically: create a `package.json` with `scripts.test`

**Examples:**

```bash
patchdiet shrink --test "npm test"
patchdiet shrink --test "pnpm test"
patchdiet shrink --test "pytest"
```

### "Could not detect a base ref"

**Solution:**

1. Set explicit base: `patchdiet shrink --base origin/main`
2. Ensure you have `origin/main` or `origin/master`
3. In GitHub Actions, ensure the PR context is set

### "Required command timed out"

**Solution:**

1. Increase timeout: `patchdiet shrink --timeout-ms 300000`
2. Configure longer timeout in `patchdiet.yaml`
3. If the command itself is slow, optimize it or consider splitting

### "PatchDiet directory not writable"

**Solution:**

1. Check permissions: `ls -la .patchdiet`
2. Remove or recreate the directory: `rm -rf .patchdiet`
3. Ensure you're in a writable workspace

### "Binary diff requires human review"

**Solution:**

This is expected behavior. Binary files are marked for human review because:

1. They cannot be safely transformed into text patches
2. The content may be images, compiled binaries, or other non-text files
3. Safety requires human judgment for these changes

This is not an error - it's a deliberate safety feature.

---

## Safety and Philosophy

### What PatchDiet Does

- **Local-first:** Everything runs on your machine or GitHub runner
- **Test-verified:** Only removes hunks when tests still pass
- **Conservative:** Never removes hunks unless explicitly verified
- **Transparent:** Reports show exactly what was removed and why
- **Non-destructive:** Doesn't rewrite your current branch

### What PatchDiet Doesn't Do

- **No LLM usage:** Decisions are made with git diffs and your test command
- **No semantic equivalence proof:** It only verifies that the smaller patch passes your checks
- **No PR review automation:** It's a cleanup tool, not a reviewer
- **No source upload:** Repository contents stay on your machine

### Safety Contract

```
- No source upload: repository contents stay on your machine or runner
- No LLM required: decisions are made with git diffs and your test command
- Test-verified removals: hunks are removed only when checks still pass after reverting them
- Local-first: all shrink work happens in temporary local git worktrees
- No branch rewrite by default: patchdiet shrink writes artifacts; it does not rewrite your current branch
- Cleanup patch generated separately: inspect .patchdiet/cleanup.diff before applying it
```

### When to Use PatchDiet

1. **After AI coding:** For PRs from Claude Code, Codex, Cursor, OpenHands, etc.
2. **When tests pass but PR looks bloated:** Inconsistent scope, docs changes, generated files
3. **When you want verification:** Need to trust that the smaller patch still works
4. **For human review assistance:** Want reviewers to see only the essential changes

### When NOT to Use PatchDiet

1. **Critical systems:** Don't use on production code without extra review layers
2. **Unsafe test commands:** If your test command doesn't properly validate functionality
3. **Manual code review required:** When changes need semantic understanding
4. **First-time users:** When you're not familiar with the generated artifacts

---

## Getting Help

### Documentation

- [Quickstart](docs/quickstart.md) - Getting started guide
- [Algorithm](docs/algorithm.md) - How it works
- [Config](docs/config.md) - Configuration reference
- [Examples](docs/examples.md) - Example scenarios
- [Safety](docs/safety.md) - Safety model

### Support

- [GitHub Issues](https://github.com/chenfei462/PatchDiet/issues)
- [Discussions](https://github.com/chenfei462/PatchDiet/discussions)

### Community

- [Web Demo](docs/demo.md) - Try the browser preview
- [Release Notes](docs/release.md) - Version history
- [Roadmap](docs/roadmap.md) - Future features

---

## License

MIT