/**
 * Semantic parse result types.
 *
 * RANGE UNITS (documented contract, enforced by tests):
 * - `startByte` / `endByte`: UTF-8 byte offsets into the UTF-8 encoding of the
 *   whole source text. NOT UTF-16 string indices: tree-sitter's `startIndex`
 *   counts UTF-16 code units, which diverges as soon as the source contains
 *   non-BMP or multi-byte characters (see docs/semantic-index.md).
 * - `startLine` / `endLine`: 0-based line numbers; a line break is `\n`
 *   (a `\r` before it is part of the preceding line's content bytes).
 * - `startColumn` / `endColumn`: 0-based UTF-8 BYTE columns within the line
 *   (not UTF-16 columns, not code points).
 *
 * `span` is the "safe structural atom" range: the same structure as `range`
 * but expanded so that slicing the span out of the source keeps the syntax
 * valid — export/default/declare modifiers and decorators are included.
 */

export type SupportedLanguage = "typescript" | "tsx" | "javascript" | "jsx" | "python";

export interface SemanticRange {
  startByte: number;
  endByte: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type SymbolKind = "function" | "class" | "method" | "variable" | "type" | "interface" | "enum";

export interface SemanticSymbol {
  /** Deterministic across reparses of identical content; changes when content changes. */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Id of the enclosing symbol (class for methods, function for nested functions), or null. */
  parentId: string | null;
  range: SemanticRange;
  span: SemanticRange;
  exported: boolean;
}

/**
 * Serializable "safe AST atom": a complete statement/import/export/type/
 * method/block node (never a bare expression fragment) with byte-exact
 * ranges. Atoms are the units the later sub-hunk reducer consumes; slicing a
 * source at atom boundaries keeps the syntax valid. Decorators and
 * export/declare modifiers are part of the atom they precede (via the
 * enclosing statement node). `parentId` links nested statement atoms to
 * their enclosing statement atom, or null at the top level.
 */
export interface SemanticAtom {
  id: string;
  /** Grammar node type, e.g. "export_statement", "decorated_definition", "return_statement". */
  kind: string;
  range: SemanticRange;
  parentId: string | null;
}

export interface SemanticImport {
  id: string;
  moduleSpecifier: string;
  /** Named import's original name; null for side-effect or namespace imports. */
  importedName: string | null;
  /** Local alias; null when imported under its original name. */
  alias: string | null;
  range: SemanticRange;
}

export interface SemanticCall {
  id: string;
  /** Callee identifier name; for member calls, the property name. */
  calleeName: string;
  range: SemanticRange;
  /** Id of the enclosing symbol, or null for module-level calls. */
  withinSymbolId: string | null;
}

export interface SemanticReference {
  id: string;
  name: string;
  range: SemanticRange;
  withinSymbolId: string | null;
}

export type DiagnosticCode =
  | "parse-error"
  | "unsupported-language"
  | "grammar-load-failed"
  | "parser-init-failed"
  | "extraction-truncated"
  | "invalid-encoding";

export interface ParseDiagnostic {
  code: DiagnosticCode;
  message: string;
  range: SemanticRange | null;
}

export interface ParseMetadata {
  parser: "tree-sitter";
  grammar: string;
  grammarWasm: string;
  parserPackageVersion: string;
  textLengthChars: number;
  textLengthBytes: number;
  sourceUnits: {
    bytes: "utf8-offset";
    lines: "0-based";
    columns: "utf8-byte";
  };
}

export interface ParseResult {
  path: string;
  /** null when the language is unsupported — never a fabricated default. */
  language: SupportedLanguage | null;
  /**
   * True only when the grammar loaded, parsed without ERROR/MISSING nodes and
   * extraction ran to completion. Anything else must be false with a
   * diagnostic explaining why — a fallback is never advertised as complete.
   */
  complete: boolean;
  symbols: SemanticSymbol[];
  imports: SemanticImport[];
  calls: SemanticCall[];
  references: SemanticReference[];
  atoms: SemanticAtom[];
  diagnostics: ParseDiagnostic[];
  metadata: ParseMetadata;
  limitations: string[];
}
