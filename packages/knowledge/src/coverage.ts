import { z } from "zod";

export const MAX_COVERAGE_BYTES = 20 * 1024 * 1024;
export const MAX_RULE_BYTES = 1024 * 1024;
export const MAX_RULE_FILES = 500;

/**
 * Bounded coverage input schema. This is provenance-carrying raw input: it
 * maps test names to file paths as REPORTED by the coverage tool. It is never
 * interpreted as a complete test mapping.
 */
export const coverageInputSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1).max(200),
  tests: z
    .array(
      z.object({
        name: z.string().min(1).max(500),
        files: z.array(z.string().min(1).max(1024)).max(10_000),
        // Optional caller-declared executed line intervals per repo path.
        lines: z
          .record(
            z.string().min(1).max(1024),
            z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).max(100_000),
          )
          .optional(),
      }),
    )
    .max(100_000),
});

export type CoverageInput = z.infer<typeof coverageInputSchema>;

export function parseCoverageInput(raw: string): CoverageInput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`ERROR: coverage input is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = coverageInputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `ERROR: coverage input does not match the bounded schema: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

/** Minimal glob → matcher: `*` within a segment, `**` across segments, `?` one char. */
export function globToRegExp(pattern: string): RegExp {
  if (pattern.includes("\\")) {
    throw new Error(`ERROR: rule glob '${pattern}' must use forward slashes.`);
  }
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += "(?:.*)";
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Rule name/body extraction. The BODY is returned byte-faithfully (no trim):
 * rules are pinned git blob content, and a caller-visible body that differs
 * from the committed bytes by even a trailing newline is not provenance you
 * can re-verify against the blob hash. A leading YAML frontmatter block, when
 * present, is removed and its `name:` used; otherwise the fallback name is
 * used and the raw text is the body.
 */
export function parseRuleFrontmatterName(raw: string, fallback: string): { name: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (match) {
    const nameLine = match[1].split(/\r?\n/).find((l) => /^name:\s*/.test(l));
    if (nameLine) {
      const name = nameLine.replace(/^name:\s*/, "").trim();
      if (name) {
        return { name, body: raw.slice(match[0].length) };
      }
    }
  }
  return { name: fallback, body: raw };
}

// ── Line-interval coverage ingestion (plan line 795) ───────────────

export const MAX_COVERAGE_LINE_ROWS = 1_000_000;

/** Normalized coverage model: per-test context is EXPLICIT only. */
export interface NormalizedCoverageInput {
  format: "schema1" | "lcov" | "istanbul" | "coverage-py";
  source: string;
  /** Per-test mapping with OPTIONAL line intervals (caller-declared context). */
  tests: { name: string; files: string[]; intervals: Record<string, [number, number][]> }[];
  /**
   * Aggregate executed line intervals WITHOUT per-test context. These never
   * invent test identities and never enter the per-test mapping query.
   */
  aggregate: Record<string, [number, number][]>;
}

type LineIntervals = [number, number][];

/** Merge sorted consecutive/overlapping line runs into closed intervals. */
export function mergeLineIntervals(lines: number[]): LineIntervals {
  const sorted = [...new Set(lines)]
    .filter((line) => Number.isInteger(line) && line >= 1)
    .sort((a, b) => a - b);
  const intervals: LineIntervals = [];
  for (const line of sorted) {
    const last = intervals[intervals.length - 1];
    if (last && line <= last[1] + 1) {
      last[1] = line;
    } else {
      intervals.push([line, line]);
    }
  }
  return intervals;
}

function isIstanbulShape(json: unknown): json is Record<string, Record<string, unknown>> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return false;
  const values = Object.values(json as Record<string, unknown>);
  return (
    values.length > 0 &&
    values.every(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "statementMap" in (value as Record<string, unknown>),
    )
  );
}

function isCoveragePyShape(json: unknown): json is {
  files: Record<string, { executed_lines?: unknown }>;
} {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return false;
  const files = (json as Record<string, unknown>).files;
  return (
    typeof files === "object" &&
    files !== null &&
    !Array.isArray(files) &&
    Object.keys(files).length > 0 &&
    Object.values(files).every(
      (value) =>
        typeof value === "object" && value !== null && "executed_lines" in (value as Record<string, unknown>),
    )
  );
}

