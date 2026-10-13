import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type {
  ParseDiagnostic,
  ParseMetadata,
  ParseResult,
  SemanticAtom,
  SemanticCall,
  SemanticImport,
  SemanticRange,
  SemanticReference,
  SemanticSymbol,
  SupportedLanguage,
} from "./types.js";

export * from "./types.js";

// ---------------------------------------------------------------------------
// tree-sitter WASM binding (loaded through createRequire so the resolved
// module lives next to the compiled dist output, not the workspace root).
// ---------------------------------------------------------------------------

interface TSPosition {
  row: number;
  column: number;
}

interface TSNode {
  /** Stable within one tree — node object identity is NOT stable across accesses. */
  id: number;
  type: string;
  startIndex: number; // UTF-16 code units — NOT bytes (see Utf8OffsetMapper)
  endIndex: number;
  startPosition: TSPosition;
  endPosition: TSPosition;
  text: string;
  namedChildren: TSNode[];
  previousSibling: TSNode | null;
  parent: TSNode | null;
  isMissing?: boolean;
  hasError?: boolean;
  childForFieldName(name: string): TSNode | null;
}

interface TSTree {
  rootNode: TSNode;
  delete(): void;
}

interface TSParser {
  setLanguage(language: unknown): void;
  parse(input: string): TSTree;
  delete(): void;
}

const require = createRequire(import.meta.url);

type TreeSitterModule = {
  Parser: (new () => TSParser) & { init(options?: unknown): Promise<void> };
  Language: { load(path: string): Promise<unknown> };
};

const treeSitter = require("@vscode/tree-sitter-wasm") as TreeSitterModule;

const GRAMMAR_FILES: Record<SupportedLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  jsx: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
};

const EXTENSION_LANGUAGES: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".pyi": "python",
};

export function detectLanguage(path: string): SupportedLanguage | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  return EXTENSION_LANGUAGES[path.slice(dot).toLowerCase()] ?? null;
}

export function supportedLanguages(): SupportedLanguage[] {
  return Object.keys(GRAMMAR_FILES) as SupportedLanguage[];
}

function wasmDir(): string {
  return join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
}

function parserPackageVersion(): string {
  return (require("@vscode/tree-sitter-wasm/package.json") as { version: string }).version;
}

type GrammarLoader = (grammar: SupportedLanguage) => Promise<unknown>;

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Promise<unknown>>();

let grammarLoaderOverride: GrammarLoader | undefined;

/** Test seam: overrides grammar loading (e.g. to simulate WASM failures). */
export function _setGrammarLoaderForTests(loader: GrammarLoader | undefined): void {
  grammarLoaderOverride = loader;
}

async function loadLanguage(language: SupportedLanguage): Promise<unknown> {
  let cached = languageCache.get(language);
  if (!cached) {
    cached = treeSitter.Language.load(join(wasmDir(), GRAMMAR_FILES[language]));
    languageCache.set(language, cached);
  }
  return cached;
}

async function ensureParserInit(): Promise<void> {
  if (!initPromise) {
    initPromise = treeSitter.Parser.init();
  }
  await initPromise;
}

// ---------------------------------------------------------------------------
// UTF-16 → UTF-8 byte conversion
// ---------------------------------------------------------------------------

/**
 * Tree-sitter (JavaScript binding) reports `startIndex`/`startPosition.column`
 * in UTF-16 code units. All exported ranges must be UTF-8 bytes, so every
 * position is converted through the per-line prefix byte length. Tests verify
 * this against Buffer-level byte slicing (never by renaming startIndex).
 */
class Utf8OffsetMapper {
  private readonly lines: string[];
  private readonly lineStartBytes: number[];

  constructor(text: string) {
    this.lines = text.split("\n");
    let byte = 0;
    this.lineStartBytes = this.lines.map((line) => {
      const start = byte;
      byte += Buffer.byteLength(line, "utf8") + 1; // +1 for the \n
      return start;
    });
  }

