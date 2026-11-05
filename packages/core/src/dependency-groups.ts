import { createHash } from "node:crypto";

import type { AtomEdit } from "./ast-atomizer.js";
import type { ReductionGroup } from "./reducer.js";
import type { ParseResult } from "../../parsers/src/index.js";

// ── Public types ──────────────────────────────────────────────────

/** Why two atom edits were coalesced into one reduction group. */
export type DependencyReason =
  | "same-symbol"
  | "local-def-use"
  | "import-use"
  | "call-reference"
  | "test-fixture"
  | "strongly-connected";

export interface AtomDependencyEdge {
  fromEditId: string;
  toEditId: string;
  reason: DependencyReason;
  /** Human-readable, deterministic justification shown in reports. */
  detail: string;
}

export interface AtomGroup {
  id: string;
  memberIds: string[];
  reasons: DependencyReason[];
  /** Deterministic explanation of why these members belong together. */
  details: string[];
}

// ── Edge derivation ───────────────────────────────────────────────

export interface AtomParseFacts {
  /** path -> HEAD parse result for every atomized (changed) file. */
  parses: Map<string, ParseResult>;
  /** path -> HEAD text, used for reference scoping. */
  headTexts: Map<string, string>;
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$/.test(path);
}

function isPythonPath(path: string): boolean {
  return /\.py$/i.test(path);
}

/** Names an import statement edit introduces, under their LOCAL binding. */
function importEditLocalNames(parse: ParseResult, edit: AtomEdit): string[] {
  const names = new Set<string>();
  for (const imp of parse.imports) {
    // Only imports whose span overlaps THIS edit.
    if (imp.range.endByte <= edit.headStartByte || imp.range.startByte >= edit.headEndByte) {
      continue;
    }
    if (imp.alias) {
      names.add(imp.alias);
    } else if (imp.importedName) {
      names.add(imp.importedName);
    } else {
      // Default / namespace / side-effect imports bind the module basename.
      const base = imp.moduleSpecifier.split("/").pop() ?? imp.moduleSpecifier;
      names.add(base.replace(/\.[cm]?[jt]sx?$/, ""));
    }
  }
  return [...names];
}

/**
 * Names actually referenced or called by AST nodes INSIDE the edit's head
 * byte range. This is real AST evidence with a resolved position — not a
 * text search across a file.
 */
function namesUsedInEdit(parse: ParseResult, edit: AtomEdit): Set<string> {
  const used = new Set<string>();
  const inside = (start: number, end: number): boolean =>
    start >= edit.headStartByte && end <= edit.headEndByte && end > start;
  for (const reference of parse.references) {
    if (inside(reference.range.startByte, reference.range.endByte)) used.add(reference.name);
  }
  for (const call of parse.calls) {
    if (inside(call.range.startByte, call.range.endByte)) used.add(call.calleeName);
  }
  return used;
}

/** Names the edit's own content DECLARES (symbol starts inside its range). */
function namesDeclaredInEdit(parse: ParseResult, edit: AtomEdit): Set<string> {
  const declared = new Set<string>();
  // A symbol declared entirely inside this edit (function/class definitions).
  for (const symbol of parse.symbols) {
    if (symbol.span.startByte >= edit.headStartByte && symbol.span.startByte < edit.headEndByte) {
      declared.add(symbol.name);
    }
  }
  return declared;
}

/**
 * Lexical declaration names in the edit's own slice. Scoped to the edit's
 * byte range on purpose: a `const x = ...` statement is evidence that THIS
 * edit binds `x`; the USE side is always an actual AST reference node.
 */
function lexicalDeclarations(slice: string, filePath: string): string[] {
  const names: string[] = [];
  if (isPythonPath(filePath)) {
    for (const match of slice.matchAll(/^[ \t]*([A-Za-z_]\w*)\s*=(?!=)/gm)) {
      names.push(match[1]!);
    }
  } else {
    for (const match of slice.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      names.push(match[1]!);
    }
  }
  return names;
}

/**
 * Derive dependency edges between atom edits from real AST facts:
 *
 * - `local-def-use`: one edit declares a local binding (symbol start or
 *   lexical declaration inside its byte range) and a sibling edit in the same
 *   file and same enclosing symbol contains an actual reference/call node of
 *   that name. Sharing a changed symbol alone is NOT an edge.
 * - `import-use`: an import statement edit and edits containing real
 *   reference/call nodes of the imported name under its local alias.
 * - `call-reference`: an edit whose symbol is called or referenced by a
 *   reference/call node inside another changed file's edit.
 * - `test-fixture`: a test-file edit that contains a real reference/call of
 *   the source symbol, or imports the module the source edit belongs to.
 *
 * No edge is invented from filename conventions or file-wide name mentions:
 * every edge cites the declaration/import/call position that binds it. When
 * a parse is truncated or incomplete, absence of edges must NOT be trusted —
 * callers must surface that via graph completeness, not here.
 */
