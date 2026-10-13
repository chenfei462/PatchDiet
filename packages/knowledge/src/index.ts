import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, posix } from "node:path";

import Database from "better-sqlite3";

import { detectLanguage, invalidEncodingResult, parseSource, type SupportedLanguage } from "../../parsers/src/index.js";
import {
  MAX_COVERAGE_BYTES,
  MAX_RULE_BYTES,
  MAX_RULE_FILES,
  globToRegExp,
  MAX_COVERAGE_LINE_ROWS,
  parseCoverageInputAny,
  parseRuleFrontmatterName,
} from "./coverage.js";
import {
  decodeUtf8Strict,
  listTree,
  readBlobs,
  resolveCommit,
  resolveRepoRoot,
  type TreeEntry,
} from "./git-blobs.js";
import { assertOwnedPath, assertSafeDatabaseLeaf, mkdirOwned } from "./ownership.js";
import {
  collectGitHistory,
  deleteHistoryData,
  validateMergedPrSnapshot,
  writeHistorySnapshot,
  type ValidatedMergedPrInput,
} from "./history.js";
import { MIGRATIONS, SCHEMA_VERSION, inspectDatabase, migrate } from "./schema.js";

export { SCHEMA_VERSION, MIGRATIONS };

const TOOL_VERSION = "0.2.0";
const DEFAULT_DB_RELATIVE = join(".patchdiet", "semantic-index.db");

export interface IndexRepositoryOptions {
  /** Repository working directory (used to locate the git repository). */
  cwd: string;
  /** Ref to index; resolved to a pinned commit. Default "HEAD". */
  ref?: string;
  /** Database file path; must be inside the repository. Default `<repo>/.patchdiet/semantic-index.db`. */
  databasePath?: string;
  /** Restrict indexing to these languages (e.g. ["typescript", "python"]). */
  languages?: string[];
  /** Approved configured rule globs (repo-relative, e.g. ["docs/rules/*.md"]). */
  rules?: { globs: string[] };
  /** Raw coverage JSON input path (inside the repository). */
  coveragePath?: string;
  /**
   * Pinned git history ingestion (Task 1). When `git` is true, bounded history
   * at the pinned commit is collected into additive extension tables. When
   * `mergedPrsEnabled` is true, an explicit `mergedPrsPath` caller-supplied
   * snapshot may be ingested; without a path the feature reports unavailable.
   * Absent/false NEVER leaves history data behind: stale rows are removed.
   */
  history?: { git?: boolean; mergedPrsEnabled?: boolean; mergedPrsPath?: string };
}

export interface IndexRepositoryResult {
  repo: { root: string; ref: string; commit: string };
  databasePath: string;
  schemaVersion: number;
  files: { indexed: number; reparsed: number; skipped: number; deleted: number; renamed: number; total: number };
  symbols: number;
  imports: number;
  edges: number;
  rules: { sources: string[]; count: number };
  coverage: {
    source: string;
    format: string;
    tests: number;
    /** Aggregate (per-test-context-free) files with line intervals. */
    aggregateFiles: number;
    /** Persisted line-interval rows (per-test + aggregate). */
    lineRows: number;
    /** Explicit unmapped / outside-repository / stale diagnostics. */
    diagnostics: string[];
  } | null;
  diagnostics: { path: string; complete: boolean; count: number }[];
  history: IndexHistoryResult;
}

/** Truthful summary of the pinned-history ingestion for one index run. */
export interface IndexHistoryResult {
  enabled: boolean;
  collected: boolean;
  commits: number;
  truncated: boolean;
  shallow: boolean;
  cochangePairs: number;
  mergedPrs: {
    enabled: boolean;
    available: boolean;
    ingested: number;
    diagnostics: string[];
  } | null;
  diagnostics: string[];
}

interface FileRow {
  id: number;
  path: string;
  blob_sha: string;
  language: string;
  complete: number;
}

type ParseResultLike = Awaited<ReturnType<typeof parseSource>>;

/**
 * Index a repository at a pinned commit into a SQLite knowledge database.
 *
 * Safety properties (enforced before ANY open or write):
 * - code content comes from git blobs of the resolved commit only (dirty
 *   working trees are never read);
 * - the database path is validated segment-by-segment against the canonical
 *   repository root (no symlinks/junctions anywhere on the path, including
 *   ancestors that point elsewhere INSIDE the repo);
 * - an existing database leaf must be a regular file with nlink === 1;
 * - future/unknown schema databases are refused without modification;
 * - a database created for a different repository is refused (no cross-repo
 *   contamination);
 * - all queries are parameterized; handles are closed on error paths.
 */
export async function indexRepository(options: IndexRepositoryOptions): Promise<IndexRepositoryResult> {
  const ref = options.ref ?? "HEAD";
  const repoRoot = await resolveRepoRoot(options.cwd);
  const commit = await resolveCommit(repoRoot, ref);

  const rawDatabasePath = options.databasePath ?? join(repoRoot, DEFAULT_DB_RELATIVE);
  const databasePath = isAbsolute(rawDatabasePath) ? rawDatabasePath : join(repoRoot, rawDatabasePath);
  assertOwnedPath(repoRoot, databasePath, "semantic index database");
  assertSafeDatabaseLeaf(databasePath, "semantic index database");

  // ---- Read-only inspection BEFORE any write connection -------------------
  let fileExists = false;
  try {
    fileExists = statSync(databasePath).isFile();
  } catch {
    fileExists = false;
  }
  if (fileExists) {
    const ro = new Database(databasePath, { readonly: true, fileMustExist: true });
    let state: ReturnType<typeof inspectDatabase>;
    try {
      state = inspectDatabase(ro, true);
    } finally {
      ro.close();
    }
    if (state.kind === "future") {
      throw new Error(
        `ERROR: refusing to touch '${databasePath}': database schema version ${state.version} is NEWER than this ` +
          `tool supports (supported: ${SCHEMA_VERSION}). It may have been written by a newer PatchDiet.`,
      );
    }
    if (state.kind === "unknown") {
      throw new Error(
        `ERROR: refusing to open '${databasePath}': not a PatchDiet semantic index (unknown database: ${state.reason}). ` +
          "Existing unrelated user databases are never reinitialized or destroyed.",
      );
    }
  }

  // ---- Write connection ----------------------------------------------------
  mkdirOwned(repoRoot, dirname(databasePath), "semantic index database directory");
  const db = new Database(databasePath, { fileMustExist: fileExists });
  try {
    db.pragma("foreign_keys = ON");
    if (!fileExists) {
      const state = inspectDatabase(db, false);
      if (state.kind !== "missing" && state.kind !== "empty") {
        throw new Error(`ERROR: unexpected state for fresh database '${databasePath}'.`);
      }
      migrate(db);
    } else {
      const state = inspectDatabase(db, true);
      if (state.kind !== "current") {
        throw new Error(`ERROR: database '${databasePath}' is not at the supported schema (state: ${state.kind}).`);
      }
      verifyRepoIdentity(db, repoRoot);
    }
    return await runIndexing(db, { repoRoot, ref, commit, databasePath, options });
  } finally {
    db.close();
  }
}

function verifyRepoIdentity(db: Database.Database, repoRoot: string): void {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'repo_root'").get() as { value: string } | undefined;
  if (!row) {
    throw new Error("ERROR: existing PatchDiet index is missing its repo identity (meta.repo_root).");
  }
  if (row.value !== repoRoot) {
    throw new Error(
      `ERROR: refusing to index a different repository into this database (indexed root: '${row.value}', ` +
        `requested root: '${repoRoot}'). Cross-repo contamination is not allowed.`,
    );
  }
}

interface RunIndexingArgs {
  repoRoot: string;
  ref: string;
  commit: string;
  databasePath: string;
  options: IndexRepositoryOptions;
}