  position(pos: TSPosition): { byte: number; line: number; column: number } {
    const row = Math.min(pos.row, this.lines.length - 1);
    const line = this.lines[row];
    const column = Math.min(pos.column, line.length);
    const prefixBytes = Buffer.byteLength(line.slice(0, column), "utf8");
    return { byte: this.lineStartBytes[row] + prefixBytes, line: pos.row, column: prefixBytes };
  }

  range(start: TSPosition, end: TSPosition): SemanticRange {
    const s = this.position(start);
    const e = this.position(end);
    return {
      startByte: s.byte,
      endByte: e.byte,
      startLine: s.line,
      startColumn: s.column,
      endLine: e.line,
      endColumn: e.column,
    };
  }

  nodeRange(node: TSNode): SemanticRange {
    return this.range(node.startPosition, node.endPosition);
  }
}

function symbolId(path: string, kind: string, name: string, range: SemanticRange, text: string): string {
  return createHash("sha256")
    .update(
      [
        "semantic-symbol-v1",
        path,
        kind,
        name,
        String(range.startByte),
        String(range.endByte),
        createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
      ].join("\u0000"),
    )
    .digest("hex");
}

function edgeId(path: string, kind: string, name: string, range: SemanticRange): string {
  return createHash("sha256")
    .update(["semantic-edge-v1", path, kind, name, String(range.startByte), String(range.endByte)].join("\u0000"))
    .digest("hex");
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "");
}

function atomId(path: string, kind: string, range: SemanticRange): string {
  return createHash("sha256")
    .update(["semantic-atom-v1", path, kind, String(range.startByte), String(range.endByte)].join("\u0000"))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const MAX_REFERENCES = 10_000;
const MAX_DIAGNOSTICS = 50;

/** Statement-level node types eligible as safe AST atoms. */
const TSJS_ATOM_TYPES = new Set([
  "export_statement",
  "import_statement",
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "class",
  "abstract_class_declaration",
  "method_definition",
  "lexical_declaration",
  "variable_declaration",
  "expression_statement",
  "return_statement",
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "try_statement",
  "throw_statement",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
]);

const PYTHON_ATOM_TYPES = new Set([
  "decorated_definition",
  "function_definition",
  "class_definition",
  "import_statement",
  "import_from_statement",
  "expression_statement",
  "assignment",
  "return_statement",
  "if_statement",
  "for_statement",
  "while_statement",
  "with_statement",
  "try_statement",
  "raise_statement",
  "block",
]);

interface ExtractContext {
  path: string;
  mapper: Utf8OffsetMapper;
  symbols: SemanticSymbol[];
  imports: SemanticImport[];
  calls: SemanticCall[];
  references: SemanticReference[];
  atoms: SemanticAtom[];
  diagnostics: ParseDiagnostic[];
  referenceCount: number;
  truncatedReferences: boolean;
  /** Grammar node id (stable within the tree) → enclosing symbol id. */
  nodeToSymbol: Map<number, string>;
}

function addDiagnostic(ctx: ExtractContext, diagnostic: ParseDiagnostic): void {
  if (ctx.diagnostics.length < MAX_DIAGNOSTICS) {
    ctx.diagnostics.push(diagnostic);
  }
}

/**
 * Safe span for a declaration: include the enclosing export_statement (when
 * exported) and any preceding decorator siblings, so slicing the span keeps
 * valid syntax (export/decorator/statement syntax preserved).
 */
function spanNodeFor(node: TSNode, exported: boolean): TSNode {
  let spanNode = node;
  if (exported && node.parent) {
    // Climb variable/lexical declarations up to a possible export_statement.
    let ancestor = node.parent;
    while (ancestor.type === "lexical_declaration" || ancestor.type === "variable_declaration") {
      ancestor = ancestor.parent ?? ancestor;
    }
    if (ancestor.type === "export_statement") {
      spanNode = ancestor;
    }
  }
  let start = spanNode;
  while (start.previousSibling && start.previousSibling.type === "decorator") {
    start = start.previousSibling;
  }
  return start;
}

function addSymbol(
  ctx: ExtractContext,
  node: TSNode,
  name: string,
  kind: SemanticSymbol["kind"],
  parentId: string | null,
  exported: boolean,
  spanNodeOverride?: TSNode,
): SemanticSymbol {
  const range = ctx.mapper.nodeRange(node);
  const spanNode = spanNodeOverride ?? spanNodeFor(node, exported);
  const symbol: SemanticSymbol = {
    id: symbolId(ctx.path, kind, name, range, node.text),
    name,
    kind,
    parentId,
    range,
    span: ctx.mapper.range(spanNode.startPosition, spanNode.endPosition),
    exported,
  };
  ctx.symbols.push(symbol);
  ctx.nodeToSymbol.set(node.id, symbol.id);
  return symbol;
}

function extractImportsTSJS(ctx: ExtractContext, node: TSNode): void {
  const source = node.childForFieldName("source");
  const specifier = source ? stripQuotes(source.text) : "";
  if (!specifier) {
    return;
  }
  const range = ctx.mapper.nodeRange(node);
  const clause = node.namedChildren.find((c) => c.type === "import_clause") ?? null;
  if (!clause) {
    // side-effect import: import "./x";
    ctx.imports.push({
      id: edgeId(ctx.path, "import", specifier, range),
      moduleSpecifier: specifier,
      importedName: null,
      alias: null,
      range,
    });
    return;
  }
  const push = (importedName: string | null, alias: string | null) => {
    ctx.imports.push({
      id: edgeId(ctx.path, "import", `${specifier}:${importedName ?? "*"}:${alias ?? ""}`, range),
      moduleSpecifier: specifier,
      importedName,
      alias,
      range,
    });
  };
  for (const child of clause.namedChildren) {
    if (child.type === "identifier") {
      push(child.text, null); // default import
    } else if (child.type === "namespace_import") {
      push(null, null);
    } else if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        if (spec.type === "import_specifier") {
          const nameNode = spec.childForFieldName("name");
          const aliasNode = spec.childForFieldName("alias");
          push(nameNode?.text ?? null, aliasNode ? aliasNode.text : null);
        }
      }
    }
  }
}

