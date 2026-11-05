import { createHash } from "node:crypto";

/**
 * Stable, deterministic, content-addressed identifiers.
 *
 * The same logical input always yields the same id, and ids never depend on
 * iteration order, wall-clock time or randomness. This is what lets the Scope
 * Engine report the same atom/statement id across runs and lets a reviewer
 * correlate an explanation with a prior report.
 */

/** Short hex digest (first 10 hex chars) of a namespaced content string. */
export function stableDigest(namespace: string, ...parts: string[]): string {
  const hash = createHash("sha256");
  hash.update(namespace);
  for (const part of parts) {
    // Length-prefix each part so ["ab","c"] and ["a","bc"] cannot collide.
    hash.update(`\u0000${part.length}:${part}`);
  }
  return hash.digest("hex").slice(0, 10);
}

/** A requirement/constraint/acceptance/must-preserve statement id. */
export function statementId(kind: string, sourceId: string, text: string, occurrence = 0): string {
  const prefix = kind === "requirement" ? "req" : kind === "constraint" ? "con" : kind === "must_preserve" ? "keep" : "acc";
  return `${prefix}-${stableDigest("intent-statement", kind, sourceId, text, String(occurrence))}`;
}

/** A stable id for a source document. */
export function sourceDocumentId(kind: string, id: string): string {
  return `${kind}-${stableDigest("intent-source", kind, id)}`;
}

/** A stable id for a change atom derived from its identity facts. */
export function atomId(atom: {
  filePath: string;
  symbolPath?: string;
  hunkHeader?: string;
  contentHash?: string;
  index?: number;
}): string {
  if (atom.contentHash) {
    return `atom-${stableDigest("change-atom", atom.filePath, atom.symbolPath ?? "", atom.contentHash)}`;
  }
  return `atom-${stableDigest(
    "change-atom",
    atom.filePath,
    atom.symbolPath ?? "",
    atom.hunkHeader ?? "",
    String(atom.index ?? 0)
  )}`;
}
