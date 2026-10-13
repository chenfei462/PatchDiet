import type { EvidenceRecord } from "../../evidence/src/index.js";

import { SCOPE_STATES, RISK_FLAGS, type AtomClassification, type AtomExplanation, type ScopeReport, type ScopeState } from "./types.js";

/**
 * Render a Scope Map as deterministic Markdown. Output depends only on the
 * report content: no timestamps, no iteration-order dependence, no randomness.
 */
export function renderScopeMarkdown(report: ScopeReport): string {
  const lines: string[] = [];
  lines.push("# PatchDiet Scope Map");
  lines.push("");
  lines.push("## Task");
  lines.push("");
  lines.push(`Goal: ${escapeText(report.intent.goal || "(no goal supplied)")}`);
  lines.push(`Intent confidence: ${report.intent.confidence}`);
  lines.push(`Intent sources: ${report.intent.sourceIds.map(escapeText).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| State | Atoms |");
  lines.push("| --- | ---: |");
  for (const state of SCOPE_STATES) {
    lines.push(`| ${state} | ${report.summary[state]} |`);
  }
  lines.push(`| flagged (any risk) | ${report.summary.flagged} |`);
  lines.push("");
  lines.push("## Atoms");
  lines.push("");

  for (const atom of report.atoms) {
    lines.push(`### ${escapeText(atomLabel(atom))}`);
    lines.push("");
    lines.push(`State: ${atom.state.toUpperCase()}`);
    lines.push("");
    lines.push(escapeText(atom.explanation));
    lines.push("");
    const contributing = report.evidence.filter((record) => atom.evidenceIds.includes(record.id));
    if (contributing.length > 0) {
      lines.push("Evidence:");
      for (const record of contributing) {
        lines.push(`- [${record.category}/${record.polarity}] ${escapeText(record.detail)}`);
      }
      lines.push("");
    }
    const counter = report.evidence.filter((record) => atom.counterEvidenceIds.includes(record.id));
    if (counter.length > 0) {
      lines.push("Counter-evidence:");
      for (const record of counter) {
        lines.push(`- [${record.category}/${record.polarity}] ${escapeText(record.detail)}`);
      }
      lines.push("");
    }
    if (atom.missingInputs.length > 0) {
      lines.push("Missing inputs:");
      for (const missing of atom.missingInputs) {
        lines.push(`- ${escapeText(missing)}`);
      }
      lines.push("");
    }
    if (atom.risks.length > 0) {
      lines.push("Risk flags (orthogonal to scope state):");
      for (const risk of atom.risks) {
        lines.push(`- ${risk.flag}: ${escapeText(risk.detail)}`);
      }
      lines.push("");
    }
  }

  if (report.graphDiagnostics.length > 0) {
    lines.push("## Graph diagnostics");
    lines.push("");
    for (const diagnostic of report.graphDiagnostics) {
      lines.push(`- ${escapeText(diagnostic)}`);
    }
    lines.push("");
  }

  lines.push("## Limits");
  lines.push("");
  for (const limit of report.limits) {
    lines.push(`- ${escapeText(limit)}`);
  }
  lines.push("");
  lines.push(`Analysis: ${report.analysisId} (read-only; no oracle executed)`);
  lines.push("");
  return lines.join("\n");
}

/** Render a single atom explanation as deterministic Markdown. */
export function renderExplanationMarkdown(explanation: AtomExplanation): string {
  const lines: string[] = [];
  lines.push("# PatchDiet Evidence Report");
  lines.push("");
  if (!explanation.found) {
    lines.push(escapeText(explanation.message));
    lines.push("");
    return lines.join("\n");
  }
  const classification = explanation.classification as AtomClassification;
  lines.push(`Atom: ${escapeText(atomLabel(classification))}`);
  lines.push("");
  lines.push(`Scope state: ${classification.state.toUpperCase()}`);
  lines.push(`Removal eligible: ${classification.removalEligible ? "yes (still requires runtime oracle)" : "no"}`);
  lines.push(`Runtime oracle required: yes`);
  lines.push("");
  lines.push(escapeText(classification.explanation));
  lines.push("");
  if (explanation.evidence.length > 0) {
    lines.push("## Evidence");
    lines.push("");
    for (const record of explanation.evidence) {
      lines.push(`- [${record.category}/${record.polarity}] ${escapeText(record.detail)}`);
      if (record.limits && record.limits.length > 0) {
        for (const limit of record.limits) {
          lines.push(`  - limit: ${escapeText(limit)}`);
        }
      }
    }
    lines.push("");
  }
  if (explanation.counterEvidence.length > 0) {
    lines.push("## Counter-evidence");
    lines.push("");
    for (const record of explanation.counterEvidence) {
      lines.push(`- [${record.category}/${record.polarity}] ${escapeText(record.detail)}`);
    }
    lines.push("");
  }
  if (classification.missingInputs.length > 0) {
    lines.push("## Missing inputs");
    lines.push("");
    for (const missing of classification.missingInputs) {
      lines.push(`- ${escapeText(missing)}`);
    }
    lines.push("");
  }
  if (explanation.risks.length > 0) {
    lines.push("## Risks (orthogonal to scope state)");
    lines.push("");
    for (const risk of explanation.risks) {
      lines.push(`- ${risk.flag}: ${escapeText(risk.detail)}`);
    }
    lines.push("");
  }
  lines.push("## Limitation");
  lines.push("");
  lines.push("Passing the configured checks does not prove semantic equivalence outside behaviours exercised or encoded by those checks.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Render the canonical JSON form of a report. Keys are emitted in a stable
 * order (via a sorted replacer) so byte-identical inputs give byte-identical
 * output.
 */
export function renderScopeJson(report: ScopeReport): string {
  return stableStringify(report);
}

function atomLabel(atom: Pick<AtomClassification, "filePath" | "symbolPath">): string {
  return atom.symbolPath ? `${atom.filePath}::${atom.symbolPath}` : atom.filePath;
}

/** Deterministic JSON with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}

function escapeText(value: string): string {
  return value
    .replaceAll(/\r\n?/g, " ")
    .replaceAll(/[\u0000-\u0008\u000a-\u001f\u007f]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "\\<");
}

export { SCOPE_STATES, RISK_FLAGS };
export type { ScopeState, EvidenceRecord };