function extractCall(
  ctx: ExtractContext,
  node: TSNode,
  calleeNode: TSNode | null,
  within: string | null,
): void {
  if (!calleeNode) {
    return;
  }
  const nameNode =
    calleeNode.type === "member_expression" ? calleeNode.childForFieldName("property") : calleeNode;
  if (!nameNode) {
    return;
  }
  const range = ctx.mapper.nodeRange(node);
  ctx.calls.push({
    id: edgeId(ctx.path, "call", nameNode.text, range),
    calleeName: nameNode.text,
    range,
    withinSymbolId: within,
  });
}

const DECLARATION_NAME_PARENTS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "class",
  "abstract_class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "variable_declarator",
  "function_definition",
  "class_definition",
]);

/** Same node within one tree (object identity is not stable across accesses). */
function isSameNode(a: TSNode | null | undefined, b: TSNode | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a.id === b.id;
}

/** Parameter binding positions: the name declares a local, it is not a reference. */
const PARAMETER_NAME_PARENTS = new Set([
  "required_parameter",
  "optional_parameter",
  "parameter",
  "default_parameter",
  "typed_parameter",
  "formal_parameters",
  "parameters",
]);

/**
 * Reference pass — runs EXACTLY ONCE over the tree from parseSource. Each
 * identifier is visited one time; the enclosing symbol id comes from the
 * nearest declaration node recorded in ctx.nodeToSymbol (walked via
 * currentWithin), and declaration/import/call-callee/member names are
 * filtered out.
 */