export function deriveAtomEdges(edits: AtomEdit[], facts: AtomParseFacts): AtomDependencyEdge[] {
  const edges: AtomDependencyEdge[] = [];

  const sliceOf = (edit: AtomEdit): string => {
    const text = facts.headTexts.get(edit.filePath);
    if (text === undefined) return "";
    return Buffer.from(text, "utf8").subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
  };
  const parseOf = (edit: AtomEdit): ParseResult | undefined => facts.parses.get(edit.filePath);

  // Per-edit AST usage/declaration facts.
  const usedBy = new Map<string, Set<string>>();
  const declaredBy = new Map<string, Set<string>>();
  for (const edit of edits) {
    const parse = parseOf(edit);
    if (parse) {
      usedBy.set(edit.id, namesUsedInEdit(parse, edit));
      const declared = namesDeclaredInEdit(parse, edit);
      for (const name of lexicalDeclarations(sliceOf(edit), edit.filePath)) {
        declared.add(name);
      }
      declaredBy.set(edit.id, declared);
    } else {
      usedBy.set(edit.id, new Set());
      declaredBy.set(edit.id, new Set());
    }
  }

  // 1. local-def-use: same file AND same enclosing symbol scope; one edit
  //    declares, the other contains the actual use. Module-level edits
  //    (no symbolName) only bind to other module-level edits.
  const byFileSymbol = new Map<string, AtomEdit[]>();
  for (const edit of edits) {
    const key = `${edit.filePath}\u0000${edit.symbolName ?? ""}`;
    const list = byFileSymbol.get(key) ?? [];
    list.push(edit);
    byFileSymbol.set(key, list);
  }
  for (const edit of edits) {
    const used = usedBy.get(edit.id)!;
    if (used.size === 0) continue;
    const siblings = (byFileSymbol.get(`${edit.filePath}\u0000${edit.symbolName ?? ""}`) ?? []).filter(
      (candidate) => candidate.id !== edit.id
    );
    for (const sibling of siblings) {
      const declared = declaredBy.get(sibling.id)!;
      const bound = [...used].filter((name) => declared.has(name)).sort();
      if (bound.length === 0) continue;
      edges.push({
        fromEditId: sibling.id,
        toEditId: edit.id,
        reason: "local-def-use",
        detail:
          `${edit.filePath}: ${edit.detail} uses local ${bound.join(", ")}` +
          ` declared by ${sibling.detail}`
      });
    }
  }

  // 2. import-use: an import statement edit paired with edits containing a
  //    real reference/call node of the imported name (alias-resolved).
  const importEdits = edits.filter(
    (edit) => edit.headKind === "import_statement" || edit.headKind === "import_from_statement"
  );
  for (const importEdit of importEdits) {
    const parse = parseOf(importEdit);
    if (!parse) continue;
    const names = importEditLocalNames(parse, importEdit);
    if (names.length === 0) continue;
    for (const other of edits) {
      if (other.id === importEdit.id) continue;
      if (other.filePath === importEdit.filePath && other.headKind === importEdit.headKind) {
        continue; // another import statement, not a use
      }
      const used = usedBy.get(other.id)!;
      const bound = names.filter((name) => used.has(name)).sort();
      if (bound.length === 0) continue;
      edges.push({
        fromEditId: importEdit.id,
        toEditId: other.id,
        reason: "import-use",
        detail: `${other.filePath} uses ${bound.join(", ")} imported by ${importEdit.filePath}`
      });
    }
  }

  // 3. call-reference: an edit whose symbol is used by an actual
  //    reference/call node inside another changed file's edit.
  const symbolEdits = edits.filter((edit) => edit.symbolName);
  for (const source of symbolEdits) {
    const localName = source.symbolName!.split(".").pop()!;
    for (const other of edits) {
      if (other.id === source.id || other.filePath === source.filePath) continue;
      const used = usedBy.get(other.id)!;
      if (!used.has(localName)) continue;
      edges.push({
        fromEditId: source.id,
        toEditId: other.id,
        reason: "call-reference",
        detail: `${other.filePath} calls/references ${localName} changed in ${source.filePath}`
      });
    }
  }

  // 4. test-fixture: a test edit exercises a source symbol ONLY with real
  //    evidence: a reference/call node of the symbol inside the test edit,
  //    or an import of the source module overlapping the test edit.
  const testEdits = edits.filter((edit) => isTestPath(edit.filePath));
  for (const testEdit of testEdits) {
    const testParse = parseOf(testEdit);
    const used = usedBy.get(testEdit.id)!;
    const importedSpecifiers = new Set<string>();
    if (testParse) {
      for (const imp of testParse.imports) {
        if (imp.range.endByte <= testEdit.headStartByte || imp.range.startByte >= testEdit.headEndByte) {
          continue;
        }
        importedSpecifiers.add(imp.moduleSpecifier);
      }
    }
    for (const source of symbolEdits) {
      if (source.filePath === testEdit.filePath) continue;
      if (isTestPath(source.filePath)) continue;
      const localName = source.symbolName!.split(".").pop()!;
      const sourceBase = source.filePath.split("/").pop() ?? source.filePath;
      const moduleBase = sourceBase.replace(/\.[cm]?[jt]sx?$/, "");
      const usesSymbol = used.has(localName);
      const importsModule = [...importedSpecifiers].some(
        (specifier) => specifier.endsWith(`/${moduleBase}`) || specifier === moduleBase
      );
      if (!usesSymbol && !importsModule) continue;
      edges.push({
        fromEditId: testEdit.id,
        toEditId: source.id,
        reason: "test-fixture",
        detail:
          `test edit ${testEdit.filePath} exercises ${source.symbolName} in ${source.filePath}` +
          (usesSymbol ? ` (reference of ${localName})` : ` (imports ${moduleBase})`)
      });
    }
  }

  return edges;
}

