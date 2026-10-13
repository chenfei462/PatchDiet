import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { openKnowledgeIndexReadonly } from "../../knowledge/src/index.js";

/**
 * v2 targeted-first controls: test-mapping plan resolved from the CLI's
 * pinned SQLite knowledge index.
 *
 * A plan is `available` only when ALL of the following hold:
 * - the index database exists and is readable;
 * - the index identity matches the pinned commit (and repo root when
 *   supplied) — a stale index is an explicit fallback, never silently used;
 * - the index contains test mappings (coverage-input or import-graph
 *   provenance) for the changed files;
 * - those mapped test files use a SUPPORTED runner recipe.
 *
 * Anything else yields `available: false` with an explicit fallback
 * diagnostic — targeted execution is never faked, and the full required
 * oracle always remains the removal authority.
 */
export interface TargetedPlan {
  available: boolean;
  /** Mapping provenance, including the index identity facts. */
  provenance: string;
  /** Changed source path -> bounded test runner commands. */
  mappings: Record<string, string[]>;
  /** Mapped test files whose runner recipe is unsupported (explicit list). */
  unsupportedRecipes: string[];
  /** Human-readable fallback diagnostic when `available` is false. */
  diagnostic?: string;
}

/**
 * Bounded node test-file pattern. Only files under test conventions or with
 * test/spec suffixes are mapped to the node built-in runner.
 */
const NODE_TEST_FILE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[cm]?js$/;
const PYTHON_TEST_FILE = /(^|\/)test_[^/]*\.py$|\.test\.py$|_test\.py$/;

/**
 * Shell-safe filename check: a mapped path is interpolated into a runner
 * command string executed through a shell, so any path containing spaces,
 * quotes or shell metacharacters is rejected as unsupported (explicitly
 * recorded, never escaped ad hoc). Parent ("..") segments and absolute paths
 * are also rejected: mapping data must never select scripts outside the
 * repository.
 */
function isShellSafePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("-")) {
    return false;
  }
  if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]/).includes("..")) {
    return false;
  }
  return /^[\w./\\-]+$/.test(path);
}

/**
 * Maps a test file to a concrete command using a deliberately small set of
 * supported runner recipes. Returns undefined when no recipe is supported —
 * the caller must record that explicitly instead of guessing a command.
 *
 * Supported recipes:
 * - node-runnable test files (`.test.js/.mjs/.cjs`, `.spec.*`, or test files
 *   under test directories): `node --test <file>` (Node 20+ built-in runner)
 * - python test files (`test_*.py` / `*_test.py`): `python -m pytest <file> -q`
 *   but ONLY when a pytest configuration exists in the repository
 *
 * Unsupported on purpose: paths with spaces or shell metacharacters, and
 * TypeScript test files (they require a TS loader — guessing one would fake
 * targeted execution).
 */
export function supportedRunnerCommand(testFilePath: string, hasPytest: boolean): string | undefined {
  if (!isShellSafePath(testFilePath)) {
    return undefined;
  }
  if (/\.[cm]?js$/.test(testFilePath) && NODE_TEST_FILE.test(testFilePath)) {
    return `node --test ${testFilePath}`;
  }
  if (/\.py$/.test(testFilePath) && PYTHON_TEST_FILE.test(testFilePath)) {
    return hasPytest ? `python -m pytest ${testFilePath} -q` : undefined;
  }
  return undefined;
}

/**
 * Builds the targeted plan for the changed files from the CLI's pinned
 * knowledge index. Never throws: every failure mode (missing database,
 * unreadable index, stale index identity, no mappings, no supported recipe)
 * is reported as an unavailable plan with an explicit diagnostic.
 */
