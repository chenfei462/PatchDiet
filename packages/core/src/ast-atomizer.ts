import { createHash } from "node:crypto";

import { mapHunkCoordinates, type HunkCoordinates, type SelectiveEdit } from "./patch-encoder.js";
import type { ParseResult } from "../../parsers/src/index.js";

// ── Public types ──────────────────────────────────────────────────

/**
 * One atom-level paired edit: a byte range in the pinned BASE blob that is
 * replaced by the paired byte range in the pinned HEAD blob. Dropping the edit
 * reverts exactly that AST-level change; keeping it reproduces HEAD.
 *
 * `baseStartByte`/`baseEndByte` are UTF-8 byte offsets into the BASE text
 * (zero-width when the edit is a pure insertion); the head pair is the same
 * into the HEAD text (zero-width for a pure deletion). Ranges never overlap
 * within one file on either side, and the full edit set applied to BASE
 * reproduces HEAD byte-for-byte (validated by the patch encoder).
 */
export interface AtomEdit extends SelectiveEdit {
  filePath: string;
  /** Statement-level tree-sitter node kinds backing this edit. */
  baseKind?: string;
  headKind?: string;
  /** Enclosing symbol name chain (dot-qualified), for grouping and scope. */
  symbolName?: string;
  /** Enclosing symbol key in the HEAD tree, when the edit lives inside one. */
  headSymbolId?: string;
  /** True when the HEAD-side statement was also present, unchanged, in BASE. */
  unchangedInBase?: boolean;
  /** Stable, human-readable description used in reports. */
  detail: string;
}

export interface AtomizeFileResult {
  path: string;
  edits: AtomEdit[];
  /**
   * True when AST refinement was not possible and the file fell back to
   * coarser whole-change-unit edits (parse failure, unsupported structure).
   * Callers must surface this; it is a conservative downgrade, never a silent one.
   */
  fallback: boolean;
  diagnostics: string[];
}

// ── Change units from the unified diff ────────────────────────────

interface ChangeUnit {
  /** 0-based [start, end) base line range (empty for pure insertions). */
  baseStartLine: number;
  baseEndLine: number;
  /** 0-based [start, end) head line range (empty for pure deletions). */
  headStartLine: number;
  headEndLine: number;
}

/**
 * Walk hunk coordinate lines and collect maximal (delete-run + optional
 * following insert-run) units. Context lines separate units; a hunk like
 * `-a +b +c -d +e` yields units (a|b,c) and (d|e).
 */
export function changeUnitsFromHunks(hunks: HunkCoordinates[]): ChangeUnit[] {
  const units: ChangeUnit[] = [];
  for (const hunk of hunks) {
    // Git zero-count semantics: `@@ -N,0` inserts AFTER base line N and
    // `@@ +M,0` deletes after head line M, so the cursor starts at line index
    // N (0-based start of the NEXT line), not N-1.
    let baseCursor = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart > 0 ? hunk.oldStart - 1 : 0;
    let headCursor = hunk.newCount === 0 ? hunk.newStart : hunk.newStart > 0 ? hunk.newStart - 1 : 0;
    let baseStart = -1;
    let baseEnd = -1;
    let headStart = -1;
    const closeUnit = (): void => {
      if (baseStart >= 0 || headStart >= 0) {
        units.push({
          baseStartLine: baseStart >= 0 ? baseStart : baseCursor,
          baseEndLine: baseStart >= 0 ? baseEnd : baseCursor,
          headStartLine: headStart >= 0 ? headStart : headCursor,
          headEndLine: headStart >= 0 ? headCursor : headCursor
        });
      }
      baseStart = -1;
      baseEnd = -1;
      headStart = -1;
    };
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        closeUnit();
        baseCursor += 1;
        headCursor += 1;
      } else if (line.kind === "delete") {
        if (baseStart < 0) baseStart = baseCursor;
        baseEnd = baseCursor + 1;
        baseCursor += 1;
      } else {
        if (headStart < 0) headStart = headCursor;
        headCursor += 1;
      }
    }
    closeUnit();
  }
  return units;
}

// ── Line/byte offset maps ─────────────────────────────────────────