/** Repo-relative, forward-slash path; returns undefined for outside-repo paths. */
export function normalizeCoveredPath(rawPath: string, cwd: string): string | undefined {
  let path = rawPath.replaceAll("\\", "/");
  if (path.startsWith("file://")) {
    path = path.slice("file://".length);
  }
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) {
    const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^\//, "");
    const candidate = path.replace(/^\//, "");
    if (candidate.toLowerCase().startsWith(normalizedCwd.toLowerCase() + "/")) {
      path = candidate.slice(normalizedCwd.length + 1);
    } else {
      return undefined; // outside the repository: never silently mapped
    }
  }
  path = path.replace(/^\.\//, "");
  if (path.length === 0 || path.split("/").includes("..")) {
    return undefined;
  }
  return path;
}

function parseLcov(raw: string, cwd: string): NormalizedCoverageInput {
  // LCOV tracefile: SF:<path> sections with DA:<line>,<count> executions.
  // A TN:<name> header names the test run when the toolchain provides one;
  // without it the data is AGGREGATE (no per-test context is invented).
  // Malformed records (DA without a count, invalid counts, DA outside an SF
  // section) are REJECTED — an execution count is never invented. Raw line
  // numbers accumulate across repeated SF sections; intervals are computed
  // ONCE at the end so interior lines of stored intervals are never lost.
  const tests: NormalizedCoverageInput["tests"] = [];
  const aggregate: Record<string, LineIntervals> = {};
  const rawLinesByPathAggregate: Record<string, number[]> = {};
  const rawLinesByPathTest = new Map<string, Record<string, number[]>>();
  let currentTest: string | undefined;
  let currentPath: string | undefined;
  let currentLines: number[] = [];
  const flush = (): void => {
    if (currentPath === undefined) return;
    if (currentTest !== undefined) {
      let raw = rawLinesByPathTest.get(currentTest);
      if (raw === undefined) {
        raw = {};
        rawLinesByPathTest.set(currentTest, raw);
      }
      raw[currentPath] = [...(raw[currentPath] ?? []), ...currentLines];
    } else {
      rawLinesByPathAggregate[currentPath] = [...(rawLinesByPathAggregate[currentPath] ?? []), ...currentLines];
    }
    currentPath = undefined;
    currentLines = [];
  };
  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith("TN:")) {
      flush();
      currentTest = rawLine.slice(3).trim() || undefined;
    } else if (rawLine.startsWith("SF:")) {
      flush();
      currentPath = normalizeCoveredPath(rawLine.slice(3).trim(), cwd);
      currentLines = [];
    } else if (rawLine.startsWith("DA:")) {
      if (currentPath === undefined) {
        throw new Error("ERROR: malformed LCOV tracefile: DA record outside an SF section");
      }
      const [lineNo, count] = rawLine.slice(3).split(",");
      const parsedLine = Number(lineNo);
      if (!Number.isInteger(parsedLine) || parsedLine < 1) {
        throw new Error(`ERROR: malformed LCOV DA record (invalid line number): ${rawLine}`);
      }
      if (count === undefined || count.trim() === "") {
        throw new Error(`ERROR: malformed LCOV DA record missing execution count: ${rawLine}`);
      }
      const parsedCount = Number(count);
      if (!Number.isInteger(parsedCount) || parsedCount < 0) {
        throw new Error(`ERROR: malformed LCOV DA record (invalid execution count): ${rawLine}`);
      }
      if (parsedCount > 0) {
        currentLines.push(parsedLine);
      }
    } else if (rawLine.startsWith("end_of_record")) {
      flush();
    }
  }
  flush();
  for (const [path, lines] of Object.entries(rawLinesByPathAggregate)) {
    aggregate[path] = mergeLineIntervals(lines);
  }
  for (const [testName, raw] of rawLinesByPathTest) {
    const intervals: Record<string, LineIntervals> = {};
    for (const [path, lines] of Object.entries(raw)) {
      intervals[path] = mergeLineIntervals(lines);
    }
    tests.push({ name: testName, files: [], intervals });
  }
  return { format: "lcov", source: "lcov-tracefile", tests, aggregate };
}

function parseIstanbul(json: Record<string, Record<string, unknown>>, cwd: string): NormalizedCoverageInput {
  const aggregate: Record<string, LineIntervals> = {};
  for (const [rawPath, data] of Object.entries(json)) {
    const path = normalizeCoveredPath(rawPath, cwd);
    if (path === undefined) continue;
    const intervals: LineIntervals = [];
    const statementMap = data.statementMap as
      | Record<string, { start?: { line?: unknown }; end?: { line?: unknown } }>
      | undefined;
    const counts = data.s as Record<string, unknown> | undefined;
    if (statementMap && counts) {
      for (const [key, location] of Object.entries(statementMap)) {
        const count = Number(counts[key] ?? 0);
        const startLine = Number(location?.start?.line);
        const endLine = Number(location?.end?.line ?? startLine);
        if (count > 0 && Number.isInteger(startLine) && startLine >= 1 && Number.isInteger(endLine) && endLine >= startLine) {
          // Bounded BEFORE any expansion: a statement whose reported line span
          // is absurd is rejected outright (malformed), never truncated.
          if (endLine - startLine > 100_000) {
            throw new Error(
              `ERROR: malformed Istanbul coverage for '${path}': statement spans ${endLine - startLine} lines (statement ${key})`,
            );
          }
          // Interval arithmetic: one closed interval per executed statement.
          intervals.push([startLine, endLine]);
        }
      }
    }
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // Merge overlapping/adjacent statement intervals without line expansion.
    const merged: LineIntervals = [];
    for (const [startLine, endLine] of intervals) {
      const last = merged[merged.length - 1];
      if (last && startLine <= last[1] + 1) {
        last[1] = Math.max(last[1], endLine);
      } else {
        merged.push([startLine, endLine]);
      }
    }
    aggregate[path] = merged;
  }
  return { format: "istanbul", source: "istanbul-json", tests: [], aggregate };
}

