import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;

/**
 * Migration scripts: index N upgrades user_version N → N+1. v1 creates the
 * full schema inside one transaction. Future versions must never be migrated
 * down or modified; indexRepository refuses them.
 */
export const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE repo (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    canonical_root TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    blob_sha TEXT NOT NULL,
    language TEXT NOT NULL,
    complete INTEGER NOT NULL,
    diagnostics_json TEXT NOT NULL,
    prev_path TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE symbols (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_key TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    parent_key TEXT,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    span_start_byte INTEGER NOT NULL,
    span_end_byte INTEGER NOT NULL,
    exported INTEGER NOT NULL,
    UNIQUE (file_id, symbol_key)
  );
  CREATE INDEX idx_symbols_file ON symbols(file_id);
  CREATE INDEX idx_symbols_name ON symbols(name);

  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    module_specifier TEXT NOT NULL,
    imported_name TEXT,
    alias TEXT,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL
  );
  CREATE INDEX idx_imports_file ON imports(file_id);

  -- kind: 'call' | 'reference' | 'import'
  -- resolution: 'none' | 'name-match' | 'specifier-path'
  -- provenance: 'ast' (structural fact from the parser); name/specifier
  -- matching is recorded explicitly in the resolution column and is a
  -- heuristic: an absent edge NEVER proves a symbol unused or removable.
  CREATE TABLE edges (
    id INTEGER PRIMARY KEY,
    from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('call', 'reference', 'import')),
    to_name TEXT NOT NULL,
    from_symbol_key TEXT,
    to_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    to_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    resolved INTEGER NOT NULL,
    resolution TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance = 'ast'),
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL
  );
  CREATE INDEX idx_edges_from ON edges(from_file_id);
  CREATE INDEX idx_edges_to_symbol ON edges(to_symbol_id);
  CREATE INDEX idx_edges_to_file ON edges(to_file_id);

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    source_path TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    content_sha TEXT NOT NULL,
    UNIQUE (source_path, name)
  );

  CREATE VIRTUAL TABLE rules_fts USING fts5(
    name, body, content='rules', content_rowid='id', tokenize='porter unicode61'
  );
  CREATE TRIGGER rules_ai AFTER INSERT ON rules BEGIN
    INSERT INTO rules_fts(rowid, name, body) VALUES (new.id, new.name, new.body);
  END;
  CREATE TRIGGER rules_ad AFTER DELETE ON rules BEGIN
    INSERT INTO rules_fts(rules_fts, rowid, name, body) VALUES ('delete', old.id, old.name, old.body);
  END;
  CREATE TRIGGER rules_au AFTER UPDATE ON rules BEGIN
    INSERT INTO rules_fts(rules_fts, rowid, name, body) VALUES ('delete', old.id, old.name, old.body);
    INSERT INTO rules_fts(rowid, name, body) VALUES (new.id, new.name, new.body);
  END;

  -- Raw coverage input: bounded, schema-validated local input. It records
  -- provenance ('coverage-input'), never a claim of complete test mapping.
  CREATE TABLE coverage_runs (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    content_sha TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    UNIQUE (source, content_sha)
  );

  CREATE TABLE test_files (
    id INTEGER PRIMARY KEY,
    coverage_run_id INTEGER NOT NULL REFERENCES coverage_runs(id) ON DELETE CASCADE,
    test_name TEXT NOT NULL,
    file_path TEXT NOT NULL
  );
  CREATE INDEX idx_test_files_run ON test_files(coverage_run_id);
  CREATE INDEX idx_test_files_path ON test_files(file_path);

  -- Graph-derived test relationship: a test file that imports an indexed
  -- source file. This is a structural fact of the pinned commit's AST import
  -- graph, NOT a claim that every test in the file exercises the target, and
  -- NOT a claim of complete test coverage. Rebuilt deterministically on every
  -- indexing run (derived data).
  CREATE TABLE test_mappings (
    id INTEGER PRIMARY KEY,
    test_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    test_name TEXT NOT NULL,
    to_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    to_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    provenance TEXT NOT NULL CHECK (provenance = 'import-graph')
  );
  CREATE INDEX idx_test_mappings_to_file ON test_mappings(to_file_id);
  CREATE INDEX idx_test_mappings_test_file ON test_mappings(test_file_id);
  `,
];

const EXPECTED_TABLES = [
  "meta",
  "repo",
  "files",
  "symbols",
  "imports",
  "edges",
  "rules",
  "rules_fts",
  "coverage_runs",
  "test_files",
  "test_mappings",
];

export type DatabaseState =
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "current" }
  | { kind: "future"; version: number }
  | { kind: "unknown"; version: number; reason: string };

/**
 * Read-only inspection of a database file. Never writes, never migrates,
 * never creates sidecar files.
 */
export function inspectDatabase(db: Database.Database, fileExists: boolean): DatabaseState {
  if (!fileExists) {
    return { kind: "missing" };
  }
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    return { kind: "future", version };
  }
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
  if (version === SCHEMA_VERSION) {
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      return { kind: "unknown", version, reason: `missing tables: ${missing.join(", ")}` };
    }
    return { kind: "current" };
  }
  if (tables.length > 0) {
    return { kind: "unknown", version, reason: `user_version=${version} but tables exist: ${tables.join(", ")}` };
  }
  return { kind: "empty" };
}

/** Apply pending migrations inside one transaction; sets user_version. */
export function migrate(db: Database.Database): void {
  let version = db.pragma("user_version", { simple: true }) as number;
  db.transaction(() => {
    while (version < SCHEMA_VERSION) {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.pragma(`user_version = ${version}`);
    }
  })();
}
