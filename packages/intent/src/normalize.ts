import { z } from "zod";

import { statementId } from "./ids.js";
import { findSpan } from "./spans.js";
import {
  EXPLICIT_SOURCE_KINDS,
  SOURCE_PRECEDENCE,
  type IntentConflict,
  type IntentConfidence,
  type IntentDiagnostic,
  type IntentMention,
  type IntentSourceDocument,
  type IntentSourceKind,
  type IntentSourceRef,
  type IntentStatement,
  type NormalizeIntentOptions,
  type NormalizedIntent,
  IntentValidationError
} from "./types.js";

// ── Strict validation of raw inputs ───────────────────────────────

/**
 * A structured agent plan. Deliberately strict: unknown keys are rejected and
 * every list must be a list of non-empty strings, so a malformed plan fails
 * loudly instead of being silently reinterpreted.
 */
const AgentPlanSchema = z.strictObject({
  goal: z.string().min(1).optional(),
  requirements: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  must_preserve: z.array(z.string().min(1)).optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  mentioned_paths: z.array(z.string().min(1)).optional(),
  mentioned_symbols: z.array(z.string().min(1)).optional()
});

type AgentPlan = z.infer<typeof AgentPlanSchema>;

const SourceDocumentSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["cli", "task_file", "agent_plan", "pr", "issue", "commit"]),
  text: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  plan: z.unknown().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  order: z.number().int().optional()
});

// ── Deterministic extraction helpers ──────────────────────────────

/** Split prose into candidate statement lines without inventing text. */
function proseSegments(text: string): { text: string; index: number }[] {
  const segments: { text: string; index: number }[] = [];
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (const rawLine of lines) {
    const lineStart = offset;
    offset += rawLine.length + 1; // +1 for the newline that split consumed
    const trimmed = rawLine.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    // Split every sentence of the line so multi-sentence tasks keep each
    // statement (requirement AND exclusion) individually addressable.
    const sentenceRe = /[^.!?。！？]*[.!?。！？]+["')\]]?\s*|[^.!?。！?。]+$/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceRe.exec(trimmed)) !== null) {
      const candidate = match[0].trim();
      if (candidate.length === 0) {
        continue;
      }
      const index = trimmed.indexOf(candidate, match.index);
      if (index === -1) {
        continue;
      }
      segments.push({ text: candidate, index: lineStart + index });
      if (sentenceRe.lastIndex === match.index) {
        sentenceRe.lastIndex += 1; // zero-width guard
      }
    }
  }
  return segments;
}

const PATH_LIKE = /(?:[\w.@-]+\/)+[\w.@-]+|[\w.-]+\.(?:ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|cs|php|swift|kt|json|yaml|yml|md|toml|lock|sql|sh)/g;

function extractPathLike(text: string): string[] {
  const matches = text.match(PATH_LIKE);
  if (!matches) {
    return [];
  }
  return [...new Set(matches)];
}

function extractSymbolLike(text: string): string[] {
  // Backticked identifiers and `pkg::symbol` / `Class.method` forms.
  const matches = text.match(/`[A-Za-z_][\w.]*`|\b[A-Za-z_]\w*::[A-Za-z_]\w*|\b[A-Z][A-Za-z0-9]*\.[a-z_]\w*/g);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.map((m) => m.replaceAll("`", "")))];
}

interface RawStatement {
  text: string;
  index: number;
}

/** Serialize a validated plan to searchable text so statements have real spans. */
function serializePlanText(plan: AgentPlan | undefined): string {
  if (!plan) {
    return "";
  }
  const lines: string[] = [];
  if (plan.goal) {
    lines.push(plan.goal);
  }
  for (const item of plan.requirements ?? []) {
    lines.push(item);
  }
  for (const item of plan.constraints ?? []) {
    lines.push(item);
  }
  for (const item of plan.must_preserve ?? []) {
    lines.push(item);
  }
  for (const item of plan.acceptance_criteria ?? []) {
    lines.push(item);
  }
  return lines.join("\n");
}