/** Byte offset of the start of every line (line i starts at offsets[i]). */
function lineStartBytes(text: string): number[] {
  const bytes = Buffer.from(text, "utf8");
  const starts: number[] = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineRangeBytes(text: string, starts: number[], startLine: number, endLine: number): { start: number; end: number } {
  const start = starts[Math.min(startLine, starts.length - 1)] ?? Buffer.byteLength(text, "utf8");
  const end = endLine <= startLine
    ? start
    : starts[Math.min(endLine, starts.length - 1)] ?? Buffer.byteLength(text, "utf8");
  return { start, end: Math.min(end, Buffer.byteLength(text, "utf8")) };
}

// ── Safe-cell extraction ──────────────────────────────────────────

interface SafeNode {
  start: number;
  end: number;
  kind: string;
  name?: string;
  symbolId?: string;
  /** Qualified enclosing symbol chain, dot-joined. */
  symbolName?: string;
}

function collectSafeNodes(parse: ParseResult): SafeNode[] {
  const nodes: SafeNode[] = [];
  const symbolsById = new Map(parse.symbols.map((symbol) => [symbol.id, symbol]));

  const qualifiedName = (symbolId: string | null): { name?: string; id?: string } => {
    if (!symbolId) return {};
    const chain: string[] = [];
    let current = symbolsById.get(symbolId);
    let id: string | undefined;
    while (current) {
      chain.unshift(current.name);
      id ??= current.id;
      current = current.parentId ? symbolsById.get(current.parentId) : undefined;
    }
    return chain.length > 0 ? { name: chain.join("."), id } : {};
  };

  for (const atom of parse.atoms) {
    nodes.push({ start: atom.range.startByte, end: atom.range.endByte, kind: atom.kind });
  }
  for (const symbol of parse.symbols) {
    // The symbol span includes export/decorator trivia: safe slicing boundary.
    nodes.push({
      start: symbol.span.startByte,
      end: symbol.span.endByte,
      kind: symbol.kind,
      ...qualifiedName(symbol.parentId ? symbol.parentId : symbol.id)
    });
    // Attach the symbol's own id/name for nodes inside it via containment later.
  }
  // Annotate each node with the smallest enclosing symbol's qualified name.
  const symbolsSorted = [...parse.symbols].sort((a, b) =>
    (b.span.endByte - b.span.startByte) - (a.span.endByte - a.span.startByte)
  );
  for (const node of nodes) {
    const enclosing = symbolsSorted.find(
      (symbol) => symbol.span.startByte <= node.start && node.end <= symbol.span.endByte
    );
    if (enclosing) {
      const chain: string[] = [];
      let current: typeof enclosing | undefined = enclosing;
      while (current) {
        chain.unshift(current.name);
        current = current.parentId ? symbolsById.get(current.parentId) : undefined;
      }
      node.symbolName = chain.join(".");
      node.symbolId = enclosing.id;
    }
  }
  return nodes.sort((a, b) => a.start - b.start || a.end - b.end);
}

const WHITESPACE_RE = /^[\s]*$/;

/**
 * Tile `range` with safe-node cells: cell_i = [prevEnd, node_i.end], the first
 * cell starts at `range.start` and the last extends to `range.end` when the
 * remainder is whitespace-only. Returns undefined when the interval cannot be
 * tiled safely (non-whitespace content outside chosen nodes, nested overlaps).
 */
function tileWithSafeNodes(
  text: string,
  bytes: Buffer,
  range: { start: number; end: number },
  nodes: SafeNode[]
): { start: number; end: number; node?: SafeNode }[] | undefined {
  if (range.end < range.start) {
    return undefined;
  }
  if (range.end === range.start) {
    return [{ start: range.start, end: range.end }];
  }
  const contained = nodes.filter(
    (node) => node.start >= range.start && node.end <= range.end && node.end > node.start
  );
  if (contained.length === 0) {
    return undefined;
  }
  // Reject overlaps among contained nodes (keep the outermost only).
  const ordered: SafeNode[] = [];
  for (const node of contained) {
    const last = ordered[ordered.length - 1];
    if (last && node.start < last.end) {
      continue; // nested inside the previous outer node — skip inner duplicate
    }
    ordered.push(node);
  }
  const cells: { start: number; end: number; node?: SafeNode }[] = [];
  let cursor = range.start;
  for (const node of ordered) {
    cells.push({ start: cursor, end: node.end, node });
    cursor = node.end;
  }
  if (cursor < range.end) {
    const tail = bytes.subarray(cursor, range.end);
    if (!WHITESPACE_RE.test(tail.toString("utf8"))) {
      return undefined; // non-whitespace content is not covered by safe nodes
    }
    cells[cells.length - 1]!.end = range.end;
  }
  return cells;
}

// ── Alignment ─────────────────────────────────────────────────────

function normalizeCell(text: string, bytes: Buffer, cell: { start: number; end: number }): string {
  return bytes.subarray(cell.start, cell.end).toString("utf8").trim().replace(/\s+/g, " ");
}

interface AlignmentOp {
  type: "match" | "insert" | "delete";
  baseCell?: { start: number; end: number; node?: SafeNode };
  headCell?: { start: number; end: number; node?: SafeNode };
}

/**
 * Order-preserving alignment of base cells to head cells. Text-equal cells
 * score 2; same-statement-kind cells score 1. Implemented as a simple
 * longest-common-subsequence dynamic program — deterministic for a given
 * input, no randomness.
 */
function alignCells(
  baseText: string,
  baseBytes: Buffer,
  headText: string,
  headBytes: Buffer,
  baseCells: { start: number; end: number; node?: SafeNode }[],
  headCells: { start: number; end: number; node?: SafeNode }[]
): AlignmentOp[] {
  const n = baseCells.length;
  const m = headCells.length;
  const score = (i: number, j: number): number => {
    const b = normalizeCell(baseText, baseBytes, baseCells[i]!);
    const h = normalizeCell(headText, headBytes, headCells[j]!);
    if (b.length > 0 && b === h) return 2;
    const bk = baseCells[i]!.node?.kind;
    const hk = headCells[j]!.node?.kind;
    if (bk && hk && bk === hk) return 1;
    return Number.NEGATIVE_INFINITY;
  };
  // dp[i][j] = best score aligning baseCells[i..] with headCells[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const s = score(i, j);
      const take = s === Number.NEGATIVE_INFINITY ? Number.NEGATIVE_INFINITY : s + dp[i + 1]![j + 1]!;
      dp[i]![j] = Math.max(dp[i + 1]![j], dp[i]![j + 1], take);
    }
  }
  const ops: AlignmentOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = score(i, j);
    const take = s === Number.NEGATIVE_INFINITY ? Number.NEGATIVE_INFINITY : s + dp[i + 1]![j + 1]!;
    if (take !== Number.NEGATIVE_INFINITY && take === dp[i]![j]) {
      ops.push({ type: "match", baseCell: baseCells[i], headCell: headCells[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j] >= dp[i]![j + 1]) {
      ops.push({ type: "delete", baseCell: baseCells[i] });
      i += 1;
    } else {
      ops.push({ type: "insert", headCell: headCells[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", baseCell: baseCells[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "insert", headCell: headCells[j] });
    j += 1;
  }
  return ops;
}

// ── Edit construction ─────────────────────────────────────────────

function editId(path: string, edit: Omit<AtomEdit, "id" | "filePath" | "detail">, detail: string): string {
  return createHash("sha256")
    .update([
      "patchdiet-atom-edit-v1",
      path,
      String(edit.baseStartByte),
      String(edit.baseEndByte),
      String(edit.headStartByte),
      String(edit.headEndByte),
      detail
    ].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Turn one change unit into paired AtomEdits.
 *
 * When both parses are complete, the unit's two sides are tiled with
 * statement-level safe nodes and aligned; unmatched sides become pure
 * insert/delete edits. When tiling or parsing is not possible, the whole unit
 * is one edit (conservative, explicitly flagged via `fallback`).
 */
function editsForUnit(params: {
  unit: ChangeUnit;
  baseText: string;
  headText: string;
  baseBytes: Buffer;
  headBytes: Buffer;
  baseStarts: number[];
  headStarts: number[];
  baseNodes: SafeNode[];
  headNodes: SafeNode[];
}): { edits: Omit<AtomEdit, "id" | "filePath" | "detail">[]; details: string[]; fallback: boolean } {
  const { unit, baseText, headText, baseBytes, headBytes, baseStarts, headStarts, baseNodes, headNodes } = params;
  const baseRange = lineRangeBytes(baseText, baseStarts, unit.baseStartLine, unit.baseEndLine);
  const headRange = lineRangeBytes(headText, headStarts, unit.headStartLine, unit.headEndLine);

  const fallbackUnit = (): Omit<AtomEdit, "id" | "filePath" | "detail"> => ({
    baseStartByte: baseRange.start,
    baseEndByte: baseRange.end,
    headStartByte: headRange.start,
    headEndByte: headRange.end
  });

  // Pure insertion / deletion: tile only the non-empty side.
  if (baseRange.start === baseRange.end || headRange.start === headRange.end) {
    const inserting = baseRange.start === baseRange.end;
    const nonEmptyText = inserting ? headText : baseText;
    const nonEmptyBytes = inserting ? headBytes : baseBytes;
    const nonEmptyNodes = inserting ? headNodes : baseNodes;
    const starts = inserting ? headStarts : baseStarts;
    const range = inserting ? headRange : baseRange;
    // Only refine statement-backed regions; single anonymous fragments stay
    // one coarse (explicitly flagged) edit.
    const cells = tileWithSafeNodes(nonEmptyText, nonEmptyBytes, range, nonEmptyNodes);
    if (!cells || cells.length <= 1) {
      return { edits: [fallbackUnit()], details: [inserting ? "insert block" : "delete block"], fallback: true };
    }
    const edits: Omit<AtomEdit, "id" | "filePath" | "detail">[] = [];
    const details: string[] = [];
    for (const cell of cells) {
      if (cell.node === undefined) {
        return { edits: [fallbackUnit()], details: [inserting ? "insert block" : "delete block"], fallback: true };
      }
      edits.push(
        inserting
          ? { baseStartByte: baseRange.start, baseEndByte: baseRange.start, headStartByte: cell.start, headEndByte: cell.end }
          : { baseStartByte: cell.start, baseEndByte: cell.end, headStartByte: headRange.start, headEndByte: headRange.start }
      );
      details.push(
        `${inserting ? "insert" : "delete"} ${cell.node.kind}${cell.node.symbolName ? ` in ${cell.node.symbolName}` : ""}`
      );
    }
    return { edits, details, fallback: false };
  }

  // Replacement: tile both sides and align.
  const baseCells = tileWithSafeNodes(baseText, baseBytes, baseRange, baseNodes);
  const headCells = tileWithSafeNodes(headText, headBytes, headRange, headNodes);
  if (!baseCells || !headCells) {
    return { edits: [fallbackUnit()], details: ["replace block (untiled)"], fallback: true };
  }
  if (baseCells.length === 1 && headCells.length === 1) {
    return {
      edits: [{ baseStartByte: baseRange.start, baseEndByte: baseRange.end, headStartByte: headRange.start, headEndByte: headRange.end }],
      details: [`replace ${baseCells[0]!.node?.kind ?? "block"} -> ${headCells[0]!.node?.kind ?? "block"}`],
      fallback: false
    };
  }

  const ops = alignCells(baseText, baseBytes, headText, headBytes, baseCells, headCells);
  // First pass: build edits in op order; zero-width sides are placeholders
  // filled by the ordered second pass (inserts take the running base cursor,
  // deletes the running head cursor), which yields non-overlapping,
  // exact-apply ranges on both sides.
  const edits: Omit<AtomEdit, "id" | "filePath" | "detail">[] = [];
  const details: string[] = [];
  for (const op of ops) {
    if (op.type === "match") {
      edits.push({
        baseStartByte: op.baseCell!.start,
        baseEndByte: op.baseCell!.end,
        headStartByte: op.headCell!.start,
        headEndByte: op.headCell!.end
      });
      details.push(
        `replace ${op.baseCell!.node?.kind ?? "fragment"}${op.baseCell!.node?.symbolName ? ` in ${op.baseCell!.node.symbolName}` : ""}`
      );
    } else if (op.type === "delete") {
      edits.push({
        baseStartByte: op.baseCell!.start,
        baseEndByte: op.baseCell!.end,
        headStartByte: 0,
        headEndByte: 0
      });
      details.push(
        `delete ${op.baseCell!.node?.kind ?? "fragment"}${op.baseCell!.node?.symbolName ? ` in ${op.baseCell!.node.symbolName}` : ""}`
      );
    } else {
      edits.push({
        baseStartByte: 0,
        baseEndByte: 0,
        headStartByte: op.headCell!.start,
        headEndByte: op.headCell!.end
      });
      details.push(`insert ${op.headCell!.node?.kind ?? "fragment"}${op.headCell!.node?.symbolName ? ` in ${op.headCell!.node.symbolName}` : ""}`);
    }
  }
  let baseCursor = baseRange.start;
  let headCursor = headRange.start;
  const positioned: Omit<AtomEdit, "id" | "filePath" | "detail">[] = [];
  for (const [index, edit] of edits.entries()) {
    const op = ops[index]!;
    if (op.type === "insert") {
      positioned.push({ ...edit, baseStartByte: baseCursor, baseEndByte: baseCursor });
    } else if (op.type === "delete") {
      positioned.push({ ...edit, headStartByte: headCursor, headEndByte: headCursor });
    } else {
      positioned.push(edit);
    }
    if (op.baseCell) baseCursor = op.baseCell.end;
    if (op.headCell) headCursor = op.headCell.end;
  }
  return { edits: positioned, details, fallback: false };
}

// ── Entry point ───────────────────────────────────────────────────

/**
 * Atomize one file's diff into paired AST-level edits.
 *
 * Requirements enforced here:
 * - Both BASE and HEAD parse results must be `complete`; otherwise the file
 *   falls back explicitly (caller routes it to the hunk path).
 * - Edits never overlap on either side and the full set applies BASE -> HEAD
 *   exactly (the patch encoder re-validates this and throws otherwise).
 * - Trivia, indentation, CRLF, BOM and no-newline bytes are preserved: all
 *   offsets are UTF-8 byte offsets into the decoded blob text and untouched
 *   bytes are never included in any edit range.
 */
export async function atomizeFileEdits(params: {
  path: string;
  baseText: string;
  headText: string;
  baseParse: ParseResult;
  headParse: ParseResult;
  filePatch: string;
}): Promise<AtomizeFileResult> {
  const { path, baseText, headText, baseParse, headParse, filePatch } = params;
  const diagnostics: string[] = [];

  if (!baseParse.complete || !headParse.complete) {
    return {
      path,
      edits: [],
      fallback: true,
      diagnostics: [
        ...baseParse.diagnostics.filter((d) => d.code === "parse-error").map((d) => `base: ${d.message}`),
        ...headParse.diagnostics.filter((d) => d.code === "parse-error").map((d) => `head: ${d.message}`)
      ]
    };
  }

  let hunks: HunkCoordinates[];
  try {
    hunks = mapHunkCoordinates(filePatch);
  } catch (error) {
    return {
      path,
      edits: [],
      fallback: true,
      diagnostics: [`hunk coordinate mapping failed: ${(error as Error).message}`]
    };
  }
  const units = changeUnitsFromHunks(hunks);
  if (units.length === 0) {
    return { path, edits: [], fallback: true, diagnostics: ["no change units found in the file patch"] };
  }

  const baseBytes = Buffer.from(baseText, "utf8");
  const headBytes = Buffer.from(headText, "utf8");
  const baseStarts = lineStartBytes(baseText);
  const headStarts = lineStartBytes(headText);
  const baseNodes = collectSafeNodes(baseParse);
  const headNodes = collectSafeNodes(headParse);

  const edits: AtomEdit[] = [];
  let fallback = false;
  for (const unit of units) {
    const result = editsForUnit({
      unit,
      baseText,
      headText,
      baseBytes,
      headBytes,
      baseStarts,
      headStarts,
      baseNodes,
      headNodes
    });
    if (result.fallback) {
      fallback = true;
    }
    for (const [index, edit] of result.edits.entries()) {
      const detail = result.details[index] ?? "change";
      edits.push({
        ...edit,
        id: `atom-${editId(path, edit, detail)}`,
        filePath: path,
        detail
      });
    }
  }

  // Structural identity: mark edits whose HEAD content already exists in BASE
  // (moved/duplicated code) — grouping and scope treat these conservatively.
  for (const edit of edits) {
    const headCell = headBytes.subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
    if (headCell.trim().length === 0) {
      edit.unchangedInBase = false;
      continue;
    }
    edit.unchangedInBase = baseText.includes(headCell.trim());
    const headNode = headNodes.find(
      (node) => node.start <= edit.headStartByte && edit.headEndByte <= node.end && node.symbolName
    );
    if (headNode?.symbolName) {
      edit.symbolName = headNode.symbolName;
      edit.headSymbolId = headNode.symbolId;
    }
    // The statement's own kind must come from the SMALLEST overlapping node:
    // cells include leading indentation (and statements sit inside enclosing
    // symbols), so strict containment would report the parent function's kind
    // and hide the statement kind that scope exclusions depend on.
    let headKindNode: SafeNode | undefined;
    for (const node of headNodes) {
      const overlapStart = Math.max(node.start, edit.headStartByte);
      const overlapEnd = Math.min(node.end, edit.headEndByte);
      if (overlapEnd <= overlapStart) continue;
      if (
        headKindNode === undefined ||
        node.end - node.start <= headKindNode.end - headKindNode.start
      ) {
        // `<=` breaks same-size ties toward the inner node (e.g. Python's
        // `assignment` inside its wrapping `expression_statement`), which is
        // the specific statement kind scope exclusions reason about.
        headKindNode = node;
      }
    }
    if (headKindNode) {
      edit.headKind = headKindNode.kind;
    }
  }

  return { path, edits, fallback, diagnostics };
}