function parseCoveragePy(
  json: { files: Record<string, { executed_lines?: unknown; contexts?: unknown }> },
  cwd: string,
): NormalizedCoverageInput {
  const tests: NormalizedCoverageInput["tests"] = [];
  const aggregate: Record<string, LineIntervals> = {};
  // Raw executed LINE numbers accumulate (never stored intervals flattened,
  // which would discard interior lines); intervals are computed once at the
  // end with interval arithmetic.
  const aggregateRaw: Record<string, number[]> = {};
  const testRaw = new Map<string, Record<string, number[]>>();
  const addAggregateLine = (path: string, line: number): void => {
    aggregateRaw[path] = [...(aggregateRaw[path] ?? []), line];
  };
  const addTestLine = (context: string, path: string, line: number): void => {
    const raw = testRaw.get(context) ?? {};
    raw[path] = [...(raw[path] ?? []), line];
    testRaw.set(context, raw);
  };
  for (const [rawPath, data] of Object.entries(json.files)) {
    const path = normalizeCoveredPath(rawPath, cwd);
    if (path === undefined) continue;
    const lines = Array.isArray(data.executed_lines)
      ? data.executed_lines.map(Number).filter((line) => Number.isInteger(line) && line >= 1)
      : [];
    // coverage.py JSON (show_contexts) reports per-line execution contexts.
    // A non-empty context (e.g. 'tests/test_a.py::test_first|run') is an
    // EXPLICIT per-test context and is retained as such; the empty context
    // (and lines without context data) stays AGGREGATE. Reported contexts are
    // never promoted into complete-test claims.
    const contexts = (data.contexts !== undefined && typeof data.contexts === "object" && data.contexts !== null)
      ? data.contexts as Record<string, unknown>
      : undefined;
    for (const line of lines) {
      const lineContexts = contexts?.[String(line)];
      if (Array.isArray(lineContexts) && lineContexts.length > 0) {
        let explicitContext = false;
        for (const rawContext of lineContexts) {
          const context = typeof rawContext === "string" ? rawContext.trim() : "";
          if (context.length > 0) {
            explicitContext = true;
            addTestLine(context, path, line);
          }
        }
        if (!explicitContext) {
          addAggregateLine(path, line);
        }
      } else {
        addAggregateLine(path, line);
      }
    }
  }
  for (const [path, lines] of Object.entries(aggregateRaw)) {
    aggregate[path] = mergeLineIntervals(lines);
  }
  for (const [context, raw] of testRaw) {
    const intervals: Record<string, LineIntervals> = {};
    for (const [path, lines] of Object.entries(raw)) {
      intervals[path] = mergeLineIntervals(lines);
    }
    tests.push({ name: context, files: [], intervals });
  }
  return { format: "coverage-py", source: "coverage-py-json", tests, aggregate };
}

/**
 * Parses any of the bounded supported coverage input formats:
 * - schemaVersion:1 per-test JSON (existing bounded schema; optional per-test
 *   `lines` intervals keyed by repo path, caller-declared test context);
 * - LCOV tracefiles (TN/SF/DA; TN present = per-test, absent = aggregate);
 * - Istanbul JSON summaries (aggregate; no per-test identity is invented);
 * - coverage.py / pytest-cov JSON reports (show_contexts per-test contexts
 *   are retained; lines without an explicit context stay aggregate).
 */
export function parseCoverageInputAny(raw: string, cwd: string): NormalizedCoverageInput {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("TN:") || trimmed.startsWith("SF:") || trimmed.startsWith("DA:")) {
    return parseLcov(raw, cwd);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `ERROR: coverage input matches none of the supported formats (valid JSON or LCOV text required): ${(error as Error).message}`,
    );
  }
  if (
    typeof json === "object" && json !== null && !Array.isArray(json) &&
    (json as Record<string, unknown>).schemaVersion === 1
  ) {
    const base = parseCoverageInput(raw);
    const tests = base.tests.map((test) => {
      const linesField = (test as unknown as { lines?: Record<string, number[][]> }).lines;
      const intervals: Record<string, LineIntervals> = {};
      if (linesField !== undefined && typeof linesField === "object") {
        for (const [path, runs] of Object.entries(linesField)) {
          // Entries are caller-declared CLOSED INTERVALS [start,end], not
          // individual lines; normalize direction and sort deterministically.
          intervals[path] = runs
            .map(([start, end]) => [Math.min(start, end), Math.max(start, end)] as [number, number])
            .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        }
      }
      return { name: test.name, files: test.files, intervals };
    });
    return { format: "schema1", source: base.source, tests, aggregate: {} };
  }
  if (isCoveragePyShape(json)) {
    return parseCoveragePy(json, cwd);
  }
  if (isIstanbulShape(json)) {
    return parseIstanbul(json, cwd);
  }
  throw new Error(
    "ERROR: coverage input matches none of the supported formats " +
      "(schemaVersion:1 per-test JSON, LCOV tracefile, Istanbul JSON, coverage.py JSON)",
  );
}
