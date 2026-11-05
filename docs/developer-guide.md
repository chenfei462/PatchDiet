# Development Guide

This document covers setting up the development environment, building, testing, and contributing to PatchDiet.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Building](#building)
- [Testing](#testing)
- [Code Architecture](#code-architecture)
- [Contributing](#contributing)
- [Release Process](#release-process)

---

## Prerequisites

### Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Runtime for all packages |
| npm | 9+ | Package management |
| Git | 2.30+ | Version control operations |
| TypeScript | 5.8+ | Type checking |

### Optional for Development

| Tool | Purpose |
|------|---------|
| VS Code | IDE with TypeScript support |
| Node.js LTS | Stable runtime |

### Verification

```bash
node --version  # Should be 20+
npm --version   # Should be 9+
git --version   # Should be 2.30+
```

---

## Project Structure

```
PatchDiet/
├── packages/
│   ├── core/              # Core shrink engine
│   │   ├── src/
│   │   │   ├── config.ts  # Configuration loading
│   │   │   ├── diff.ts    # Diff parsing
│   │   │   ├── git.ts     # Git operations
│   │   │   ├── runner.ts  # Command runner
│   │   │   ├── shrink.ts  # Shrink algorithm
│   │   │   └── types.ts   # Type definitions
│   │   └── package.json
│   ├── cli/               # Command-line interface
│   │   └── src/
│   │       └── index.ts   # CLI entry point
│   │   └── package.json
│   ├── report/            # Report rendering
│   │   └── src/
│   │       └── index.ts   # Markdown/HTML/GitHub renderers
│   │   └── package.json
│   ├── action/            # GitHub Action wrapper
│   │   ├── index.mjs      # Bundled entry point
│   │   └── package.json
│   └── github-app/        # GitHub App preview
│       └── src/
├── docs/                  # Documentation
├── examples/              # Example scenarios
├── tests/                 # Test suites
│   ├── e2e/              # End-to-end tests
│   └── unit/             # Unit tests
├── scripts/               # Build/release scripts
├── tsconfig.json          # TypeScript configuration
├── vitest.config.ts       # Test configuration
└── package.json           # Root workspace configuration
```

### Package Dependencies

```
patchdiet (root)
├── @patchdiet/core: v0.1.0
│   └── yaml: ^2.8.1
├── @patchdiet/cli: v0.1.0
│   ├── commander: ^14.0.2
│   └── @patchdiet/core: 0.1.0
└── @patchdiet/report: v0.1.0
    └── @patchdiet/core: 0.1.0
```

---

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/chenfei462/PatchDiet.git
cd PatchDiet
npm ci
```

### 2. Build

```bash
npm run build
```

This compiles TypeScript and bundles the GitHub Action entrypoint.

### 3. Verify

```bash
npm run typecheck
npm test
```

### 4. Run Locally

From this repository:

```bash
node dist/packages/cli/src/index.js doctor
node dist/packages/cli/src/index.js shrink
```

---

## Building

### Root Build

```bash
npm run build
```

**What it does:**
1. Compiles TypeScript with `tsc -p tsconfig.json`
2. Bundles Action with esbuild: `packages/action/index.mjs` → `packages/action/dist/index.mjs`

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2020",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  }
}
```

### Type Checking Only

```bash
npm run typecheck
```

Does not emit files; only checks for type errors.

### Output Structure

After building:

```
dist/
├── packages/
│   ├── cli/
│   │   └── src/
│   │       └── index.js
│   ├── core/
│   │   └── src/
│   │       ├── config.js
│   │       ├── diff.js
│   │       ├── git.js
│   │       ├── runner.js
│   │       ├── shrink.js
│   │       └── types.js
│   └── report/
│       └── src/
│           └── index.js
packages/action/dist/
└── index.mjs
```

---

## Testing

### Run All Tests

```bash
npm test
```

This runs Vitest with both unit and e2e tests.

### Test Structure

```
tests/
├── e2e/
│   ├── action.test.ts            # GitHub Action integration
│   ├── cli.test.ts               # CLI commands
│   ├── example-bootstrap.test.ts  # Example repo setup
│   ├── examples-smoke.test.ts     # Example scenarios
│   ├── failure-recovery.test.ts   # Error handling
│   ├── installable.test.ts        # Package installation
│   ├── release-readiness.test.ts  # Release checks
│   └── shrink-ts-example.test.ts  # TypeScript example
└── unit/
    ├── config.test.ts            # Configuration tests
    └── report.test.ts            # Report rendering tests
```

### Running Specific Test Suites

**Unit tests only:**

```bash
npx vitest run tests/unit/
```

**E2E tests only:**

```bash
npx vitest run tests/e2e/
```

**Specific test file:**

```bash
npx vitest run tests/e2e/examples-smoke.test.ts
```

### Watch Mode

```bash
npm run test:watch
```

Runs Vitest in watch mode; reruns tests on file changes.

### Test Coverage

Tests cover:

- **Configuration loading:** Valid/invalid `patchdiet.yaml`, defaults, flags
- **Diff parsing:** Unified diff format, hunks, binary files
- **Candidate classification:** Docs, dependencies, generated files, formatting
- **Shrink algorithm:** File-level and hunk-level verification
- **Report rendering:** Markdown, HTML, GitHub comment formats
- **CLI commands:** `init`, `doctor`, `check`, `shrink`, `report`
- **GitHub Action:** Input handling, output setting, comment publishing
- **Failure recovery:** Command timeouts, missing refs, permission issues

---

## Code Architecture

### Core Packages

#### `@patchdiet/core`

The shrink engine. Responsibilities:

1. **Configuration** (`config.ts`)
   - Load `patchdiet.yaml`
   - Merge CLI flags
   - Provide defaults

2. **Diff Parsing** (`diff.ts`)
   - Parse unified diff format
   - Summarize file/hunk statistics
   - Handle binary files

3. **Git Operations** (`git.ts`)
   - Get diffs between refs
   - Run arbitrary git commands
   - Worktree management

4. **Command Runner** (`runner.ts`)
   - Execute test commands
   - Handle timeouts
   - Capture stdout/stderr

5. **Shrink Algorithm** (`shrink.ts`)
   - Run baseline tests
   - Classify candidates
   - Verify removals in worktrees
   - Build cleanup patch
   - Generate reports

#### `@patchdiet/report`

Report rendering. Responsibilities:

1. **Markdown Report** (`renderMarkdownReport`)
   - Human-readable summary
   - Candidate evidence
   - Artifacts list

2. **HTML Report** (`renderHtmlReport`)
   - Browser-friendly format
   - Before/after statistics
   - Styled sections

3. **GitHub Comment** (`renderGitHubComment`)
   - Compact table format
   - Screenshot-friendly
   - PR comment body

#### `@patchdiet/cli`

Command-line interface. Responsibilities:

1. **Command definitions** (`commander`)
   - `init`, `doctor`, `check`, `shrink`, `report`

2. **Ref resolution**
   - GitHub Actions PR context
   - Git remote refs
   - Upstream merge-base

3. **Test command detection**
   - Node.js package detection
   - Python `pytest` detection
   - Go/Rust project detection

4. **Report rendering**
   - Format from `report` command
   - JSON output for automation

#### `patchdiet` (Action)

GitHub Action wrapper. Responsibilities:

1. **Input handling**
   - Base/head ref detection
   - Test command detection

2. **Report generation**
   - Markdown, HTML, GitHub comment

3. **GitHub integration**
   - PR comment publishing
   - Step summary
   - Outputs for downstream steps

### Data Flow

```
┌─────────────┐
│  User Input  │
│ (CLI/Action) │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Config     │
│  Load YAML  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Diff       │
│  Get Diff   │
│  Parse Diff │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Shrink     │
│  Classify   │
│  Verify     │
│  Rebuild    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Report     │
│  Markdown   │
│  HTML       │
│  GitHub     │
└─────────────┘
```

---

## Contributing

### Development Workflow

1. **Fork and clone** the repository
2. **Install dependencies:** `npm ci`
3. **Build:** `npm run build`
4. **Run tests:** `npm test`
5. **Make changes** in a feature branch
6. **Test your changes:** Run relevant test suite
7. **Run linting:** `npm run typecheck`
8. **Commit with clear messages**
9. **Push and create PR**

### Code Style

- **TypeScript strict mode:** All code uses strict TypeScript
- **ESLint compatible:** Follow existing patterns
- **Consistent naming:** camelCase for variables, PascalCase for types
- **JSDoc comments:** Document public APIs and complex logic
- **No untyped `any`:** Use proper types or `unknown`

### Adding New Features

1. **Update types** in `packages/core/src/types.ts`
2. **Add implementation** in the appropriate package
3. **Export from** `packages/core/src/index.ts`
4. **Add tests** in `tests/unit/` or `tests/e2e/`
5. **Update documentation** in `docs/`
6. **Run full test suite:** `npm test`
7. **Check types:** `npm run typecheck`

### Testing Guidelines

**Unit tests:**
- Test individual functions in isolation
- Mock external dependencies (git, file system)
- Cover edge cases and error conditions

**E2E tests:**
- Test complete workflows with real git repos
- Use example scenarios in `examples/`
- Verify artifacts and reports

**Test patterns:**

```typescript
// Test configuration loading
test('loadPatchDietConfig returns defaults when no config exists', async () => {
  const config = loadPatchDietConfig('/tmp/nonexistent');
  expect(config.base).toBe('origin/main');
  expect(config.commands.required).toEqual([]);
});

// Test diff parsing
test('parseUnifiedDiff handles hunks correctly', () => {
  const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3`;
  const parsed = parseUnifiedDiff(diff);
  expect(parsed.files[0].hunks.length).toBe(1);
  expect(parsed.files[0].hunks[0].lines[1].kind).toBe('add');
});
```

### Commit Message Format

```
type: description

[optional body]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions or changes
- `refactor`: Code refactoring
- `chore`: Build/tooling changes

**Examples:**

```
feat: add hunk-level verification in shrink engine
fix: handle binary files in candidate classification
docs: update API documentation
test: add e2e test for example scenarios
```

---

## Release Process

### Versioning

PatchDiet uses semantic versioning:

- **Patch (0.1.x):** Bug fixes, non-breaking changes
- **Minor (0.x.0):** New features, backward compatible
- **Major (x.0.0):** Breaking changes

Current version: `0.1.1`

### Pre-release Checklist

1. **Run all tests:** `npm test`
2. **Type check:** `npm run typecheck`
3. **Build:** `npm run build`
4. **Verify examples:** `npm run bench:examples`
5. **Check documentation:** Verify all docs are current
6. **Update CHANGELOG.md**
7. **Tag release:** `git tag vX.Y.Z`
8. **Publish:** `npm publish --access public` (when ready)

### Trusted Publishing

PatchDiet uses npm trusted publishing. Ensure:

1. GitHub Actions workflow is configured
2. OIDC token is set up
3. npm package ownership verified

See [npm-publishing.md](npm-publishing.md) for details.

### Version Bump

```bash
# Update version in package.json
npm version patch  # or minor, major

# Build and test
npm run build
npm test

# Publish (when ready)
npm publish --access public
```

### GitHub Release

1. **Tag the release:** `git tag vX.Y.Z`
2. **Push the tag:** `git push origin vX.Y.Z`
3. **Create release** on GitHub
4. **Attach artifacts:**
   - `.patchdiet/cleanup.diff`
   - `.patchdiet/report.md`
   - `.patchdiet/run.json`

---

## Common Development Tasks

### Running a Specific Example

```bash
# Build first
npm run build

# Run shrink on an example
node dist/packages/cli/src/index.js shrink \
  --base main \
  --head agent/bloated \
  --test "node --test"
```

### Debugging

```bash
# Run with verbose output
node --trace-warnings dist/packages/cli/src/index.js shrink

# Check configuration
node dist/packages/cli/src/index.js doctor

# Inspect diff stats
node dist/packages/cli/src/index.js check --json
```

### Updating Dependencies

```bash
# Update all packages
npm update

# Update a specific package
npm install <package>@latest

# Lock file update
npm install --package-lock-only
```

### Adding a New Command

1. Add command definition in `packages/cli/src/index.ts`
2. Add implementation in the appropriate package
3. Export from `packages/core/src/index.ts` if needed
4. Add tests in `tests/unit/` or `tests/e2e/`
5. Update documentation in `docs/user-guide.md`
6. Update this guide if architecture changes

### Adding a New Report Format

1. Add renderer function in `packages/report/src/index.ts`
2. Export from `packages/report/src/index.ts`
3. Add to CLI in `packages/cli/src/index.ts`
4. Add tests in `tests/unit/report.test.ts`
5. Update documentation

---

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR | Build, test, typecheck |
| `patchdiet-pr.yml` | PR | Run PatchDiet on PRs |
| `publish-npm.yml` | Release | Publish to npm |

### CI Commands

```bash
# Full CI pipeline
npm ci
npm run build
npm run typecheck
npm test

# Example smoke tests
npm test -- tests/e2e/examples-smoke.test.ts
```

### Workflow Structure

```yaml
# Example CI workflow
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm test
```

---

## Architecture Decisions

### Why No LLM?

PatchDiet uses git diffs and test commands instead of LLMs because:

1. **Cost:** No API calls for every PR
2. **Privacy:** No source code upload
3. **Reliability:** Test results are deterministic
4. **Speed:** Local execution is fast
5. **Auditability:** Reports show exactly what was checked

### Why Conservative?

PatchDiet takes a conservative approach:

1. **Test-first:** Only removes hunks when tests pass
2. **Human review:** Marked items need human judgment
3. **No branch rewrite:** Original branch stays intact
4. **Transparent:** Reports explain every decision

### Why Hunk-Level?

File-level removal is tried first, then hunk-level:

1. **Efficiency:** File-level is faster than hunk-level
2. **Precision:** Hunk-level catches more removable content
3. **Safety:** Each level is verified independently

---

## Resources

### Documentation

- [API Documentation](api-documentation.md) - Internal APIs
- [User Guide](user-guide.md) - End-user documentation
- [Quickstart](quickstart.md) - Getting started
- [Algorithm](algorithm.md) - How it works
- [Config](config.md) - Configuration reference
- [Safety](safety.md) - Safety model
- [Examples](examples.md) - Example scenarios

### Source Files

- `packages/core/src/types.ts` - Type definitions
- `packages/core/src/config.ts` - Configuration
- `packages/core/src/diff.ts` - Diff parsing
- `packages/core/src/shrink.ts` - Shrink engine
- `packages/cli/src/index.ts` - CLI entry point
- `packages/report/src/index.ts` - Report renderers
- `action.yml` - GitHub Action definition

### Test Files

- `tests/unit/config.test.ts` - Configuration tests
- `tests/unit/report.test.ts` - Report tests
- `tests/e2e/cli.test.ts` - CLI integration tests
- `tests/e2e/examples-smoke.test.ts` - Example scenarios

---

## License

MIT