// ── Grouping ──────────────────────────────────────────────────────

/**
 * Coalesce atom edits into reduction groups.
 *
 * Union-find merges ONLY edits connected by derived edges (local-def-use,
 * import-use, call-reference, test-fixture); edits that merely share a
 * changed symbol or file stay independently removable. Cycles collapse into
 * one strongly-connected group.
 */
export function buildDependencyGroups(edits: AtomEdit[], edges: AtomDependencyEdge[]): AtomGroup[] {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = x;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? ra : rb, ra < rb ? rb : ra);
  };
  for (const edit of edits) parent.set(edit.id, edit.id);

  for (const edge of edges) {
    if (byId.has(edge.fromEditId) && byId.has(edge.toEditId)) {
      union(edge.fromEditId, edge.toEditId);
    }
  }

  // Collect groups with deterministic ids and reason lists.
  const membersByRoot = new Map<string, string[]>();
  for (const edit of edits) {
    const root = find(edit.id);
    const list = membersByRoot.get(root) ?? [];
    list.push(edit.id);
    membersByRoot.set(root, list);
  }
  const edgesByRoot = new Map<string, AtomDependencyEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.fromEditId) || !byId.has(edge.toEditId)) continue;
    const root = find(edge.fromEditId);
    const list = edgesByRoot.get(root) ?? [];
    list.push(edge);
    edgesByRoot.set(root, list);
  }

  const groups: AtomGroup[] = [];
  for (const [root, memberIds] of membersByRoot) {
    const sortedMembers = [...memberIds].sort();
    const groupEdges = (edgesByRoot.get(root) ?? []).sort((a, b) =>
      a.fromEditId < b.fromEditId ? -1 : a.fromEditId > b.fromEditId ? 1 : a.toEditId < b.toEditId ? -1 : 1
    );
    const reasons = [...new Set(groupEdges.map((edge) => edge.reason))].sort();
    const id = `grp-${createHash("sha256").update(sortedMembers.join("\u0000")).digest("hex").slice(0, 12)}`;
    groups.push({
      id,
      memberIds: sortedMembers,
      reasons,
      details: groupEdges.map((edge) => `${edge.reason}: ${edge.detail}`)
    });
  }
  return groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Resolve the removed edit-id set for a ddmin selection against the ACTUAL
 * group list currently being searched. Unknown group ids fail closed — a
 * coarse map must never silently turn a selection into an empty (trivially
 * passing) removal set.
 */
export function removedIdsForGroups(
  selectedIds: readonly string[],
  groups: readonly { id: string; memberIds: string[] }[]
): Set<string> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const removed = new Set<string>();
  for (const groupId of selectedIds) {
    const group = byId.get(groupId);
    if (!group) {
      throw new Error(`removedIdsForGroups: unknown group id '${groupId}'`);
    }
    for (const memberId of group.memberIds) removed.add(memberId);
  }
  return removed;
}

/** Convert atom groups into reducer groups (content hashes cover member edits). */
export function toReductionGroups(groups: AtomGroup[], edits: AtomEdit[]): ReductionGroup[] {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  return groups.map((group) => {
    const hash = createHash("sha256");
    for (const memberId of group.memberIds) {
      const edit = byId.get(memberId);
      if (!edit) continue;
      hash.update(memberId);
      hash.update(String(edit.baseStartByte));
      hash.update(String(edit.baseEndByte));
      hash.update(String(edit.headStartByte));
      hash.update(String(edit.headEndByte));
    }
    return { id: group.id, contentHash: hash.digest("hex"), memberIds: group.memberIds };
  });
}
