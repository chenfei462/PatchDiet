import type { EvidenceRecord } from "../../evidence/src/index.js";

import type { AtomClassification, AtomExplanation, ExplainFilter, ScopeReport } from "./types.js";

function resolveEvidence(report: ScopeReport, ids: readonly string[]): EvidenceRecord[] {
  const byId = new Map(report.evidence.map((record) => [record.id, record]));
  const resolved: EvidenceRecord[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (record) {
      resolved.push(record);
    }
  }
  return resolved;
}

/**
 * Explain a single atom from a Scope Map report.
 *
 * Read-only evidence retrieval: it resolves the atom's contributing and
 * counter evidence from the report and never re-runs analysis, the filesystem
 * or the oracle. A missing atom id is reported safely (`found: false` plus a
 * message) rather than throwing.
 */
export function explainAtom(atomId: string, report: ScopeReport): AtomExplanation {
  const classification = report.atoms.find((atom) => atom.atomId === atomId);
  if (!classification) {
    return {
      schemaVersion: "patchdiet-explain/1",
      atomId,
      found: false,
      evidence: [],
      counterEvidence: [],
      risks: [],
      message: `no atom with id "${atomId}" in this scope report`,
      readOnly: true
    };
  }
  return {
    schemaVersion: "patchdiet-explain/1",
    atomId,
    found: true,
    classification,
    evidence: resolveEvidence(report, classification.evidenceIds),
    counterEvidence: resolveEvidence(report, classification.counterEvidenceIds),
    risks: classification.risks,
    message: classification.explanation,
    readOnly: true
  };
}

/** Explain every atom matching a file/symbol filter (or all atoms). */
export function explainAtoms(filter: ExplainFilter, report: ScopeReport): AtomExplanation[] {
  const matches = report.atoms.filter((atom) => atomMatchesFilter(atom, filter));
  return matches.map((atom) => explainAtom(atom.atomId, report));
}

function atomMatchesFilter(atom: AtomClassification, filter: ExplainFilter): boolean {
  if (filter.atomId && atom.atomId !== filter.atomId) {
    return false;
  }
  if (filter.file) {
    const file = filter.file.replaceAll("\\", "/").toLowerCase();
    const path = atom.filePath.replaceAll("\\", "/").toLowerCase();
    if (!(path === file || path.endsWith(`/${file}`))) {
      return false;
    }
  }
  if (filter.symbol) {
    const symbol = filter.symbol.toLowerCase();
    const atomSymbol = atom.symbolPath?.toLowerCase() ?? "";
    if (!(atomSymbol === symbol || atomSymbol.endsWith(`.${symbol}`) || atomSymbol.endsWith(`::${symbol}`))) {
      return false;
    }
  }
  return true;
}