function collectReferences(ctx: ExtractContext, node: TSNode, within: string | null): void {
  if (ctx.truncatedReferences) {
    return;
  }
  const symbolHere = ctx.nodeToSymbol.get(node.id);
  const currentWithin = symbolHere ?? within;
  if (node.type === "identifier" && node.parent) {
    const parent = node.parent;
    const isDeclarationName =
      isSameNode(parent.childForFieldName("name"), node) && DECLARATION_NAME_PARENTS.has(parent.type);
    const inImport =
      parent.type === "import_specifier" ||
      parent.type === "namespace_import" ||
      parent.type === "named_imports" ||
      parent.type === "import_clause" ||
      parent.type === "import_statement" ||
      parent.type === "aliased_import" ||
      parent.type === "dotted_name" ||
      parent.type === "import_from_statement";
    const isCallCallee =
      parent.type === "call_expression" && isSameNode(parent.childForFieldName("function"), node);
    const isMemberProperty =
      parent.type === "member_expression" && isSameNode(parent.childForFieldName("property"), node);
    const isParameterName = PARAMETER_NAME_PARENTS.has(parent.type);
    if (
      !isDeclarationName &&
      !isParameterName &&
      !inImport &&
      !isCallCallee &&
      !isMemberProperty
    ) {
      if (ctx.referenceCount >= MAX_REFERENCES) {
        ctx.truncatedReferences = true;
        return;
      }
      ctx.references.push({
        id: edgeId(ctx.path, "reference", node.text, ctx.mapper.nodeRange(node)),
        name: node.text,
        range: ctx.mapper.nodeRange(node),
        withinSymbolId: currentWithin,
      });
      ctx.referenceCount += 1;
      return;
    }
  }
  for (const child of node.namedChildren) {
    collectReferences(ctx, child, currentWithin);
  }
}

/** Safe AST atoms: statement-level nodes with parent links (one pass). */
function collectAtoms(
  ctx: ExtractContext,
  node: TSNode,
  parentAtomId: string | null,
  python: boolean,
): void {
  const atomTypes = python ? PYTHON_ATOM_TYPES : TSJS_ATOM_TYPES;
  for (const child of node.namedChildren) {
    let currentParent = parentAtomId;
    if (child.type === "decorated_definition" && python) {
      // A decorated definition is ONE atom including its decorators; do not
      // also emit the inner def/class as a separate nested atom.
      const range = ctx.mapper.nodeRange(child);
      const atom: SemanticAtom = {
        id: atomId(ctx.path, child.type, range),
        kind: child.type,
        range,
        parentId: parentAtomId,
      };
      ctx.atoms.push(atom);
      continue;
    }
    if (atomTypes.has(child.type)) {
      const range = ctx.mapper.nodeRange(child);
      const atom: SemanticAtom = {
        id: atomId(ctx.path, child.type, range),
        kind: child.type,
        range,
        parentId: parentAtomId,
      };
      ctx.atoms.push(atom);
      currentParent = atom.id;
    }
    collectAtoms(ctx, child, currentParent, python);
  }
}

function walkTSJS(ctx: ExtractContext, node: TSNode, parentId: string | null, exported: boolean): void {
  for (const child of node.namedChildren) {
    switch (child.type) {
      case "export_statement": {
        walkTSJS(ctx, child, parentId, true);
        break;
      }
      case "function_declaration":
      case "generator_function_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          const symbol = addSymbol(ctx, child, name, "function", parentId, exported);
          walkTSJS(ctx, child, symbol.id, false);
        } else {
          walkTSJS(ctx, child, parentId, false);
        }
        break;
      }
      case "class_declaration":
      case "class":
      case "abstract_class_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          const symbol = addSymbol(ctx, child, name, "class", parentId, exported);
          walkTSJS(ctx, child, symbol.id, false);
        } else {
          walkTSJS(ctx, child, parentId, false);
        }
        break;
      }
      case "method_definition": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          const symbol = addSymbol(ctx, child, name, "method", parentId, false);
          walkTSJS(ctx, child, symbol.id, false);
        } else {
          walkTSJS(ctx, child, parentId, false);
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const declarator of child.namedChildren) {
          if (declarator.type !== "variable_declarator") {
            continue;
          }
          const name = declarator.childForFieldName("name")?.text;
          if (!name) {
            continue;
          }
          const value = declarator.childForFieldName("value");
          const kind: SemanticSymbol["kind"] =
            value && (value.type === "class" || value.type === "class_expression")
              ? "class"
              : value && (value.type === "arrow_function" || value.type.startsWith("function"))
                ? "function"
                : "variable";
          const symbol = addSymbol(ctx, declarator, name, kind, parentId, exported);
          walkTSJS(ctx, declarator, symbol.id, false);
        }
        break;
      }
      case "interface_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          addSymbol(ctx, child, name, "interface", parentId, exported);
        }
        walkTSJS(ctx, child, parentId, false);
        break;
      }
      case "type_alias_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          addSymbol(ctx, child, name, "type", parentId, exported);
        }
        walkTSJS(ctx, child, parentId, false);
        break;
      }
      case "enum_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) {
          addSymbol(ctx, child, name, "enum", parentId, exported);
        }
        walkTSJS(ctx, child, parentId, false);
        break;
      }
      case "import_statement": {
        extractImportsTSJS(ctx, child);
        break;
      }
      case "call_expression": {
        extractCall(ctx, child, child.childForFieldName("function"), parentId);
        walkTSJS(ctx, child, parentId, false);
        break;
      }
      case "new_expression": {
        extractCall(ctx, child, child.childForFieldName("constructor"), parentId);
        walkTSJS(ctx, child, parentId, false);
        break;
      }
      default: {
        walkTSJS(ctx, child, parentId, false);
        break;
      }
    }
  }
}