function makeStatement(
  kind: "requirement" | "constraint" | "must_preserve" | "acceptance",
  raw: RawStatement,
  source: { id: string; kind: IntentSourceKind; path?: string; priority: number },
  documentText: string,
  occurrence: number
): IntentStatement | undefined {
  const span = findSpan(documentText, raw.text, raw.index);
  if (!span) {
    // Never fabricate a statement that is not literally present in the source.
    return undefined;
  }
  const idKind = kind === "acceptance" ? "acceptance" : kind;
  return {
    id: statementId(idKind, source.id, raw.text, occurrence),
    text: raw.text,
    sourceId: source.id,
    sourceKind: source.kind,
    path: source.path,
    span,
    excerpt: raw.text,
    priority: source.priority
  };
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Normalize one or more serializable intent documents into a deterministic,
 * provenance-preserving intent object.
 *
 * Precedence (highest first): explicit `cli`/`task_file` → `agent_plan` →
 * `pr` → `issue` → `commit`. A higher-precedence source's goal always wins, but
 * every lower-precedence source is retained on the result and any goal that was
 * shadowed is reported as a conflict diagnostic rather than dropped.
 *
 * No network, filesystem or model call happens here. `llm: "auto"` is recorded
 * as requested but never performed, because an LLM judgement alone must never
 * authorise removal.
 */
export function normalizeIntent(
  documents: IntentSourceDocument[],
  options: NormalizeIntentOptions = {}
): NormalizedIntent {
  if (!Array.isArray(documents)) {
    throw new IntentValidationError("intent sources must be an array");
  }

  const validated: IntentSourceDocument[] = documents.map((doc, i) => {
    const parsed = SourceDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
      throw new IntentValidationError(`invalid intent source at index ${i}`, issues);
    }
    if (parsed.data.kind === "agent_plan") {
      const plan = AgentPlanSchema.safeParse(parsed.data.plan ?? {});
      if (!plan.success) {
        const issues = plan.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
        throw new IntentValidationError(`invalid agent plan in source "${parsed.data.id}"`, issues);
      }
    }
    return parsed.data as IntentSourceDocument;
  });

  // Deterministic ordering: precedence tier, then explicit `order`, then id.
  const ordered = [...validated].sort((a, b) => {
    const tier = SOURCE_PRECEDENCE[a.kind] - SOURCE_PRECEDENCE[b.kind];
    if (tier !== 0) {
      return tier;
    }
    const order = (a.order ?? 0) - (b.order ?? 0);
    if (order !== 0) {
      return order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const requirements: IntentStatement[] = [];
  const constraints: IntentStatement[] = [];
  const mustPreserve: IntentStatement[] = [];
  const acceptanceCriteria: IntentStatement[] = [];
  const mentionedPaths = new Set<string>();
  const mentionedSymbols = new Set<string>();
  const mentions: IntentMention[] = [];
  const conflicts: IntentConflict[] = [];
  const diagnostics: IntentDiagnostic[] = [];
  const refs: IntentSourceRef[] = [];

  let goal = "";
  let goalSourceId: string | undefined;
  let goalTier = Number.POSITIVE_INFINITY;
  const lowerGoals: { sourceId: string; kind: IntentSourceKind; goal: string }[] = [];

  let hasExplicit = false;
  let hasStructured = false;
  let hasProse = false;

  for (const doc of ordered) {
    const priority = SOURCE_PRECEDENCE[doc.kind];
    const sourceMeta = { id: doc.id, kind: doc.kind, path: doc.path, priority };
    const text = doc.text ?? doc.body ?? "";
    const title = doc.title ?? "";
    // For an agent plan the searchable document is the plan's own serialized
    // content, so every extracted statement still has a real source span.
    const planText =
      doc.kind === "agent_plan" ? serializePlanText(doc.plan as AgentPlan | undefined) : "";
    const documentText = [title, text, planText].filter((s) => s.length > 0).join("\n");

    if (EXPLICIT_SOURCE_KINDS.has(doc.kind)) {
      hasExplicit = true;
    }
    if (doc.kind === "agent_plan") {
      hasStructured = true;
    }
    if (doc.kind === "pr" || doc.kind === "issue" || doc.kind === "commit") {
      hasProse = true;
    }

    let docGoal = "";
    let goalIndex = 0;
    const occurrences = new Map<string, number>();

    if (doc.kind === "agent_plan") {
      const plan = doc.plan as AgentPlan;
      docGoal = plan.goal ?? "";
      const addPlanStatements = (
        kind: "requirement" | "constraint" | "must_preserve" | "acceptance",
        list: string[] | undefined,
        target: IntentStatement[]
      ) => {
        for (const item of list ?? []) {
          const index = documentText.indexOf(item);
          if (index === -1) {
            continue;
          }
          const occ = occurrences.get(`${kind}:${item}`) ?? 0;
          occurrences.set(`${kind}:${item}`, occ + 1);
          const statement = makeStatement(kind, { text: item, index }, sourceMeta, documentText, occ);
          if (statement) {
            target.push(statement);
          }
        }
      };
      addPlanStatements("requirement", plan.requirements, requirements);
      addPlanStatements("constraint", plan.constraints, constraints);
      addPlanStatements("must_preserve", plan.must_preserve, mustPreserve);
      addPlanStatements("acceptance", plan.acceptance_criteria, acceptanceCriteria);
      for (const p of plan.mentioned_paths ?? []) {
        mentionedPaths.add(p);
        const span = findSpan(documentText, p);
        mentions.push({
          kind: "path",
          value: p,
          sourceId: doc.id,
          sourceKind: doc.kind,
          priority,
          span,
          excerpt: span ? p : undefined
        });
      }
      for (const s of plan.mentioned_symbols ?? []) {
        mentionedSymbols.add(s);
        const span = findSpan(documentText, s);
        mentions.push({
          kind: "symbol",
          value: s,
          sourceId: doc.id,
          sourceKind: doc.kind,
          priority,
          span,
          excerpt: span ? s : undefined
        });
      }
      if (!docGoal && text.length > 0) {
        docGoal = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
        goalIndex = 0;
      }
    } else {
      const segments = proseSegments(documentText);
      if (title.length > 0) {
        docGoal = title;
        goalIndex = documentText.indexOf(title);
      } else if (segments.length > 0) {
        docGoal = segments[0].text;
        goalIndex = segments[0].index;
      }
      for (const segment of segments) {
        const occ = occurrences.get(`requirement:${segment.text}`) ?? 0;
        occurrences.set(`requirement:${segment.text}`, occ + 1);
        const statement = makeStatement("requirement", segment, sourceMeta, documentText, occ);
        if (statement) {
          requirements.push(statement);
        }
      }
      // Lexical mentions are drawn from the source text only.
      for (const p of extractPathLike(text)) {
        mentionedPaths.add(p);
        const span = findSpan(documentText, p);
        mentions.push({ kind: "path", value: p, sourceId: doc.id, sourceKind: doc.kind, priority, span });
      }
      for (const s of extractSymbolLike(text)) {
        mentionedSymbols.add(s);
        const span = findSpan(documentText, s);
        mentions.push({ kind: "symbol", value: s, sourceId: doc.id, sourceKind: doc.kind, priority, span });
      }
    }

    if (docGoal.length > 0) {
      if (goal.length === 0) {
        goal = docGoal;
        goalSourceId = doc.id;
        goalTier = priority;
      } else if (priority === goalTier) {
        // Same tier, conflicting goal text: record ambiguity but keep the first
        // (deterministically ordered) goal.
        if (docGoal !== goal) {
          conflicts.push({
            type: "ambiguous-goal",
            message: `sources "${goalSourceId}" and "${doc.id}" both claim tier ${priority} but state different goals`,
            sourceIds: [goalSourceId ?? "", doc.id]
          });
        }
      } else {
        lowerGoals.push({ sourceId: doc.id, kind: doc.kind, goal: docGoal });
      }
    }

    refs.push({
      id: doc.id,
      kind: doc.kind,
      priority,
      adoptedGoal: doc.id === goalSourceId,
      shadowed: false,
      path: doc.path,
      url: doc.url
    });
  }

  // Recompute adopted/shadowed flags now that the goal source is known.
  for (const ref of refs) {
    ref.adoptedGoal = ref.id === goalSourceId;
    ref.shadowed = lowerGoals.some((g) => g.sourceId === ref.id);
  }

  for (const lower of lowerGoals) {
    conflicts.push({
      type: "shadowed-fallback",
      message: `goal from "${lower.sourceId}" (${lower.kind}) was shadowed by higher-precedence source "${goalSourceId}"`,
      sourceIds: [goalSourceId ?? "", lower.sourceId]
    });
  }

  let confidence: IntentConfidence;
  if (hasExplicit) {
    confidence = "explicit";
  } else if (hasStructured) {
    confidence = "structured";
  } else if (hasProse && requirements.length > 0) {
    confidence = "inferred";
  } else {
    confidence = "uncertain";
  }

  if (validated.length === 0) {
    diagnostics.push({
      code: "no-intent-source",
      message: "no intent source was supplied; scope classification must treat every atom as uncertain",
      sourceIds: []
    });
  } else if (!hasExplicit) {
    diagnostics.push({
      code: "missing-explicit-task",
      message: "no explicit --task/--task-file source; a confident required classification is not possible",
      sourceIds: validated.map((d) => d.id)
    });
  }

  const llmRequested = options.llm === "auto";
  if (llmRequested) {
    diagnostics.push({
      code: "llm-disabled",
      message: "LLM normalization is not performed by this module; deterministic extraction is used instead",
      sourceIds: []
    });
    diagnostics.push({
      code: "llm-not-authoritative",
      message: "an LLM judgement alone must never make an atom automatically removable",
      sourceIds: []
    });
  }

  const sortStatements = (items: IntentStatement[]) =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const dedupedMentions = dedupeMentions(mentions);

  return {
    schemaVersion: "patchdiet-intent/1",
    goal,
    requirements: sortStatements(requirements),
    constraints: sortStatements(constraints),
    mustPreserve: sortStatements(mustPreserve),
    acceptanceCriteria: sortStatements(acceptanceCriteria),
    mentionedPaths: [...mentionedPaths].sort(),
    mentionedSymbols: [...mentionedSymbols].sort(),
    mentions: dedupedMentions,
    sources: refs,
    conflicts,
    diagnostics,
    confidence,
    llmUsed: false,
    llmRequested
  };
}

/**
 * Keep the highest-precedence mention per (kind, value) so a lower-precedence
 * prose mention never shadows an explicit task mention of the same name. Ties
 * are broken by sourceId for determinism.
 */
function dedupeMentions(mentions: IntentMention[]): IntentMention[] {
  const best = new Map<string, IntentMention>();
  for (const mention of mentions) {
    const key = `${mention.kind}\u0000${mention.value}`;
    const current = best.get(key);
    if (
      !current ||
      mention.priority < current.priority ||
      (mention.priority === current.priority && mention.sourceId < current.sourceId)
    ) {
      best.set(key, mention);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind < b.kind ? -1 : 1;
    }
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
}
