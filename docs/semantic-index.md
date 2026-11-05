# Semantic Index (`@patchdiet/parsers` + `@patchdiet/knowledge`)

The semantic index gives PatchDiet a real AST-and-graph view of a repository at
a **pinned commit**, so later reduction stages can reason about symbols, imports,
calls, rules and test relationships without guessing from diffs alone.

Two packages provide it:

| Package | Responsibility |
|---------|----------------|
| `@patchdiet/parsers` | Real tree-sitter WASM parsing of TS/TSX/JS/JSX/Python into serializable facts. |
| `@patchdiet/knowledge` | SQLite repository index built from **git blobs of the pinned commit**, plus query APIs. |

Nothing here is a lexical or regex pseudo-parser. Every symbol, import, call,
reference and atom comes from a grammar parse; heuristics only *enrich* edges and
always label how they resolved.

---

## Coordinate contract (units are not optional)

All ranges use these units. They are enforced by byte-slice tests, not by naming.

| Field | Unit |
|-------|------|
| `startByte` / `endByte` | UTF-8 **byte** offsets into the UTF-8 encoding of the whole source. |
| `startLine` / `endLine` | 0-based line numbers; a line break is `\n`. A `\r` before it is part of the preceding line's content bytes. |
| `startColumn` / `endColumn` | 0-based UTF-8 **byte** columns within the line (not UTF-16 columns, not code points). |

Tree-sitter's JavaScript binding reports `startIndex`/`column` in **UTF-16 code
units**, which diverge from bytes as soon as the source has multi-byte or non-BMP
characters. The parser converts every position through the per-line byte prefix
before anything is stored — it never renames `startIndex` to `startByte`.

A leading UTF-8 BOM (U+FEFF, 3 bytes) is **preserved**: it shifts both byte
offsets and byte columns of the rest of line 0. It is never stripped, so offsets
stay aligned with the raw blob.

### `range` vs `span`

- `range` is the exact grammar node range.
- `span` is the **safe structural atom** range: the same node expanded to include
  its `export`/`default`/`declare` modifiers and preceding decorators, so slicing
  the span out of the source keeps the syntax valid. `span.startByte` ≤
  `range.startByte` and `span.endByte` ≥ `range.endByte`.

---

## `parseSource(path, text)`

```ts
import { parseSource } from "@patchdiet/parsers";

const result = await parseSource("src/calc.ts", sourceText);
```

Returns a `ParseResult`:

- `language`: `"typescript" | "tsx" | "javascript" | "jsx" | "python"`, or `null`
  for an unsupported extension (never a fabricated default).
- `complete`: `true` **only** when the grammar loaded, parsed with no ERROR/MISSING
  nodes, and extraction ran to completion. Any fallback is `complete: false` with a
  diagnostic explaining why.
- `symbols`: stable-identity symbols (`id`, `name`, `kind`, `parentId`, `range`,
  `span`, `exported`). Ids are deterministic across reparses of identical content
  and change when content changes.
- `imports`: module specifier, imported name, alias, range.
- `calls` / `references`: name + range + enclosing symbol id.
- `atoms`: complete statement/import/export/type/method/block nodes with byte-exact
  ranges and parent links, for the later sub-hunk reducer.
- `diagnostics`: `parse-error`, `unsupported-language`, `grammar-load-failed`,
  `parser-init-failed`, `extraction-truncated`, `invalid-encoding`.
- `metadata`: parser/grammar/version and the explicit `sourceUnits` declaration.
- `limitations`: human-readable notes on what the result does **not** cover.

WASM parser and tree handles are released after serializable data is extracted —
no live node objects leak into stored results (verified by JSON round-trip).

`invalidEncodingResult(path, reason, byteLength)` produces the explicit
`complete: false` entry used for blobs that are not valid UTF-8.

---

## `indexRepository(options)`

```ts
import { indexRepository } from "@patchdiet/knowledge";

const result = await indexRepository({
  cwd: repoDir,
  ref: "HEAD",                 // resolved to a pinned 40-hex commit before indexing
  databasePath: ".patchdiet/semantic-index.db",
  languages: ["typescript"],   // optional filter
  rules: { globs: ["docs/rules/*.md"] }, // optional; defaults below
  coveragePath: ".patchdiet/coverage.json", // optional raw coverage input
});
```

### Content source: pinned blobs only