function isInsidePythonClassBody(node: TSNode): boolean {
  let p = node.parent;
  if (p?.type === "decorated_definition") {
    p = p.parent;
  }
  if (p?.type === "block") {
    p = p.parent;
  }
  return p?.type === "class_definition";
}

function extractImportsPython(ctx: ExtractContext, node: TSNode): void {
  const range = ctx.mapper.nodeRange(node);
  if (node.type === "import_statement") {
    for (const child of node.namedChildren) {
      if (child.type === "dotted_name" || child.type === "identifier") {
        ctx.imports.push({
          id: edgeId(ctx.path, "import", child.text, range),
          moduleSpecifier: child.text,
          importedName: null,
          alias: null,
          range,
        });
      } else if (child.type === "aliased_import") {
        const name = child.childForFieldName("name")?.text ?? null;
        const alias = child.childForFieldName("alias")?.text ?? null;
        ctx.imports.push({
          id: edgeId(ctx.path, "import", `${name}:${alias ?? ""}`, range),
          moduleSpecifier: name ?? "",
          importedName: null,
          alias,
          range,
        });
      }
    }
    return;
  }
  // import_from_statement: names are the named children other than the
  // module_name node itself (the `import` keyword is unnamed).
  const moduleName = node.childForFieldName("module_name")?.text ?? "";
  const moduleNode = node.childForFieldName("module_name");
  for (const child of node.namedChildren) {
    if (child === moduleNode) {
      continue;
    }
    if (child.type === "dotted_name" || child.type === "identifier") {
      ctx.imports.push({
        id: edgeId(ctx.path, "import", `${moduleName}:${child.text}`, range),
        moduleSpecifier: moduleName,
        importedName: child.text,
        alias: null,
        range,
      });
    } else if (child.type === "aliased_import") {
      const name = child.childForFieldName("name")?.text ?? null;
      const alias = child.childForFieldName("alias")?.text ?? null;
      ctx.imports.push({
        id: edgeId(ctx.path, "import", `${moduleName}:${name}:${alias ?? ""}`, range),
        moduleSpecifier: moduleName,
        importedName: name,
        alias,
        range,
      });
    } else if (child.type === "wildcard_import") {
      ctx.imports.push({
        id: edgeId(ctx.path, "import", `${moduleName}:*`, range),
        moduleSpecifier: moduleName,
        importedName: null,
        alias: null,
        range,
      });
    }
  }
}

