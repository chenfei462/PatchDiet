import { createHash } from "node:crypto";

/** Deterministic evidence record id. */
export function evidenceId(category: string, sourceId: string, detail: string, atomId?: string): string {
  const hash = createHash("sha256");
  hash.update("evidence");
  for (const part of [category, sourceId, atomId ?? "", detail]) {
    hash.update(`\u0000${part.length}:${part}`);
  }
  return `ev-${hash.digest("hex").slice(0, 10)}`;
}

/** Deterministic rule id. */
export function ruleId(path: string, kind: string, text: string): string {
  const hash = createHash("sha256");
  hash.update("rule");
  for (const part of [path, kind, text]) {
    hash.update(`\u0000${part.length}:${part}`);
  }
  return `rule-${hash.digest("hex").slice(0, 10)}`;
}