async function runIndexing(db: Database.Database, args: RunIndexingArgs): Promise<IndexRepositoryResult> {
  const { repoRoot, ref, commit, databasePath, options } = args;
  const languageFilter = options.languages?.length ? new Set(options.languages) : null;

  // Record repo identity on first use.
  const hasRepo = db.prepare("SELECT COUNT(*) AS n FROM repo").get() as { n: number };
  if (hasRepo.n === 0) {
    db.prepare("INSERT INTO repo (id, canonical_root, created_at) VALUES (1, ?, ?)").run(
      repoRoot,
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO meta (key, value) VALUES ('repo_root', ?)").run(repoRoot);
    db.prepare("INSERT INTO meta (key, value) VALUES ('tool_version', ?)").run(TOOL_VERSION);
  }

  const tree = await listTree(repoRoot, commit);
  const wanted = tree.filter((entry) => {
    const language = detectLanguage(entry.path);
    return language !== null && (!languageFilter || languageFilter.has(language));
  });
  const treeByPath = new Map(wanted.map((e) => [e.path, e]));

  // Approved rule sources (configured globs, or the default approved paths).
  // Discovery is over the pinned tree; blobs are read with the same batch.
  const ruleGlobs = options.rules?.globs ?? DEFAULT_RULE_GLOBS;
  const ruleMatchers = ruleGlobs.map((glob) => {
    if (isAbsolute(glob) || glob.startsWith("..")) {
      throw new Error(`ERROR: rule glob '${glob}' must be repository-relative and inside the repository.`);
    }
    return globToRegExp(glob);
  });
  const ruleTree = tree
    .filter((entry) => ruleMatchers.some((re) => re.test(entry.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const existingRows = db.prepare("SELECT id, path, blob_sha, language, complete FROM files").all() as FileRow[];
  const existingByPath = new Map(existingRows.map((r) => [r.path, r]));

  const counts = { indexed: 0, reparsed: 0, skipped: 0, deleted: 0, renamed: 0 };
  const diagnostics: { path: string; complete: boolean; count: number }[] = [];

  const unchanged: FileRow[] = [];
  const changed: TreeEntry[] = [];
  const added: TreeEntry[] = [];
  for (const entry of wanted) {
    const row = existingByPath.get(entry.path);
    if (!row) {
      added.push(entry);
    } else if (row.blob_sha === entry.blobSha) {
      unchanged.push(row);
    } else {
      changed.push(entry);
    }
  }
  const deletedRows = existingRows.filter((row) => !treeByPath.has(row.path));

  // Rename detection: deleted path + added path sharing the same blob sha are
  // the same content moving (1:1 match, deterministic order).
  const renameTargets = new Map<string, FileRow>(); // added path -> deleted row
  const deletedPending = [...deletedRows];
  for (const entry of added) {
    const idx = deletedPending.findIndex((row) => row.blob_sha === entry.blobSha);
    if (idx >= 0) {
      renameTargets.set(entry.path, deletedPending[idx]);
      deletedPending.splice(idx, 1);
    }
  }

  // ---- Parse phase (async WASM work happens OUTSIDE the SQLite transaction)
  const blobShas = new Set([...changed, ...added].map((e) => e.blobSha));
  for (const entry of ruleTree) {
    blobShas.add(entry.blobSha);
  }
  const blobs = await readBlobs(repoRoot, [...blobShas]);
  const parseJobs: { entry: TreeEntry; fileId: number | null; prevPath: string | null }[] = [];
  for (const entry of added) {
    const renamedFrom = renameTargets.get(entry.path);
    if (renamedFrom) {
      parseJobs.push({ entry, fileId: renamedFrom.id, prevPath: renamedFrom.path });
    } else {
      parseJobs.push({ entry, fileId: null, prevPath: null });
    }
  }
  for (const entry of changed) {
    parseJobs.push({ entry, fileId: existingByPath.get(entry.path)!.id, prevPath: null });
  }
  const parses = new Map<TreeEntry, ParseResultLike>();
  for (const job of parseJobs) {
    const bytes = blobs.get(job.entry.blobSha);
    if (!bytes) {
      throw new Error(
        `ERROR: blob ${job.entry.blobSha} for '${job.entry.path}' was not returned by the object database.`,
      );
    }
    // Byte-faithful strict decode: valid UTF-8 (BOM preserved so byte offsets
    // and content hashes stay aligned) parses normally; invalid bytes become
    // an explicit incomplete entry, never replacement-decoded text.
    const decoded = decodeUtf8Strict(bytes);
    parses.set(
      job.entry,
      decoded.ok
        ? await parseSource(job.entry.path, decoded.text)
        : invalidEncodingResult(job.entry.path, decoded.reason, bytes.length),
    );
  }

  // ---- Write phase (single synchronous transaction, parameterized SQL) -----
  const insertFile = db.prepare(
    `INSERT INTO files (path, blob_sha, language, complete, diagnostics_json, prev_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateFile = db.prepare(
    `UPDATE files SET path = ?, blob_sha = ?, language = ?, complete = ?, diagnostics_json = ?, prev_path = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteFileStmt = db.prepare("DELETE FROM files WHERE id = ?");
  const clearFileData = db.prepare("DELETE FROM symbols WHERE file_id = ?");
  const clearImports = db.prepare("DELETE FROM imports WHERE file_id = ?");
  const clearEdges = db.prepare("DELETE FROM edges WHERE from_file_id = ?");
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (file_id, symbol_key, name, kind, parent_key, start_byte, end_byte,
       start_line, start_column, end_line, end_column, span_start_byte, span_end_byte, exported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertImport = db.prepare(
    `INSERT INTO imports (file_id, module_specifier, imported_name, alias, start_byte, end_byte)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO edges (from_file_id, kind, to_name, from_symbol_key, to_symbol_id, to_file_id,
       resolved, resolution, provenance, start_byte, end_byte)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'ast', ?, ?)`,
  );

  const storeParseResult = (fileId: number, parse: ParseResultLike): void => {
    for (const symbol of parse.symbols) {
      insertSymbol.run(
        fileId,
        symbol.id,
        symbol.name,
        symbol.kind,
        symbol.parentId,
        symbol.range.startByte,
        symbol.range.endByte,
        symbol.range.startLine,
        symbol.range.startColumn,
        symbol.range.endLine,
        symbol.range.endColumn,
        symbol.span.startByte,
        symbol.span.endByte,
        symbol.exported ? 1 : 0,
      );
    }
    for (const imp of parse.imports) {
      insertImport.run(
        fileId,
        imp.moduleSpecifier,
        imp.importedName,
        imp.alias,
        imp.range.startByte,
        imp.range.endByte,
      );
    }
    for (const call of parse.calls) {
      insertEdge.run(fileId, "call", call.calleeName, call.withinSymbolId, 0, "none", call.range.startByte, call.range.endByte);
    }
    for (const reference of parse.references) {
      insertEdge.run(
        fileId,
        "reference",
        reference.name,
        reference.withinSymbolId,
        0,
        "none",
        reference.range.startByte,
        reference.range.endByte,
      );
    }
    for (const imp of parse.imports) {
      insertEdge.run(fileId, "import", imp.moduleSpecifier, null, 0, "none", imp.range.startByte, imp.range.endByte);
    }
  };

  const noteDiagnostics = (path: string, parse: ParseResultLike): void => {
    if (!parse.complete) {
      diagnostics.push({ path, complete: false, count: parse.diagnostics.length });
    }
  };

  db.transaction(() => {
    for (const job of parseJobs) {
      const parse = parses.get(job.entry)!;
      const language = detectLanguage(job.entry.path) ?? ("typescript" as SupportedLanguage);
      const diagnosticsJson = JSON.stringify(parse.diagnostics);
      let fileId: number;
      if (job.fileId === null) {
        counts.indexed += 1;
        fileId = Number(
          insertFile.run(
            job.entry.path,
            job.entry.blobSha,
            language,
            parse.complete ? 1 : 0,
            diagnosticsJson,
            null,
            new Date().toISOString(),
          ).lastInsertRowid,
        );
      } else {
        if (job.prevPath !== null) {
          counts.renamed += 1;
        } else {
          counts.reparsed += 1;
        }
        updateFile.run(
          job.entry.path,
          job.entry.blobSha,
          language,
          parse.complete ? 1 : 0,
          diagnosticsJson,
          job.prevPath,
          new Date().toISOString(),
          job.fileId,
        );
        fileId = job.fileId;
        clearFileData.run(fileId);
        clearImports.run(fileId);
        clearEdges.run(fileId);
      }
      storeParseResult(fileId, parse);
      noteDiagnostics(job.entry.path, parse);
    }
    for (const row of deletedPending) {
      counts.deleted += 1;
      deleteFileStmt.run(row.id);
    }
    // Resolution pass: deterministic, explicitly-labeled heuristics. Edges
    // that cannot be resolved stay resolved=0 — an absent edge NEVER proves a
    // symbol unused or removable.
    resolveEdges(db);
    rebuildTestMappings(db);
    const upsertMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    upsertMeta.run("last_commit", commit);
    upsertMeta.run("last_ref", ref);
  })();

  counts.skipped = unchanged.length;

  // ---- Rules (from pinned blobs; dirty local edits never leak in) ---------
  const rulesResult = writeRules(db, collectRuleRows(ruleTree, blobs, ruleGlobs));

  // ---- Coverage ------------------------------------------------------------
  let coverageResult: IndexRepositoryResult["coverage"] = null;
  if (options.coveragePath) {
    coverageResult = await ingestCoverage(db, repoRoot, options.coveragePath, commit);
  }

  // ---- Pinned git history (bounded, extension tables, single snapshot) -----
  const historyEnabled = options.history?.git === true;
  const mergedPrsEnabled = options.history?.mergedPrsEnabled === true;
  if (!historyEnabled && options.history?.mergedPrsPath !== undefined) {
    throw new Error(
      "ERROR: --merged-prs requires history ingestion (knowledge.history.git: true); " +
        "merged-PR rows are anchored to the pinned history snapshot.",
    );
  }
  if (historyEnabled && !mergedPrsEnabled && options.history?.mergedPrsPath !== undefined) {
    throw new Error(
      "ERROR: --merged-prs was provided but merged-PR evidence is not enabled (knowledge.history.merged_prs: true is required); " +
        "explicit caller-supplied PR input is refused while the feature is configured off.",
    );
  }
  const historyResult = await ingestHistory(db, repoRoot, commit, {
    enabled: historyEnabled,
    mergedPrsEnabled,
    mergedPrsPath: options.history?.mergedPrsPath,
  });

  const symbolCount = (db.prepare("SELECT COUNT(*) AS n FROM symbols").get() as { n: number }).n;
  const importCount = (db.prepare("SELECT COUNT(*) AS n FROM imports").get() as { n: number }).n;
  const edgeCount = (db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n;

  return {
    repo: { root: repoRoot, ref, commit },
    databasePath,
    schemaVersion: SCHEMA_VERSION,
    files: { ...counts, total: wanted.length },
    symbols: symbolCount,
    imports: importCount,
    edges: edgeCount,
    rules: rulesResult,
    coverage: coverageResult,
    diagnostics,
    history: historyResult,
  };
}

/**
 * Collect + persist bounded pinned history. Disabled = truly disabled: stale
 * extension rows are removed and the result reports zeros honestly.
 */
async function ingestHistory(
  db: Database.Database,
  repoRoot: string,
  commit: string,
  options: { enabled: boolean; mergedPrsEnabled: boolean; mergedPrsPath?: string },
): Promise<IndexHistoryResult> {
  if (!options.enabled) {
    deleteHistoryData(db);
    // Flag independence: merged_prs enabled while history ingestion is off is
    // not silently ignored — the requirement is stated truthfully and the
    // feature reports unavailable (never fabricated, never decorative).
    if (options.mergedPrsEnabled) {
      return {
        enabled: false,
        collected: false,
        commits: 0,
        truncated: false,
        shallow: false,
        cochangePairs: 0,
        mergedPrs: {
          enabled: true,
          available: false,
          ingested: 0,
          diagnostics: [
            "merged-PR evidence is enabled (knowledge.history.merged_prs) but pinned history ingestion is disabled " +
              "(knowledge.history.git: false); merged-PR evidence requires knowledge.history.git because PR records " +
              "are anchored to a pinned history snapshot — merged-PR evidence is unavailable",
          ],
        },
        diagnostics: [],
      };
    }
    return {
      enabled: false,
      collected: false,
      commits: 0,
      truncated: false,
      shallow: false,
      cochangePairs: 0,
      mergedPrs: null,
      diagnostics: [],
    };
  }
  const snapshot = await collectGitHistory(repoRoot, commit);
  let mergedInput: ValidatedMergedPrInput | null = null;
  const mergedDiagnostics: string[] = [];
  if (options.mergedPrsEnabled && options.mergedPrsPath === undefined) {
    mergedDiagnostics.push(
      "merged-PR evidence is enabled (knowledge.history.merged_prs) but no caller-supplied snapshot was provided (--merged-prs); merged-PR evidence is unavailable",
    );
  }
  if (options.mergedPrsEnabled && options.mergedPrsPath !== undefined) {
    // Fully validated (including reachability) BEFORE the write transaction.
    mergedInput = await validateMergedPrSnapshot(repoRoot, options.mergedPrsPath, commit);
  }
  writeHistorySnapshot(db, snapshot, mergedInput !== null ? { input: mergedInput } : null);
  return {
    enabled: true,
    collected: true,
    commits: snapshot.commits.length,
    truncated: snapshot.truncated,
    shallow: snapshot.shallow,
    cochangePairs: snapshot.cochange.size,
    mergedPrs: {
      enabled: options.mergedPrsEnabled,
      available: mergedInput !== null,
      ingested: mergedInput?.records.length ?? 0,
      diagnostics: mergedDiagnostics,
    },
    diagnostics: snapshot.diagnostics,
  };
}

/**
 * Deterministic edge resolution pass. Explicitly heuristic — every resolved
 * edge records HOW it resolved, and an unresolved edge (resolved=0) is the
 * honest "unknown" state: an absent caller/test edge NEVER proves a symbol
 * unused or removable.
 *
 * Resolution ladder (first match wins, all deterministic):
 * 1. import edges: relative/rooted specifiers mapped onto indexed file paths
 *    (`resolution = 'specifier-path'`); bare package specifiers stay external.
 * 2. call/reference edges whose name is a LOCAL import binding of the source
 *    file (default/named/aliased import) resolve to the imported symbol in the
 *    imported file (`resolution = 'import-alias'`). This is what preserves a
 *    cross-file target's identity through an alias like `helper as wrapped`.
 * 3. otherwise a UNIQUE exact-name match against all indexed symbols
 *    (`resolution = 'name-match'`); ambiguous or absent names stay unresolved.
 */
function resolveEdges(db: Database.Database): void {
  db.exec("UPDATE edges SET to_symbol_id = NULL, to_file_id = NULL, resolved = 0, resolution = 'none'");

  const files = db.prepare("SELECT id, path FROM files").all() as { id: number; path: string }[];
  const idByPosixPath = new Map(files.map((f) => [f.path.replace(/\\/g, "/"), f.id]));
  const pathById = new Map(files.map((f) => [f.id, f.path]));
  const suffixes = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    "/index.ts",
    "/index.tsx",
    "/index.js",
    "/index.jsx",
  ];
  const resolveSpecifier = (fromPath: string, specifier: string): number | undefined => {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      return undefined; // bare package import: external dependency
    }
    const base = specifier.startsWith("/")
      ? specifier.slice(1)
      : posix.normalize(posix.join(posix.dirname(fromPath.replace(/\\/g, "/")), specifier));
    for (const suffix of suffixes) {
      const target = idByPosixPath.get(`${base}${suffix}`);
      if (target !== undefined) {
        return target;
      }
    }
    return undefined;
  };

  // ---- Pass 1: import edges → target file ---------------------------------
  const updateImport = db.prepare(
    "UPDATE edges SET to_file_id = ?, resolved = 1, resolution = 'specifier-path' WHERE id = ?",
  );
  const imports = db
    .prepare(
      `SELECT e.id, e.to_name AS specifier, f.id AS from_file_id, f.path AS from_path
       FROM edges e JOIN files f ON f.id = e.from_file_id
       WHERE e.kind = 'import'`,
    )
    .all() as { id: number; specifier: string; from_file_id: number; from_path: string }[];
  // from_file_id -> (local binding name -> { targetFileId, importedName })
  const localBindings = new Map<number, Map<string, { targetFileId: number; importedName: string | null }>>();
  const importRows = db
    .prepare(
      `SELECT i.file_id, i.module_specifier, i.imported_name, i.alias, f.path
       FROM imports i JOIN files f ON f.id = i.file_id`,
    )
    .all() as {
    file_id: number;
    module_specifier: string;
    imported_name: string | null;
    alias: string | null;
    path: string;
  }[];
  for (const imp of importRows) {
    const targetFileId = resolveSpecifier(imp.path, imp.module_specifier);
    if (targetFileId === undefined) {
      continue;
    }
    const localName = imp.alias ?? imp.imported_name;
    if (!localName) {
      continue; // namespace import (`* as x`) / side-effect: no single binding
    }
    let bindings = localBindings.get(imp.file_id);
    if (!bindings) {
      bindings = new Map();
      localBindings.set(imp.file_id, bindings);
    }
    // First binding wins deterministically (import order is stable in the AST).
    if (!bindings.has(localName)) {
      bindings.set(localName, { targetFileId, importedName: imp.imported_name });
    }
  }
  for (const imp of imports) {
    const target = resolveSpecifier(imp.from_path, imp.specifier);
    if (target !== undefined) {
      updateImport.run(target, imp.id);
    }
  }

  // ---- Pass 2: call/reference edges ---------------------------------------
  const symbolsByName = new Map<string, { id: number; file_id: number; symbol_key: string }[]>();
  const symbolRows = db
    .prepare("SELECT id, file_id, symbol_key, name FROM symbols")
    .all() as { id: number; file_id: number; symbol_key: string; name: string }[];
  for (const s of symbolRows) {
    const list = symbolsByName.get(s.name);
    if (list) {
      list.push(s);
    } else {
      symbolsByName.set(s.name, [s]);
    }
  }
  const symbolByFileAndName = new Map<string, { id: number; symbol_key: string }>();
  for (const s of symbolRows) {
    symbolByFileAndName.set(`${s.file_id}\u0000${s.name}`, { id: s.id, symbol_key: s.symbol_key });
  }
  const updateAlias = db.prepare(
    "UPDATE edges SET to_symbol_id = ?, to_file_id = ?, resolved = 1, resolution = 'import-alias' WHERE id = ?",
  );
  const updateName = db.prepare(
    "UPDATE edges SET to_symbol_id = ?, to_file_id = ?, resolved = 1, resolution = 'name-match' WHERE id = ?",
  );
  const candidateEdges = db
    .prepare(
      `SELECT id, from_file_id, to_name FROM edges WHERE kind IN ('call', 'reference') ORDER BY id ASC`,
    )
    .all() as { id: number; from_file_id: number; to_name: string }[];
  for (const edge of candidateEdges) {
    const binding = localBindings.get(edge.from_file_id)?.get(edge.to_name);
    if (binding) {
      const name = binding.importedName ?? edge.to_name;
      const symbol = symbolByFileAndName.get(`${binding.targetFileId}\u0000${name}`);
      if (symbol) {
        updateAlias.run(symbol.id, binding.targetFileId, edge.id);
        continue;
      }
      // Alias bound to a real imported file but no matching symbol (e.g.
      // re-export or dynamic shape): record the file edge, still unresolved at
      // symbol level — never claim a symbol identity we did not find.
      db.prepare("UPDATE edges SET to_file_id = ?, resolved = 0, resolution = 'none' WHERE id = ?").run(
        binding.targetFileId,
        edge.id,
      );
      continue;
    }
    const matches = symbolsByName.get(edge.to_name);
    if (matches && matches.length === 1) {
      updateName.run(matches[0].id, matches[0].file_id, edge.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Test relationships derived from the pinned import graph
// ---------------------------------------------------------------------------

const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

/** A path is a test file when it lives in a test directory or is *.test.*. */
export function isTestPath(path: string): boolean {
  const posixPath = path.replace(/\\/g, "/");
  return TEST_PATH_RE.test(posixPath) || TEST_FILE_RE.test(posixPath);
}

/**
 * Rebuild graph-derived test relationships: a test file that imports an
 * indexed source file. This is a STRUCTURAL fact of the pinned import graph —
 * it is provenance-tagged 'import-graph' and is NOT a claim that every test in
 * the file exercises the target, nor a complete test mapping. Rebuilt from
 * scratch on every indexing run (derived data).
 */
function rebuildTestMappings(db: Database.Database): void {
  db.prepare("DELETE FROM test_mappings").run();
  const testFiles = (
    db.prepare("SELECT id, path FROM files").all() as { id: number; path: string }[]
  ).filter((f) => isTestPath(f.path));
  if (testFiles.length === 0) {
    return;
  }
  const insert = db.prepare(
    `INSERT INTO test_mappings (test_file_id, test_name, to_file_id, to_symbol_id, provenance)
     VALUES (?, ?, ?, ?, 'import-graph')`,
  );
  const importEdges = (
    db
      .prepare(
        `SELECT from_file_id, to_file_id FROM edges
         WHERE kind = 'import' AND to_file_id IS NOT NULL
         ORDER BY from_file_id ASC, to_file_id ASC, id ASC`,
      )
      .all() as { from_file_id: number; to_file_id: number }[]
  );
  const seen = new Set<string>();
  for (const testFile of testFiles) {
    for (const edge of importEdges) {
      if (edge.from_file_id !== testFile.id) {
        continue;
      }
      const key = `${testFile.id}\u0000${edge.to_file_id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      insert.run(testFile.id, testFile.path, edge.to_file_id, null);
    }
  }
}

// ---------------------------------------------------------------------------
// Rules ingestion (pinned-blob discovery from approved configured paths)
// ---------------------------------------------------------------------------

/**
 * Default approved rule sources. Discovery reads the PINNED commit tree, so a
 * dirty local edit to AGENTS.md or a rules file can never leak into the index;
 * only committed content is indexed, and its content hash is the hash of the
 * decoded body a caller can re-verify against the blob.
 */
export const DEFAULT_RULE_GLOBS = ["AGENTS.md", "docs/rules/*.md", ".patchdiet/rules/*.md"];

interface RuleRow {
  sourcePath: string;
  name: string;
  body: string;
  contentSha: string;
}

/** Discover + decode rule blobs from the pinned tree (no filesystem reads). */
function collectRuleRows(
  tree: TreeEntry[],
  blobs: Map<string, Buffer>,
  globs: string[],
): RuleRow[] {
  if (globs.length === 0) {
    return [];
  }
  const matchers = globs.map((glob) => {
    if (isAbsolute(glob) || glob.startsWith("..")) {
      throw new Error(`ERROR: rule glob '${glob}' must be repository-relative and inside the repository.`);
    }
    return globToRegExp(glob);
  });
  const matched = tree
    .filter((entry) => matchers.some((re) => re.test(entry.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (matched.length > MAX_RULE_FILES) {
    throw new Error(
      `ERROR: rule discovery found more than ${MAX_RULE_FILES} files; narrow the configured globs.`,
    );
  }
  const rows: RuleRow[] = [];
  for (const entry of matched) {
    const bytes = blobs.get(entry.blobSha);
    if (!bytes) {
      throw new Error(`ERROR: rule blob ${entry.blobSha} for '${entry.path}' was not read from the object database.`);
    }
    if (bytes.length > MAX_RULE_BYTES) {
      throw new Error(
        `ERROR: rule source '${entry.path}' exceeds the ${MAX_RULE_BYTES}-byte bound; refusing unbounded input.`,
      );
    }
    const decoded = decodeUtf8Strict(bytes);
    if (!decoded.ok) {
      throw new Error(
        `ERROR: rule source '${entry.path}' is not valid UTF-8 (${decoded.reason}); refusing to index it.`,
      );
    }
    const parsed = parseRuleFrontmatterName(decoded.text, entry.path);
    rows.push({
      sourcePath: entry.path,
      name: parsed.name,
      body: parsed.body,
      contentSha: createHash("sha256").update(parsed.body, "utf8").digest("hex"),
    });
  }
  return rows;
}

function writeRules(db: Database.Database, rows: RuleRow[]): IndexRepositoryResult["rules"] {
  db.transaction(() => {
    db.prepare("DELETE FROM rules").run();
    const insert = db.prepare("INSERT INTO rules (source_path, name, body, content_sha) VALUES (?, ?, ?, ?)");
    for (const row of rows) {
      insert.run(row.sourcePath, row.name, row.body, row.contentSha);
    }
  })();
  return { sources: rows.map((r) => r.sourcePath), count: rows.length };
}

// ---------------------------------------------------------------------------
// Coverage ingestion (bounded, schema-validated, provenance-carrying)
// ---------------------------------------------------------------------------

function ensureCoverageLineSchema(db: Database.Database): void {
  // Transactional bounded migration on the WRITE connection only: adds line
  // interval storage to schema-1 databases without touching existing tables,
  // so v1 databases and all existing readonly queries keep working.
  db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS coverage_lines (" +
        "id INTEGER PRIMARY KEY," +
        "coverage_run_id INTEGER NOT NULL REFERENCES coverage_runs(id) ON DELETE CASCADE," +
        "test_name TEXT," +
        "file_path TEXT NOT NULL," +
        "start_line INTEGER NOT NULL," +
        "end_line INTEGER NOT NULL)",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_coverage_lines_path ON coverage_lines(file_path)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_coverage_lines_run ON coverage_lines(coverage_run_id)");
    const columns = (db.prepare("PRAGMA table_info(coverage_runs)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    if (!columns.includes("format")) {
      db.exec("ALTER TABLE coverage_runs ADD COLUMN format TEXT");
    }
    if (!columns.includes("source_path")) {
      db.exec("ALTER TABLE coverage_runs ADD COLUMN source_path TEXT");
    }
    if (!columns.includes("indexed_commit")) {
      db.exec("ALTER TABLE coverage_runs ADD COLUMN indexed_commit TEXT");
    }
  })();
}

async function ingestCoverage(
  db: Database.Database,
  repoRoot: string,
  coveragePath: string,
  indexedCommit: string,
): Promise<IndexRepositoryResult["coverage"]> {
  const abs = isAbsolute(coveragePath) ? coveragePath : join(repoRoot, coveragePath);
  assertOwnedPath(repoRoot, abs, "coverage input");
  assertSafeDatabaseLeaf(abs, "coverage input file");
  const stats = statSync(abs);
  if (stats.size > MAX_COVERAGE_BYTES) {
    throw new Error(
      `ERROR: coverage input '${coveragePath}' exceeds the ${MAX_COVERAGE_BYTES}-byte bound; refusing unbounded input.`,
    );
  }
  const raw = await fsp.readFile(abs, "utf8");
  const coverage = parseCoverageInputAny(raw, repoRoot);
  const contentSha = createHash("sha256").update(raw, "utf8").digest("hex");

  // Row bound: total persisted line-interval rows are capped explicitly.
  let plannedRows = 0;
  for (const intervals of Object.values(coverage.aggregate)) {
    plannedRows += intervals.length;
  }
  for (const test of coverage.tests) {
    for (const intervals of Object.values(test.intervals)) {
      plannedRows += intervals.length;
    }
  }
  if (plannedRows > MAX_COVERAGE_LINE_ROWS) {
    throw new Error(
      `ERROR: coverage input expands to ${plannedRows} line-interval rows, exceeding the ${MAX_COVERAGE_LINE_ROWS}-row bound; refusing unbounded input.`,
    );
  }

  ensureCoverageLineSchema(db);

  const diagnostics: string[] = [];
  const knownPaths = new Set(
    (db.prepare("SELECT path FROM files").all() as { path: string }[]).map((row) => row.path),
  );

  db.transaction(() => {
    // Deterministic identity resolution: lastInsertRowid is NOT trusted (a DO
    // NOTHING conflict can leave a nonzero id from an unrelated earlier
    // insert). The run is resolved by its (source, content_sha) identity.
    const runInfo = db
      .prepare(
        "INSERT INTO coverage_runs (source, content_sha, ingested_at, format, source_path, indexed_commit) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(source, content_sha) DO NOTHING",
      )
      .run(coverage.source, contentSha, new Date().toISOString(), coverage.format, coveragePath.replaceAll("\\", "/"), indexedCommit);
    let runId: number;
    const existing = db
      .prepare("SELECT id FROM coverage_runs WHERE source = ? AND content_sha = ?")
      .get(coverage.source, contentSha) as { id: number } | undefined;
    if (existing !== undefined) {
      runId = existing.id;
      db.prepare("DELETE FROM test_files WHERE coverage_run_id = ?").run(runId);
      db.prepare("DELETE FROM coverage_lines WHERE coverage_run_id = ?").run(runId);
      // Re-ingesting the same input at a new commit re-asserts the caller's
      // measurement context: the run's commit provenance is refreshed.
      db.prepare(
        "UPDATE coverage_runs SET indexed_commit = ?, format = ?, source_path = ?, ingested_at = ? WHERE id = ?",
      ).run(indexedCommit, coverage.format, coveragePath.replaceAll("\\", "/"), new Date().toISOString(), runId);
    } else {
      runId = Number(runInfo.lastInsertRowid);
    }
    const insertTestFile = db.prepare(
      "INSERT INTO test_files (coverage_run_id, test_name, file_path) VALUES (?, ?, ?)",
    );
    for (const test of coverage.tests) {
      for (const file of test.files) {
        const normalized = file.replace(/\\/g, "/");
        insertTestFile.run(runId, test.name, normalized);
        if (!knownPaths.has(normalized)) {
          diagnostics.push(`coverage path '${normalized}' (test '${test.name}') is not present in the pinned index (unmapped or stale blob)`);
        }
      }
    }
    // Line intervals: per-test rows carry their EXPLICIT caller-declared test
    // name; aggregate rows carry NULL. Aggregate data never enters test_files
    // and therefore never invents test identities in the mapping query.
    const insertLine = db.prepare(
      "INSERT INTO coverage_lines (coverage_run_id, test_name, file_path, start_line, end_line) VALUES (?, ?, ?, ?, ?)",
    );
    for (const test of coverage.tests) {
      for (const [path, intervals] of Object.entries(test.intervals)) {
        for (const [startLine, endLine] of intervals) {
          insertLine.run(runId, test.name, path, startLine, endLine);
        }
        if (!knownPaths.has(path)) {
          diagnostics.push(`coverage path '${path}' (test '${test.name}') is not present in the pinned index (unmapped or stale blob)`);
        }
      }
    }
    for (const [path, intervals] of Object.entries(coverage.aggregate)) {
      for (const [startLine, endLine] of intervals) {
        insertLine.run(runId, null, path, startLine, endLine);
      }
      if (!knownPaths.has(path)) {
        diagnostics.push(`coverage path '${path}' is not present in the pinned index (unmapped, stale blob, or outside the measured commit)`);
      }
    }
  })();

  return {
    source: coverage.source,
    format: coverage.format,
    tests: coverage.tests.length,
    aggregateFiles: Object.keys(coverage.aggregate).length,
    lineRows: plannedRows,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------

export interface SymbolQuery {
  name?: string;
  kind?: string;
  path?: string;
  exported?: boolean;
  language?: string;
}

export interface SymbolRowView {
  path: string;
  language: string;
  symbolKey: string;
  name: string;
  kind: string;
  parentKey: string | null;
  exported: boolean;
  fileComplete: boolean;
  range: {
    startByte: number;
    endByte: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  span: { startByte: number; endByte: number };
}

export interface EdgeView {
  kind: string;
  toName: string;
  fromSymbolKey: string | null;
  toSymbolKey: string | null;
  toPath: string | null;
  resolved: boolean;
  resolution: string;
  provenance: string;
  startByte: number;
  endByte: number;
}

export interface FileGraphView {
  file: {
    path: string;
    language: string;
    blobSha: string;
    complete: boolean;
    diagnostics: unknown[];
  };
  symbols: SymbolRowView[];
  imports: { moduleSpecifier: string; importedName: string | null; alias: string | null }[];
  edges: EdgeView[];
}

export class KnowledgeIndex {
  private db: Database.Database;
  private closed = false;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  /** Read-only open: refuses unknown/future databases without modifying them. */
  static openReadonly(databasePath: string): KnowledgeIndex {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      const state = inspectDatabase(db, true);
      if (state.kind === "future") {
        throw new Error(
          `ERROR: '${databasePath}' uses schema version ${state.version}, newer than supported (${SCHEMA_VERSION}).`,
        );
      }
      if (state.kind === "unknown") {
        throw new Error(
          `ERROR: '${databasePath}' is not a PatchDiet semantic index (unknown database: ${state.reason}).`,
        );
      }
      if (state.kind !== "current") {
        throw new Error(`ERROR: '${databasePath}' does not contain a current PatchDiet index (state: ${state.kind}).`);
      }
      db.pragma("foreign_keys = ON");
    } catch (error) {
      db.close();
      throw error;
    }
    return new KnowledgeIndex(db);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("ERROR: this KnowledgeIndex handle is closed.");
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  schemaVersion(): number {
    this.assertOpen();
    return this.db.pragma("user_version", { simple: true }) as number;
  }

  repoIdentity(): { root: string; lastCommit: string | null; toolVersion: string | null } {
    this.assertOpen();
    const meta = this.db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[];
    const byKey = new Map(meta.map((m) => [m.key, m.value]));
    const repo = this.db.prepare("SELECT canonical_root FROM repo WHERE id = 1").get() as
      | { canonical_root: string }
      | undefined;
    return {
      root: repo?.canonical_root ?? byKey.get("repo_root") ?? "",
      lastCommit: byKey.get("last_commit") ?? null,
      toolVersion: byKey.get("tool_version") ?? null,
    };
  }

  querySymbols(filter: SymbolQuery): SymbolRowView[] {
    this.assertOpen();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.name !== undefined) {
      conditions.push("s.name = ?");
      params.push(filter.name);
    }
    if (filter.kind !== undefined) {
      conditions.push("s.kind = ?");
      params.push(filter.kind);
    }
    if (filter.path !== undefined) {
      conditions.push("f.path = ?");
      params.push(filter.path);
    }
    if (filter.language !== undefined) {
      conditions.push("f.language = ?");
      params.push(filter.language);
    }
    if (filter.exported !== undefined) {
      conditions.push("s.exported = ?");
      params.push(filter.exported ? 1 : 0);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT s.symbol_key, s.name, s.kind, s.parent_key, s.exported,
                s.start_byte, s.end_byte, s.start_line, s.start_column, s.end_line, s.end_column,
                s.span_start_byte, s.span_end_byte,
                f.path, f.language, f.complete
         FROM symbols s JOIN files f ON f.id = s.file_id
         ${where}
         ORDER BY f.path ASC, s.start_byte ASC, s.name ASC, s.id ASC`,
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      path: r.path as string,
      language: r.language as string,
      symbolKey: r.symbol_key as string,
      name: r.name as string,
      kind: r.kind as string,
      parentKey: (r.parent_key as string | null) ?? null,
      exported: r.exported === 1,
      fileComplete: r.complete === 1,
      range: {
        startByte: r.start_byte as number,
        endByte: r.end_byte as number,
        startLine: r.start_line as number,
        startColumn: r.start_column as number,
        endLine: r.end_line as number,
        endColumn: r.end_column as number,
      },
      span: { startByte: r.span_start_byte as number, endByte: r.span_end_byte as number },
    }));
  }

  getFileGraph(path: string): FileGraphView {
    this.assertOpen();
    const file = this.db
      .prepare("SELECT id, path, blob_sha, language, complete, diagnostics_json FROM files WHERE path = ?")
      .get(path) as
      | { id: number; path: string; blob_sha: string; language: string; complete: number; diagnostics_json: string }
      | undefined;
    if (!file) {
      throw new Error(`ERROR: file '${path}' is not present in this index.`);
    }
    const symbols = this.querySymbols({ path });
    const imports = (
      this.db
        .prepare(
          `SELECT module_specifier, imported_name, alias
           FROM imports WHERE file_id = ? ORDER BY start_byte ASC, id ASC`,
        )
        .all(file.id) as Record<string, unknown>[]
    ).map((r) => ({
      moduleSpecifier: r.module_specifier as string,
      importedName: (r.imported_name as string | null) ?? null,
      alias: (r.alias as string | null) ?? null,
    }));
    // Target symbol keys must be looked up GLOBALLY: a resolved edge may point
    // at a symbol in another file (cross-file call through an import alias), and
    // a same-file-only map would silently drop that target identity.
    const symbolKeyById = new Map<number, string>();
    for (const row of this.db.prepare("SELECT id, symbol_key FROM symbols").all() as {
      id: number;
      symbol_key: string;
    }[]) {
      symbolKeyById.set(row.id, row.symbol_key);
    }
    const fileById = new Map<number, string>();
    for (const row of this.db.prepare("SELECT id, path FROM files").all() as { id: number; path: string }[]) {
      fileById.set(row.id, row.path);
    }
    const edges = (
      this.db
        .prepare(
          `SELECT kind, to_name, from_symbol_key, to_symbol_id, to_file_id, resolved, resolution,
                  provenance, start_byte, end_byte
           FROM edges WHERE from_file_id = ? ORDER BY start_byte ASC, kind ASC, id ASC`,
        )
        .all(file.id) as Record<string, unknown>[]
    ).map((r) => ({
      kind: r.kind as string,
      toName: r.to_name as string,
      fromSymbolKey: (r.from_symbol_key as string | null) ?? null,
      toSymbolKey: r.to_symbol_id !== null ? (symbolKeyById.get(r.to_symbol_id as number) ?? null) : null,
      toPath: r.to_file_id !== null ? (fileById.get(r.to_file_id as number) ?? null) : null,
      resolved: r.resolved === 1,
      resolution: r.resolution as string,
      provenance: r.provenance as string,
      startByte: r.start_byte as number,
      endByte: r.end_byte as number,
    }));
    return {
      file: {
        path: file.path,
        language: file.language,
        blobSha: file.blob_sha,
        complete: file.complete === 1,
        diagnostics: JSON.parse(file.diagnostics_json),
      },
      symbols,
      imports,
      edges,
    };
  }

  searchRules(query: string): { name: string; sourcePath: string; body: string; contentSha: string }[] {
    this.assertOpen();
    const rows = this.db
      .prepare(
        `SELECT r.name, r.source_path, r.body, r.content_sha
         FROM rules_fts fts JOIN rules r ON r.id = fts.rowid
         WHERE rules_fts MATCH ?
         ORDER BY r.source_path ASC, r.name ASC`,
      )
      .all(query) as { name: string; source_path: string; body: string; content_sha: string }[];
    return rows.map((r) => ({
      name: r.name,
      sourcePath: r.source_path,
      body: r.body,
      contentSha: r.content_sha,
    }));
  }

  /**
   * Test relationships touching a source file, from two explicitly-labeled
   * provenance sources:
   * - `coverage-input`: raw coverage JSON ingested via `coveragePath` — a
   *   reported mapping, never a claim of complete coverage;
   * - `import-graph`: a test file that structurally imports the source file in
   *   the pinned commit. This is an import fact, NOT proof the test executes
   *   the target, and NOT a complete test mapping.
   *
   * `indexed` reports whether the mapped source path is present in this index.
   * Rows are ordered deterministically.
   */
  getTestMappings(filter: { path?: string; testName?: string }): TestMappingView[] {
    this.assertOpen();
    const out: TestMappingView[] = [];

    // Coverage-input rows: filter on the covered source file path.
    const covConditions: string[] = [];
    const covParams: unknown[] = [];
    if (filter.path !== undefined) {
      covConditions.push("tf.file_path = ?");
      covParams.push(filter.path);
    }
    if (filter.testName !== undefined) {
      covConditions.push("tf.test_name = ?");
      covParams.push(filter.testName);
    }
    const covWhere = covConditions.length ? `WHERE ${covConditions.join(" AND ")}` : "";
    // Staleness gate: coverage-input mappings are offered only from runs
    // measured against the CURRENT pinned commit (meta last_commit). Runs from
    // other commits (or with unknown commit provenance) are history: they stay
    // queryable via getCoverageRuns but must not feed current test mappings.
    const currentCommitForMappings = (
      this.db.prepare("SELECT value FROM meta WHERE key = 'last_commit'").get() as { value: string } | undefined
    )?.value ?? "";
    // Schema-aware gating: never-extended schema1 databases have no
    // indexed_commit column (readonly connections never migrate). Their
    // coverage rows carry NO commit provenance and must not be offered as
    // current test mappings; static import-graph mappings are unaffected.
    const coverageColumns = this.hasCoverageSchema()
      ? (this.db.prepare("PRAGMA table_info(coverage_runs)").all() as { name: string }[]).map((c) => c.name)
      : [];
    const covRows = coverageColumns.includes("indexed_commit")
      ? (
          this.db
            .prepare(
              `SELECT tf.test_name, tf.file_path, cr.source, cr.indexed_commit,
                      CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS indexed
               FROM test_files tf
               JOIN coverage_runs cr ON cr.id = tf.coverage_run_id
               LEFT JOIN files f ON f.path = tf.file_path
               ${covWhere}`,
            )
            .all(...covParams) as { test_name: string; file_path: string; source: string; indexed_commit: string | null; indexed: number }[]
        ).filter((row) => row.indexed_commit !== null && row.indexed_commit === currentCommitForMappings)
      : [];
    for (const r of covRows) {
      out.push({
        testName: r.test_name,
        filePath: r.file_path,
        indexed: r.indexed === 1,
        source: r.source,
        provenance: "coverage-input",
      });
    }

    // Import-graph rows: `path` filters the imported TARGET file; `testName`
    // filters the test file path.
    const graphConditions: string[] = [];
    const graphParams: unknown[] = [];
    if (filter.path !== undefined) {
      graphConditions.push("dest.path = ?");
      graphParams.push(filter.path);
    }
    if (filter.testName !== undefined) {
      graphConditions.push("tf.path = ?");
      graphParams.push(filter.testName);
    }
    const graphWhere = graphConditions.length ? `WHERE ${graphConditions.join(" AND ")}` : "";
    const graphRows = this.db
      .prepare(
        `SELECT tf.path AS test_path, dest.path AS file_path
         FROM test_mappings tm
         JOIN files tf ON tf.id = tm.test_file_id
         JOIN files dest ON dest.id = tm.to_file_id
         ${graphWhere}`,
      )
      .all(...graphParams) as { test_path: string; file_path: string }[];
    for (const r of graphRows) {
      out.push({
        testName: r.test_path,
        filePath: r.file_path,
        indexed: true,
        source: "import-graph",
        provenance: "import-graph",
      });
    }

    out.sort(
      (a, b) =>
        (a.testName < b.testName ? -1 : a.testName > b.testName ? 1 : 0) ||
        (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0) ||
        (a.provenance < b.provenance ? -1 : a.provenance > b.provenance ? 1 : 0),
    );
    return out;
  }

  /**
   * True when this database carries the coverage line schema. Older schema-1
   * databases (created before coverage ingestion) have no such tables; the
   * coverage queries then return EMPTY results instead of throwing — readonly
   * connections never migrate.
   */
  private hasCoverageSchema(): boolean {
    this.assertOpen();
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coverage_lines'")
      .all() as { name: string }[];
    if (tables.length === 0) {
      return false;
    }
    const columns = (this.db.prepare("PRAGMA table_info(coverage_runs)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    return columns.includes("format") && columns.includes("source_path") && columns.includes("indexed_commit");
  }

  /**
   * Coverage runs recorded in this index, with source format/hash/path/commit
   * provenance. Read-only; aggregate and per-test rows are distinguishable
   * via coverage_lines (test_name NULL = aggregate). Databases without the
   * coverage schema yield an empty list.
   */
  getCoverageRuns(): {
    id: number;
    source: string;
    format: string | null;
    sourcePath: string | null;
    contentSha: string;
    ingestedAt: string;
    /** Commit the coverage input was ingested against (caller-declared measurement context; null = unknown provenance). */
    indexedCommit: string | null;
    /** DISTINCT test identities recorded by this run (never a row count). */
    tests: number;
    /** Total per-test interval rows (a single test may contribute many rows). */
    perTestRows: number;
    aggregateRows: number;
  }[] {
    if (!this.hasCoverageSchema()) {
      return [];
    }
    const runs = this.db
      .prepare(
        "SELECT id, source, format, source_path AS sourcePath, content_sha AS contentSha, ingested_at AS ingestedAt, indexed_commit AS indexedCommit FROM coverage_runs ORDER BY id",
      )
      .all() as { id: number; source: string; format: string | null; sourcePath: string | null; contentSha: string; ingestedAt: string; indexedCommit: string | null }[];
    const out: {
      id: number; source: string; format: string | null; sourcePath: string | null; contentSha: string; ingestedAt: string; indexedCommit: string | null; tests: number; perTestRows: number; aggregateRows: number;
    }[] = [];
    for (const run of runs) {
      // tests = DISTINCT test identities across BOTH sources of per-test
      // rows: schema1 file-only mappings live in test_files, interval-bearing
      // contexts in coverage_lines. The same test name is deduplicated across
      // the two tables, so one identity always counts once. perTestRows =
      // raw per-test interval rows only (a test with several intervals still
      // counts once in `tests`).
      const testFileNames = this.db
        .prepare("SELECT DISTINCT test_name AS name FROM test_files WHERE coverage_run_id = ?")
        .all(run.id) as { name: string }[];
      const intervalNames = this.db
        .prepare("SELECT DISTINCT test_name AS name FROM coverage_lines WHERE coverage_run_id = ? AND test_name IS NOT NULL")
        .all(run.id) as { name: string }[];
      const identities = new Set<string>([
        ...testFileNames.map((row) => row.name),
        ...intervalNames.map((row) => row.name),
      ]);
      const tests = identities.size;
      const perTestRows = (
        this.db.prepare("SELECT COUNT(*) AS n FROM coverage_lines WHERE coverage_run_id = ? AND test_name IS NOT NULL").get(run.id) as { n: number }
      ).n;
      const aggregateRows = (
        this.db.prepare("SELECT COUNT(*) AS n FROM coverage_lines WHERE coverage_run_id = ? AND test_name IS NULL").get(run.id) as { n: number }
      ).n;
      out.push({ ...run, tests, perTestRows, aggregateRows });
    }
    return out;
  }

  /**
   * Recorded line intervals for a file. Without a test name this returns
   * AGGREGATE intervals only; with a test name, that test's explicit
   * intervals. Absence of an interval is NOT a completeness claim. Databases
   * without the coverage schema yield an empty list.
   */
  getCoverageLineIntervals(
    path: string,
    testName?: string,
  ): { testName: string | null; startLine: number; endLine: number; runId: number; indexedCommit: string | null; current: boolean }[] {
    if (!this.hasCoverageSchema()) {
      return [];
    }
    const currentCommit = (
      this.db.prepare("SELECT value FROM meta WHERE key = 'last_commit'").get() as { value: string } | undefined
    )?.value ?? "";
    const baseSelect =
      "SELECT cl.test_name AS testName, cl.start_line AS startLine, cl.end_line AS endLine, " +
      "cl.coverage_run_id AS runId, cr.indexed_commit AS indexedCommit " +
      "FROM coverage_lines cl JOIN coverage_runs cr ON cr.id = cl.coverage_run_id " +
      "WHERE cl.file_path = ?";
    const rows = (testName === undefined
      ? this.db
          .prepare(baseSelect + " AND cl.test_name IS NULL ORDER BY cl.start_line, cl.end_line")
          .all(path)
      : this.db
          .prepare(baseSelect + " AND cl.test_name = ? ORDER BY cl.start_line, cl.end_line")
          .all(path, testName)) as {
      testName: string | null;
      startLine: number;
      endLine: number;
      runId: number;
      indexedCommit: string | null;
    }[];
    return rows.map((row) => ({
      testName: row.testName,
      startLine: row.startLine,
      endLine: row.endLine,
      runId: row.runId,
      indexedCommit: row.indexedCommit,
      current: row.indexedCommit !== null && row.indexedCommit === currentCommit,
    }));
  }

  /**
   * Associates recorded coverage line intervals with pinned symbol spans for
   * a file. Semantics:
   * - Symbol spans are reported in the SAME 1-based line basis as coverage
   *   data (the parser stores zero-based rows; +1 is applied here).
   * - Covered intervals are CLIPPED to the symbol span; intervals from other
   *   files or outside the span never leak in.
   * - Only runs measured against the CURRENT pinned commit (meta last_commit)
   *   apply: stale runs (other commits, or unknown commit provenance) are
   *   excluded from symbol evidence. They remain listed by getCoverageRuns.
   * - Only runs that actually recorded intervals for THIS file count as the
   *   symbol's provenance — an unrelated file's coverage run is never
   *   attached.
   * - Explicit per-test intervals are included alongside aggregate ones, with
   *   their context (testName) retained per interval.
   * Databases without the coverage schema yield an empty list.
   */
  getSymbolCoverage(path: string): {
    symbolKey: string;
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    coveredIntervals: { startLine: number; endLine: number; testName: string | null; runIds: number[] }[];
    uncoveredWithinSpan: { startLine: number; endLine: number }[];
    coverageRuns: { id: number; source: string; format: string | null; sourcePath: string | null; contentSha: string; indexedCommit: string | null }[];
  }[] {
    if (!this.hasCoverageSchema()) {
      return [];
    }
    const file = this.db.prepare("SELECT id FROM files WHERE path = ?").get(path) as
      | { id: number }
      | undefined;
    if (file === undefined) {
      return [];
    }
    const currentCommit = (
      this.db.prepare("SELECT value FROM meta WHERE key = 'last_commit'").get() as { value: string } | undefined
    )?.value;
    // Staleness gate: a coverage run authorizes evidence only when it was
    // measured against THIS index's pinned commit. Runs with unknown commit
    // provenance never authorize symbol evidence.
    const currentRuns = (this.db
      .prepare(
        "SELECT id, source, format, source_path AS sourcePath, content_sha AS contentSha, indexed_commit AS indexedCommit FROM coverage_runs WHERE indexed_commit IS NOT NULL AND indexed_commit = ? ORDER BY id",
      )
      .all(currentCommit ?? "") as { id: number; source: string; format: string | null; sourcePath: string | null; contentSha: string; indexedCommit: string | null }[]);
    const relevantRunIds = new Set<number>();
    const recorded: { testName: string | null; startLine: number; endLine: number; runId: number }[] = [];
    for (const run of currentRuns) {
      const rows = this.db
        .prepare(
          "SELECT test_name AS testName, start_line AS startLine, end_line AS endLine FROM coverage_lines WHERE coverage_run_id = ? AND file_path = ? ORDER BY start_line, end_line",
        )
        .all(run.id, path) as { testName: string | null; startLine: number; endLine: number }[];
      if (rows.length === 0) {
        continue; // this run never measured this file — not symbol provenance
      }
      relevantRunIds.add(run.id);
      for (const row of rows) {
        recorded.push({ testName: row.testName, startLine: row.startLine, endLine: row.endLine, runId: run.id });
      }
    }
    const relevantRuns = currentRuns
      .filter((run) => relevantRunIds.has(run.id))
      .map((run) => ({
        id: run.id,
        source: run.source,
        format: run.format,
        sourcePath: run.sourcePath,
        contentSha: run.contentSha,
        indexedCommit: run.indexedCommit,
      }));
    const symbols = this.db
      .prepare(
        "SELECT symbol_key AS symbolKey, name, kind, start_line AS startLine, end_line AS endLine FROM symbols WHERE file_id = ? ORDER BY start_line",
      )
      .all(file.id) as { symbolKey: string; name: string; kind: string; startLine: number; endLine: number }[];
    const out: {
      symbolKey: string; name: string; kind: string; startLine: number; endLine: number;
      coveredIntervals: { startLine: number; endLine: number; testName: string | null; runIds: number[] }[];
      uncoveredWithinSpan: { startLine: number; endLine: number }[];
      coverageRuns: { id: number; source: string; format: string | null; sourcePath: string | null; contentSha: string; indexedCommit: string | null }[];
    }[] = [];
    for (const symbol of symbols) {
      // 1-based line basis: the parser stores zero-based tree-sitter rows.
      const spanStart = symbol.startLine + 1;
      const spanEnd = symbol.endLine + 1;
      // Clip recorded intervals to the symbol span; merge adjacent/overlapping
      // runs of the SAME context (aggregate and per-test stay distinguishable).
      // Ingestion order is arbitrary: clip ALL intervals first, then sort by
      // position, and only then merge with min/max on BOTH ends — merging
      // before sorting (or only extending endLine) silently loses the earlier
      // interval's start when a later run covers higher lines.
      const clippedAll: { startLine: number; endLine: number; testName: string | null; runId: number }[] = [];
      for (const entry of recorded) {
        const startLine = Math.max(entry.startLine, spanStart);
        const endLine = Math.min(entry.endLine, spanEnd);
        if (startLine > endLine) {
          continue;
        }
        clippedAll.push({ startLine, endLine, testName: entry.testName, runId: entry.runId });
      }
      clippedAll.sort((a, b) =>
        (a.testName ?? "").localeCompare(b.testName ?? "") ||
        a.startLine - b.startLine ||
        a.endLine - b.endLine,
      );
      const clipped: { startLine: number; endLine: number; testName: string | null; runIds: number[] }[] = [];
      for (const entry of clippedAll) {
        const last = clipped[clipped.length - 1];
        // Adjacent/overlapping same-context intervals merge; runIds union so
        // every contributing run stays visible in provenance. Gaps and
        // different contexts are never merged.
        if (
          last &&
          last.testName === entry.testName &&
          entry.startLine <= last.endLine + 1
        ) {
          last.startLine = Math.min(last.startLine, entry.startLine);
          last.endLine = Math.max(last.endLine, entry.endLine);
          if (!last.runIds.includes(entry.runId)) {
            last.runIds.push(entry.runId);
          }
        } else {
          clipped.push({ startLine: entry.startLine, endLine: entry.endLine, testName: entry.testName, runIds: [entry.runId] });
        }
      }
      // Explicit uncovered gaps INSIDE the symbol span: ranges of the span
      // with no recorded interval (never a completeness claim — depends on
      // what the current coverage input recorded). The gap walk uses a
      // GLOBALLY sorted union of all clipped positions regardless of context
      // — iterating the context-grouped list would fabricate gaps at context
      // boundaries even when another context covers those lines.
      const unionPositions = clipped
        .map((interval) => ({ startLine: interval.startLine, endLine: interval.endLine }))
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
      const uncovered: { startLine: number; endLine: number }[] = [];
      let cursor = spanStart;
      for (const interval of unionPositions) {
        if (interval.startLine > cursor) {
          uncovered.push({ startLine: cursor, endLine: interval.startLine - 1 });
        }
        cursor = Math.max(cursor, interval.endLine + 1);
      }
      if (cursor <= spanEnd) {
        uncovered.push({ startLine: cursor, endLine: spanEnd });
      }
      out.push({
        symbolKey: symbol.symbolKey,
        name: symbol.name,
        kind: symbol.kind,
        startLine: spanStart,
        endLine: spanEnd,
        coveredIntervals: clipped,
        uncoveredWithinSpan: uncovered,
        coverageRuns: relevantRuns,
      });
    }
    return out;
  }

  /**
   * True when this database carries the history extension schema. Databases
   * created before history ingestion (or with history disabled) have no such
   * tables; the history queries then return empty results instead of throwing
   * — readonly connections never create or migrate anything.
   */
  private hasHistorySchema(): boolean {
    this.assertOpen();
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_snapshots'")
      .all() as { name: string }[];
    return tables.length > 0;
  }

  /**
   * The single stored history snapshot, or null. `current` is true only when
   * the snapshot's pinned commit equals meta last_commit: stale snapshots are
   * surfaced as stale and must never be attached as current evidence.
   */
  getHistorySnapshot(): {
    pinnedCommit: string;
    collectedAt: string;
    shallow: boolean;
    truncated: boolean;
    commitCount: number;
    pathRows: number;
    cochangePairs: number;
    diagnostics: string[];
    current: boolean;
  } | null {
    if (!this.hasHistorySchema()) {
      return null;
    }
    const row = this.db.prepare("SELECT * FROM history_snapshots ORDER BY id DESC LIMIT 1").get() as
      | {
          pinned_commit: string;
          collected_at: string;
          shallow: number;
          truncated: number;
          commit_count: number;
          path_rows: number;
          cochange_pairs: number;
          diagnostics_json: string;
        }
      | undefined;
    if (row === undefined) {
      return null;
    }
    const currentCommit = (
      this.db.prepare("SELECT value FROM meta WHERE key = 'last_commit'").get() as { value: string } | undefined
    )?.value;
    return {
      pinnedCommit: row.pinned_commit,
      collectedAt: row.collected_at,
      shallow: row.shallow === 1,
      truncated: row.truncated === 1,
      commitCount: row.commit_count,
      pathRows: row.path_rows,
      cochangePairs: row.cochange_pairs,
      diagnostics: JSON.parse(row.diagnostics_json) as string[],
      current: row.pinned_commit === currentCommit,
    };
  }

  /**
   * File-level history facts for the given paths, from the CURRENT pinned
   * snapshot only. Stale snapshots, missing extension schema or paths absent
   * from history yield NO entry — absence never proves removability.
   * - changeCount: distinct recorded commits touching the path (a lower bound
   *   when truncated/shallow);
   * - sourceCommits: up to 5 most recent real commit SHAs touching the path;
   * - coChangedWith: top 5 file-level co-change partners with commit counts —
   *   a same-commit heuristic, NOT a symbol dependency or task similarity.
   */
  getHistoryFactsForPaths(paths: string[]): Record<
    string,
    {
      changeCount: number;
      sourceCommits: string[];
      snapshotCommit: string;
      coChangedWith: { path: string; count: number }[];
    }
  > {
    if (!this.hasHistorySchema()) {
      return {};
    }
    const snapshot = this.getHistorySnapshot();
    if (snapshot === null || !snapshot.current) {
      return {};
    }
    const snapshotId = (
      this.db.prepare("SELECT id FROM history_snapshots WHERE pinned_commit = ?").get(snapshot.pinnedCommit) as
        | { id: number }
        | undefined
    )?.id;
    if (snapshotId === undefined) {
      return {};
    }
    const out: Record<
      string,
      { changeCount: number; sourceCommits: string[]; snapshotCommit: string; coChangedWith: { path: string; count: number }[] }
    > = {};
    for (const path of paths) {
      const commits = this.db
        .prepare(
          "SELECT DISTINCT hc.sha AS sha FROM history_commit_paths hcp " +
            "JOIN history_commits hc ON hc.snapshot_id = hcp.snapshot_id AND hc.sha = hcp.commit_sha " +
            "WHERE hcp.snapshot_id = ? AND hcp.path = ? " +
            "ORDER BY hc.author_epoch DESC, hc.sha ASC LIMIT 5",
        )
        .all(snapshotId, path) as { sha: string }[];
      if (commits.length === 0) {
        continue; // no fabricated facts for paths without real history
      }
      const changeCount = (
        this.db
          .prepare("SELECT COUNT(DISTINCT commit_sha) AS n FROM history_commit_paths WHERE snapshot_id = ? AND path = ?")
          .get(snapshotId, path) as { n: number }
      ).n;
      const partners = this.db
        .prepare(
          "SELECT path_b AS partner, commit_count AS count FROM history_cochange WHERE snapshot_id = ? AND path_a = ? " +
            "UNION ALL " +
            "SELECT path_a AS partner, commit_count AS count FROM history_cochange WHERE snapshot_id = ? AND path_b = ? " +
            "ORDER BY count DESC, partner ASC LIMIT 5",
        )
        .all(snapshotId, path, snapshotId, path) as { partner: string; count: number }[];
      out[path] = {
        changeCount,
        sourceCommits: commits.map((row) => row.sha),
        snapshotCommit: snapshot.pinnedCommit,
        coChangedWith: partners.map((row) => ({ path: row.partner, count: row.count })),
      };
    }
    return out;
  }

  /**
   * Caller-asserted merged-PR records stored with the current history
   * snapshot. Provenance is always 'caller-asserted': labels are unverified
   * caller assertions, NOT GitHub authentication, and merged status was never
   * inferred from commit subjects. Empty when absent/disabled.
   */
  getMergedPrs(): {
    pr: string;
    mergeCommit: string;
    snapshotPath: string;
    labels: string[];
    provenance: "caller-asserted";
    inputPath: string;
    inputContentSha: string;
    indexedCommit: string;
    assertedAt: string;
  }[] {
    if (!this.hasHistorySchema()) {
      return [];
    }
    const rows = this.db
      .prepare(
        "SELECT pr, merge_commit AS mergeCommit, snapshot_path AS snapshotPath, labels_json AS labelsJson, " +
          "input_path AS inputPath, input_content_sha AS inputContentSha, indexed_commit AS indexedCommit, asserted_at AS assertedAt " +
          "FROM history_merged_prs ORDER BY pr ASC",
      )
      .all() as {
      pr: string;
      mergeCommit: string;
      snapshotPath: string;
      labelsJson: string;
      inputPath: string;
      inputContentSha: string;
      indexedCommit: string;
      assertedAt: string;
    }[];
    return rows.map((row) => ({
      pr: row.pr,
      mergeCommit: row.mergeCommit,
      snapshotPath: row.snapshotPath,
      labels: JSON.parse(row.labelsJson) as string[],
      provenance: "caller-asserted" as const,
      inputPath: row.inputPath,
      inputContentSha: row.inputContentSha,
      indexedCommit: row.indexedCommit,
      assertedAt: row.assertedAt,
    }));
  }
}

export interface TestMappingView {
  testName: string;
  filePath: string;
  indexed: boolean;
  source: string;
  provenance: "coverage-input" | "import-graph";
}

export function openKnowledgeIndexReadonly(databasePath: string): KnowledgeIndex {
  return KnowledgeIndex.openReadonly(databasePath);
}