function walkPython(
  ctx: ExtractContext,
  node: TSNode,
  parentId: string | null,
  parentClassId: string | null,
): void {
  for (const child of node.namedChildren) {
    if (child.type === "decorated_definition") {
      const inner = child.namedChildren.find(
        (n) => n.type === "function_definition" || n.type === "class_definition",
      );
      if (inner) {
        const name = inner.childForFieldName("name")?.text;
        if (name) {
          if (inner.type === "class_definition") {
            // The span starts at the decorator (the decorated_definition node).
            const symbol = addSymbol(ctx, inner, name, "class", parentId, false, child);
            walkPython(ctx, inner, symbol.id, symbol.id);
          } else {
            const insideClass = isInsidePythonClassBody(inner);
            const symbol = addSymbol(
              ctx,
              inner,
              name,
              insideClass && parentClassId ? "method" : "function",
              insideClass ? (parentClassId ?? parentId) : parentId,
              false,
              child,
            );
            walkPython(ctx, inner, symbol.id, insideClass ? symbol.id : parentClassId);
          }
          continue;
        }
      }
      walkPython(ctx, child, parentId, parentClassId);
      continue;
    }
    if (child.type === "function_definition") {
      const name = child.childForFieldName("name")?.text;
      if (name) {
        // A function directly inside a class body is a method.
        const insideClass = child.parent?.type === "block" && child.parent?.parent?.type === "class_definition";
        const symbol = addSymbol(
          ctx,
          child,
          name,
          insideClass && parentClassId ? "method" : "function",
          insideClass ? (parentClassId ?? parentId) : parentId,
          false,
        );
        walkPython(ctx, child, symbol.id, insideClass ? symbol.id : parentClassId);
        continue;
      }
    }
    if (child.type === "class_definition") {
      const name = child.childForFieldName("name")?.text;
      if (name) {
        const symbol = addSymbol(ctx, child, name, "class", parentId, false);
        walkPython(ctx, child, symbol.id, symbol.id);
        continue;
      }
    }
    if (child.type === "import_statement" || child.type === "import_from_statement") {
      extractImportsPython(ctx, child);
      continue;
    }
    if (child.type === "call") {
      extractCall(ctx, child, child.childForFieldName("function"), parentId);
      walkPython(ctx, child, parentId, parentClassId);
      continue;
    }
    walkPython(ctx, child, parentId, parentClassId);
  }
}

/** All children (named and unnamed), needed to reach ERROR/MISSING nodes. */
function allChildren(node: TSNode): TSNode[] {
  const withAll = node as TSNode & { children?: TSNode[] };
  return withAll.children ?? node.namedChildren;
}

function collectDiagnostics(ctx: ExtractContext, root: TSNode): void {
  const visit = (node: TSNode): void => {
    if (ctx.diagnostics.length >= MAX_DIAGNOSTICS) {
      return;
    }
    if (node.type === "ERROR") {
      addDiagnostic(ctx, {
        code: "parse-error",
        message: `unexpected syntax: ${node.text.slice(0, 80) || "(empty)"}`,
        range: ctx.mapper.nodeRange(node),
      });
    } else if (node.isMissing) {
      addDiagnostic(ctx, {
        code: "parse-error",
        message: `missing ${node.type}`,
        range: ctx.mapper.nodeRange(node),
      });
    }
    for (const child of allChildren(node)) {
      visit(child);
    }
  };
  visit(root);
}

function buildMetadata(language: SupportedLanguage | null, text: string): ParseMetadata {
  return {
    parser: "tree-sitter",
    grammar: language ?? "none",
    grammarWasm: language ? GRAMMAR_FILES[language] : "",
    parserPackageVersion: parserPackageVersion(),
    textLengthChars: text.length,
    textLengthBytes: Buffer.byteLength(text, "utf8"),
    sourceUnits: { bytes: "utf8-offset", lines: "0-based", columns: "utf8-byte" },
  };
}

/**
 * Explicit incomplete result for source bytes that are not valid UTF-8. The
 * bytes must NEVER be replacement-decoded and indexed as if they were valid
 * text: the file is reported complete=false with an `invalid-encoding`
 * diagnostic and no fabricated symbols/edges.
 */