Code content comes from `git cat-file` on the resolved commit — **never** the
working tree. Dirty or untracked files cannot leak into the index. Blob reads are
byte-faithful (exact framed size, framing LF excluded), bounded per blob and per
batch, and strict-UTF-8 validated.

### Incremental behavior

- **Unchanged** blob SHA → skipped (no reparse).
- **Changed** blob SHA → reparsed, old rows cleared.
- **Deleted** path → removed (FK cascades).
- **Renamed** path (same blob SHA, 1:1) → file id preserved, new path recorded.

### Rules: pinned-blob discovery

Rule sources are discovered from the pinned tree using approved configured globs.
Default approved sources:

```
AGENTS.md
docs/rules/*.md
.patchdiet/rules/*.md
```

A dirty local edit to `AGENTS.md` is **ignored** — only committed content is
indexed. The stored `content_sha` is the SHA-256 of the decoded body a caller can
re-verify. Rules are searchable through FTS5 (`searchRules`).

### Coverage input

`coveragePath` is bounded, schema-validated local JSON (see `coverageInputSchema`).
It is provenance-carrying **raw input** — it is never presented as a complete test
mapping.

### Database safety

Before any write the database path is validated:

- every path segment from the canonical repository root down to the target is
  walked; **any** intermediate symlink/junction is refused, even one pointing to
  another user directory inside the same repo;
- an existing database leaf must be a regular file with `nlink === 1` — SQLite
  writes in place, so a symlink/dangling junction leaf or an external hardlink
  alias is refused before opening;
- a database created for a different repository is refused (no cross-repo
  contamination);
- a **future** schema version, or an unknown non-PatchDiet database, is refused
  **without modification** (read-only inspection only; no journal-mode change, no
  sidecar files, no opportunistic migration).

All queries are parameterized and handles are closed on error paths.

---

## Query API (`KnowledgeIndex`)

Open read-only with `openKnowledgeIndexReadonly(databasePath)` (or
`KnowledgeIndex.openReadonly`); refuses unknown/future databases without modifying
them. Call `close()` when done.

### `querySymbols(filter)`

`filter`: `{ name?, kind?, path?, language?, exported? }`. Returns `SymbolRowView[]`
ordered by `path`, `startByte`, `name`, `id`. Each row has `range` (full byte
range) and `span` (`{ startByte, endByte }` — the safe structural atom range).

### `getFileGraph(path)`

Returns `{ file, symbols, imports, edges }` for one file. Each edge carries
`kind`, `toName`, `fromSymbolKey`, `toSymbolKey`, `toPath`, `resolved`,
`resolution`, `provenance`, and the byte range. **Target symbol keys are looked up
globally**, so a resolved cross-file call keeps its target identity.

### `searchRules(query)`

FTS5 query over rules; returns `{ name, sourcePath, body, contentSha }` ordered by
source path then name.

### `getTestMappings(filter)`

`filter`: `{ path?, testName? }`. Returns `TestMappingView[]` unioned from two
**explicitly-labeled** provenance sources, deterministically ordered:

| `provenance` | Meaning |
|--------------|---------|
| `coverage-input` | A test→file mapping reported by raw coverage JSON. `path` filters the covered file. |
| `import-graph` | A test file that structurally imports the indexed source file in the pinned commit. `path` filters the imported target. |

`indexed` reports whether the mapped source path exists in this index.

> **Limitation:** an `import-graph` row is an import fact, not proof the test
> executes the target, and neither source is a complete test mapping. An absent
> caller/test edge **never** proves a symbol unused or removable, and incomplete
> parser/graph data can never become a high-confidence automatic removal.

---

## Edge resolution

Resolution is deterministic and every resolved edge records how:

| `resolution` | Rule |
|--------------|------|
| `specifier-path` | Import edge: relative/rooted specifier mapped onto an indexed file path. Bare package specifiers stay external. |
| `import-alias` | Call/reference whose name is a local import binding (default/named/aliased) resolves to the imported symbol in the imported file. Preserves cross-file target identity through aliases. |
| `name-match` | Otherwise, a **unique** exact-name match against all indexed symbols. |
| `none` | Ambiguous, dynamic (e.g. member calls on unknown objects) or absent: stays `resolved: 0`. The honest "unknown" state. |

## Test relationships

`test_mappings` is derived data rebuilt from scratch on every indexing run: a test
file (path under `tests/`, `__tests__/`, or matching `*.test.*` / `*.spec.*`) that
imports an indexed source file. It is provenance-tagged `import-graph` and is not a
claim of test coverage.