export function buildTargetedPlan(params: {
  cwd: string;
  /** Configured knowledge database (repo-relative); may be undefined. */
  databasePath?: string;
  /** Changed file paths from the pinned diff. */
  changedPaths: string[];
  /** True when a pytest configuration exists in the repository. */
  hasPytest: boolean;
  /** Pinned HEAD commit the run attests; a stale index is a fallback. */
  pinnedHeadSha?: string;
  /** Real repository root; a mismatching index root is a fallback. */
  expectedRepoRoot?: string;
}): TargetedPlan {
  const unavailable = (provenance: string, diagnostic: string, unsupportedRecipes: string[] = []): TargetedPlan => ({
    available: false,
    provenance,
    mappings: {},
    unsupportedRecipes,
    diagnostic
  });
  const databaseRelative = params.databasePath ?? ".patchdiet/knowledge.sqlite";
  const provenance = `knowledge-index:${databaseRelative}`;
  if (isAbsolute(databaseRelative) || databaseRelative.split(/[\\/]/).includes("..")) {
    return unavailable(
      provenance,
      "knowledge.database must be a repo-local relative path; targeted screening is unavailable"
    );
  }
  const databaseAbs = join(params.cwd, databaseRelative);
  if (!existsSync(databaseAbs)) {
    return unavailable(
      provenance,
      `targeted index database '${databaseRelative}' was not found (run 'patchdiet index' to build it); ` +
        "targeted screening falls back to the FULL required oracle"
    );
  }
  let rows: { testName: string; filePath: string; provenance: string }[];
  let identity: { root: string; lastCommit: string | null };
  try {
    const index = openKnowledgeIndexReadonly(databaseAbs);
    try {
      const repoIdentity = index.repoIdentity();
      identity = { root: repoIdentity.root, lastCommit: repoIdentity.lastCommit };
      // Identity gate: an index built for another checkout root or an older
      // commit MUST NOT silently feed targeted commands for this run. Root
      // comparison normalizes separators and case (git reports forward
      // slashes, the index stores the platform form).
      const normalizeRoot = (root: string): string => root.replaceAll("\\", "/").toLowerCase();
      if (
        params.expectedRepoRoot !== undefined &&
        normalizeRoot(repoIdentity.root) !== normalizeRoot(params.expectedRepoRoot)
      ) {
        return unavailable(
          provenance,
          `the knowledge index belongs to repository root '${repoIdentity.root}', not this checkout ` +
            `('${params.expectedRepoRoot}'); targeted screening falls back to the FULL required oracle`
        );
      }
      if (params.pinnedHeadSha !== undefined && repoIdentity.lastCommit !== params.pinnedHeadSha) {
        return unavailable(
          provenance,
          `the knowledge index is stale (built at commit ${repoIdentity.lastCommit ?? "unknown"}, ` +
            `pinned HEAD is ${params.pinnedHeadSha}); targeted screening falls back to the FULL required oracle`
        );
      }
      rows = index.getTestMappings({}).map((view) => ({
        testName: view.testName,
        filePath: view.filePath,
        provenance: view.provenance
      }));
    } finally {
      index.close();
    }
  } catch (error) {
    return unavailable(
      provenance,
      `the knowledge index could not be read (${(error as Error).message}); targeted screening falls back to the FULL required oracle`
    );
  }

  const changed = new Set(params.changedPaths);
  const bySource = new Map<string, Set<string>>();
  const unsupported = new Set<string>();
  const mappingKinds = new Set<string>();
  let mappedAny = false;
  for (const row of rows) {
    if (!changed.has(row.filePath)) continue;
    mappedAny = true;
    mappingKinds.add(row.provenance);
    const command = supportedRunnerCommand(row.testName, params.hasPytest);
    if (command === undefined) {
      unsupported.add(row.testName);
      continue;
    }
    const list = bySource.get(row.filePath) ?? new Set<string>();
    list.add(command);
    bySource.set(row.filePath, list);
  }
  const kinds = [...mappingKinds].sort().join("+");
  const provenanceDetail =
    `${provenance} (${kinds || "no-mapping"} facts, commit ${identity.lastCommit?.slice(0, 12) ?? "unknown"})`;
  if (!mappedAny) {
    return unavailable(
      provenanceDetail,
      "the index contains no test mapping for the changed files; targeted screening falls back to the FULL required oracle"
    );
  }
  const mappings: Record<string, string[]> = {};
  for (const [source, commands] of bySource) {
    if (commands.size > 0) mappings[source] = [...commands].sort();
  }
  if (Object.keys(mappings).length === 0) {
    // Every mapped test file failed the recipe gate — that is an explicit
    // unsupported-runner fallback, never an empty "targeted" run.
    return unavailable(
      provenanceDetail,
      "mapped test files exist but none use a supported runner recipe " +
        `(${[...unsupported].sort().join(", ")}); targeted screening falls back to the FULL required oracle`,
      [...unsupported].sort()
    );
  }
  return {
    available: true,
    provenance: provenanceDetail,
    mappings,
    unsupportedRecipes: [...unsupported].sort(),
    diagnostic: undefined
  };
}