export function invalidEncodingResult(
  path: string,
  reason: string,
  byteLength: number,
): ParseResult {
  const language = detectLanguage(path);
  const metadata = buildMetadata(language, "");
  metadata.textLengthChars = 0;
  metadata.textLengthBytes = byteLength;
  return {
    path,
    language,
    complete: false,
    symbols: [],
    imports: [],
    calls: [],
    references: [],
    atoms: [],
    diagnostics: [
      {
        code: "invalid-encoding",
        message: `source is not valid UTF-8 (${reason}); refusing to index replacement-decoded text`,
        range: null,
      },
    ],
    metadata,
    limitations: [
      "source bytes are not valid UTF-8: the file is recorded as an explicit incomplete entry with no extracted structure",
    ],
  };
}

function emptyResult(
  path: string,
  language: SupportedLanguage | null,
  text: string,
  diagnostics: ParseDiagnostic[],
): ParseResult {
  return {
    path,
    language,
    complete: false,
    symbols: [],
    imports: [],
    calls: [],
    references: [],
    atoms: [],
    diagnostics,
    metadata: buildMetadata(language, text),
    limitations: [],
  };
}

export async function parseSource(path: string, text: string): Promise<ParseResult> {
  const language = detectLanguage(path);
  if (!language) {
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "(none)";
    return emptyResult(path, null, text, [
      {
        code: "unsupported-language",
        message: `unsupported file extension '${ext}'; supported: ${supportedLanguages().join(", ")}`,
        range: null,
      },
    ]);
  }

  try {
    await ensureParserInit();
  } catch (error) {
    return emptyResult(path, language, text, [
      {
        code: "parser-init-failed",
        message: `tree-sitter WASM init failed: ${(error as Error).message}`,
        range: null,
      },
    ]);
  }

  let languageHandle: unknown;
  try {
    languageHandle = grammarLoaderOverride ? await grammarLoaderOverride(language) : await loadLanguage(language);
  } catch (error) {
    return emptyResult(path, language, text, [
      {
        code: "grammar-load-failed",
        message: `failed to load grammar for ${language}: ${(error as Error).message}`,
        range: null,
      },
    ]);
  }

  const parser = new treeSitter.Parser();
  let tree: TSTree | null = null;
  try {
    parser.setLanguage(languageHandle);
    tree = parser.parse(text);
    const root = tree.rootNode;
    const mapper = new Utf8OffsetMapper(text);
    const ctx: ExtractContext = {
      path,
      mapper,
      symbols: [],
      imports: [],
      calls: [],
      references: [],
      atoms: [],
      diagnostics: [],
      referenceCount: 0,
      truncatedReferences: false,
      nodeToSymbol: new Map(),
    };

    const python = language === "python";
    if (python) {
      walkPython(ctx, root, null, null);
    } else {
      walkTSJS(ctx, root, null, false);
    }
    collectAtoms(ctx, root, null, python);
    collectReferences(ctx, root, null);

    if (root.hasError) {
      collectDiagnostics(ctx, root);
    }
    if (ctx.truncatedReferences) {
      addDiagnostic(ctx, {
        code: "extraction-truncated",
        message: `reference extraction truncated at ${MAX_REFERENCES} entries`,
        range: null,
      });
    }

    const complete = !root.hasError && !ctx.truncatedReferences;
    const limitations = [
      "symbols/imports/calls are per-file AST facts; cross-file binding is NOT resolved here",
      "call and reference names are recorded as names, not resolved targets",
    ];
    if (ctx.truncatedReferences) {
      limitations.push(
        `reference extraction truncated at ${MAX_REFERENCES} entries: the collected references are partial`,
      );
    }
    if (!complete) {
      limitations.push(
        "parse errors present: extracted structure is partial and MUST NOT be treated as a complete graph",
      );
    }

    return {
      path,
      language,
      complete,
      symbols: ctx.symbols,
      imports: ctx.imports,
      calls: ctx.calls,
      references: ctx.references,
      atoms: ctx.atoms,
      diagnostics: ctx.diagnostics,
      metadata: buildMetadata(language, text),
      limitations,
    };
  } finally {
    // Release WASM handles: no node/tree objects are kept in stored results.
    if (tree) {
      tree.delete();
    }
    parser.delete();
  }
}
