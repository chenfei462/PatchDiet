import { createHash } from "node:crypto";

import type { ChangeAtom, CommandEvidence, EvidenceRecord, GraphFacts, RepositoryRule, ScopeFacts } from "../../evidence/src/index.js";
import { graphIsComplete, makeEvidence, outgoingEdges, findDependencyPath, globMatches } from "../../evidence/src/index.js";
import type { IntentMention, IntentStatement, NormalizedIntent } from "../../intent/src/index.js";
import { atomId } from "../../intent/src/index.js";

import {
  RISK_FLAGS,
  SCOPE_STATES,
  type AnalyzeScopeOptions,
  type AtomClassification,
  type RiskAnnotation,
  type RiskFlag,
  type ScopeReport,
  type ScopeState,
  type ScopeSummary
} from "./types.js";

// ── Risk flag detection (orthogonal to scope state) ───────────────

interface RiskPattern {
  flag: RiskFlag;
  test: RegExp;
  detail: string;
}

const RISK_PATTERNS: RiskPattern[] = [
  {
    flag: "dependency-manifest",
    test: /(^|\/)(package\.json|pyproject\.toml|requirements[\w.-]*\.txt|Cargo\.toml|go\.mod|Gemfile|composer\.json|build\.gradle[\w.]*|pom\.xml)$/,
    detail: "dependency manifest changed"
  },
  {
    flag: "lockfile",
    test: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock)$/,
    detail: "lockfile changed"
  },
  {
    flag: "migration",
    test: /(^|\/)(migrations?|db\/migrate|schema-migrations)(\/|$)|\.sql$/,
    detail: "database migration or schema change"
  },
  {
    flag: "security",
    test: /(^|\/)(auth|authentication|authorization|crypto|security|secrets?|tokens?|permissions?)(\/|\.|$)/,
    detail: "security-sensitive path"
  },
  {
    flag: "public-api",
    test: /(^|\/)(index|public-api|api|exports?)\.(ts|tsx|js|jsx|py|d\.ts)$|\.d\.ts$/,
    detail: "possible public API surface"
  },
  {
    flag: "generated",
    test: /(^|\/)(generated|gen|dist|build|__generated__|\.gen\.)/,
    detail: "generated path"
  }
];

function detectRisks(atom: ChangeAtom): RiskAnnotation[] {
  const annotations: RiskAnnotation[] = [];
  const path = atom.filePath.replaceAll("\\", "/");
  for (const pattern of RISK_PATTERNS) {
    if (pattern.test.test(path)) {
      annotations.push({ flag: pattern.flag, detail: `${pattern.detail}: ${atom.filePath}`, evidenceIds: [] });
    }
  }
  // Keep deterministic flag order.
  return annotations.sort((a, b) => RISK_FLAGS.indexOf(a.flag) - RISK_FLAGS.indexOf(b.flag));
}

// ── Intent matching ───────────────────────────────────────────────

/** Normalize a path for tolerant comparison across separators and case. */
function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

interface IntentMatch {
  mention: IntentMention;
  /** Evidence record id for this match. */
  evidenceId: string;
  /** True when a bare symbol name matched but maps to several atoms. */
  ambiguous: boolean;
}

/**
 * Maps a bare symbol name to the number of distinct file paths it appears in.
 * A bare name in more than one module is ambiguous and must never produce a
 * confident intent match.
 */
type SymbolAmbiguity = Map<string, number>;

function buildSymbolAmbiguity(atoms: readonly ChangeAtom[]): SymbolAmbiguity {
  const filesByBareName = new Map<string, Set<string>>();
  for (const atom of atoms) {
    const bare = bareSymbolName(atom.symbolPath);
    if (!bare) {
      continue;
    }
    const files = filesByBareName.get(bare) ?? new Set<string>();
    files.add(normalizePath(atom.filePath));
    filesByBareName.set(bare, files);
  }
  const ambiguity: SymbolAmbiguity = new Map();
  for (const [bare, files] of filesByBareName) {
    ambiguity.set(bare, files.size);
  }
  return ambiguity;
}

/** The last segment of a dotted/`::` symbol path, lowercased. */
function bareSymbolName(symbolPath: string | undefined): string | undefined {
  if (!symbolPath) {
    return undefined;
  }
  const parts = symbolPath.split(/::|[.]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1].toLowerCase() : undefined;
}

function statementMentions(intent: NormalizedIntent): IntentMention[] {
  return intent.mentions;
}

/**
 * Direct intent match: the atom's file path or symbol is explicitly named in a
 * higher-precedence source. Only an explicit/structured mention (priority <= 1)
 * can produce `required`; an inferred prose mention can only support. A bare
 * symbol name that appears in more than one module is ambiguous and is reported
 * as such rather than becoming a confident match.
 */
function findIntentMatch(
  atom: ChangeAtom,
  intent: NormalizedIntent,
  atomIdValue: string,
  ambiguity: SymbolAmbiguity
): { match?: IntentMatch; evidence: EvidenceRecord[]; inferred: boolean; ambiguous: boolean } {
  const evidence: EvidenceRecord[] = [];
  const path = normalizePath(atom.filePath);
  const symbol = atom.symbolPath?.toLowerCase();

  let best: IntentMention | undefined;
  let inferred = false;
  let ambiguous = false;

  for (const mention of statementMentions(intent)) {
    let hit = false;
    let mentionAmbiguous = false;
    if (mention.kind === "path") {
      const mentioned = normalizePath(mention.value);
      hit = path === mentioned || path.endsWith(`/${mentioned}`) || mentioned.endsWith(`/${path}`);
    } else if (mention.kind === "symbol" && symbol) {
      const mentioned = mention.value.toLowerCase();
      const isBare = !/[.:]/.test(mentioned);
      if (isBare) {
        const bare = bareSymbolName(atom.symbolPath);
        hit = bare === mentioned;
        mentionAmbiguous = hit && (ambiguity.get(mentioned) ?? 0) > 1;
      } else {
        hit = symbol === mentioned || symbol.endsWith(`.${mentioned}`) || symbol.endsWith(`::${mentioned}`);
      }
    }
    if (!hit) {
      continue;
    }
    if (!best || mention.priority < best.priority) {
      best = mention;
      inferred = mention.priority > 1;
      ambiguous = mentionAmbiguous;
    }
  }

  if (best) {
    const limiting = ambiguous;
    evidence.push(
      makeEvidence({
        category: "intent",
        polarity: limiting ? "limits" : inferred ? "supports-supporting" : "supports-required",
        confidence: limiting ? 0.3 : inferred ? 0.6 : 0.95,
        sourceId: best.sourceId,
        atomId: atomIdValue,
        detail: limiting
          ? `bare symbol name "${best.value}" is ambiguous across modules; not a confident intent match`
          : inferred
            ? `"${best.value}" named in inferred source ${best.sourceId} (${best.sourceKind})`
            : `explicit task names ${best.kind} "${best.value}" (source ${best.sourceId})`,
        limits: limiting ? ["ambiguous symbol name across modules cannot establish required scope"] : undefined,
        span: best.span
          ? {
              sourceId: best.sourceId,
              startByte: best.span.startByte,
              endByte: best.span.endByte,
              startLine: best.span.startLine,
              endLine: best.span.endLine,
              excerpt: best.excerpt ?? best.value
            }
          : undefined
      })
    );
  }

  return {
    match: best ? { mention: best, evidenceId: evidence[0].id, ambiguous } : undefined,
    evidence,
    inferred,
    ambiguous
  };
}

/**
 * Textual requirement match: does any requirement statement contain the atom's
 * symbol name? This is weaker than an explicit mention and can only reach
 * `required` when the intent has explicit/structured confidence.
 */
/**
 * Explicit task exclusions: statements that declare a category of change
 * unrelated to the task ("debug logging ... unrelated to this task"). Words
 * from such statements become exclusion terms; atoms whose content or kind
 * matches an exclusion term are NOT required, even when a requirement names
 * their enclosing symbol. Terms are drawn from the task text itself — nothing
 * is hardcoded per fixture.
 */
const EXCLUSION_STATEMENT_RE = /\b(unrelated|out of scope|not (?:part of|related to)|excludes?|excluding)\b/i;

const EXCLUSION_STOPWORDS = new Set([
  "this", "that", "task", "scope", "unrelated", "unrelated-", "exclude", "excludes",
  "excluding", "excluded", "part", "related", "with", "from", "and", "the", "are",
  "only", "also", "into", "onto", "such"
]);

/** Atom kinds matched by "local variables" style exclusion terms. */
const LOCAL_DECLARATION_KINDS = new Set([
  "lexical_declaration",
  "variable_declaration",
  "variable_declarator",
  // Tree-sitter reports the declarator's own symbol with kind `variable`;
  // it is the smallest node overlapping a local-assignment edit.
  "variable",
  "assignment"
]);

interface TaskExclusion {
  textTerms: string[];
  localDeclarations: boolean;
  statements: IntentStatement[];
}

function taskExclusions(intent: NormalizedIntent): TaskExclusion {
  const statements = [...intent.requirements, ...intent.constraints].filter((statement) =>
    EXCLUSION_STATEMENT_RE.test(statement.text)
  );
  const terms = new Set<string>();
  let localDeclarations = false;
  for (const statement of statements) {
    const words = statement.text.toLowerCase().split(/[^a-z-]+/).filter(Boolean);
    for (const raw of words) {
      for (const word of raw.split("-")) {
        if (word.length < 4 || EXCLUSION_STOPWORDS.has(word)) continue;
        if (word === "local" || word === "locals" || word === "variable" || word === "variables") {
          localDeclarations = true;
          continue;
        }
        terms.add(word);
      }
    }
  }
  return { textTerms: [...terms].sort(), localDeclarations, statements };
}

function atomIsExcluded(
  atom: ChangeAtom,
  exclusion: TaskExclusion
): { excluded: boolean; matchedTerms: string[]; localDeclaration: boolean } {
  if (exclusion.statements.length === 0) {
    return { excluded: false, matchedTerms: [], localDeclaration: false };
  }
  const matchedTerms: string[] = [];
  const patchText = (atom.patchText ?? "").toLowerCase();
  for (const term of exclusion.textTerms) {
    if (new RegExp(`\\b${term}`).test(patchText)) {
      matchedTerms.push(term);
    }
  }
  const localDeclaration = exclusion.localDeclarations && LOCAL_DECLARATION_KINDS.has(atom.symbolKind ?? "");
  return {
    excluded: matchedTerms.length > 0 || localDeclaration,
    matchedTerms,
    localDeclaration
  };
}

function findRequirementTextMatch(
  atom: ChangeAtom,
  intent: NormalizedIntent,
  atomIdValue: string
): { statements: IntentStatement[]; evidence: EvidenceRecord[] } {
  const name = atom.symbolPath?.split(/[.:]/).pop()?.toLowerCase();
  if (!name || name.length < 3) {
    return { statements: [], evidence: [] };
  }
  const statements = [...intent.requirements, ...intent.acceptanceCriteria].filter((statement) =>
    statement.text.toLowerCase().includes(name)
  );
  const evidence = statements.map((statement) =>
    makeEvidence({
      category: "intent",
      polarity: "supports-required",
      confidence: 0.7,
      sourceId: statement.sourceId,
      atomId: atomIdValue,
      detail: `requirement mentions symbol name "${name}": "${statement.text}"`,
      span: {
        sourceId: statement.sourceId,
        startByte: statement.span.startByte,
        endByte: statement.span.endByte,
        startLine: statement.span.startLine,
        endLine: statement.span.endLine,
        excerpt: statement.excerpt
      }
    })
  );
  return { statements, evidence };
}

/** Protection match: an explicit protection rule or invariant covers the atom. */
function findProtection(
  atom: ChangeAtom,
  rules: readonly RepositoryRule[],
  intent: NormalizedIntent,
  atomIdValue: string
): { rule?: RepositoryRule; evidence: EvidenceRecord[] } {
  const evidence: EvidenceRecord[] = [];
  const path = atom.filePath.replaceAll("\\", "/");

  for (const rule of rules) {
    if (rule.kind === "path-protect" && rule.scopePattern) {
      const pattern = rule.scopePattern.replaceAll("\\", "/");
      if (globMatches(pattern, path)) {
        evidence.push(
          makeEvidence({
            category: "repository-rule",
            polarity: "supports-protected",
            confidence: 0.9,
            sourceId: rule.sourceId,
            atomId: atomIdValue,
            reliability: rule.reliability,
            detail: `protected-path rule from ${rule.path}: "${rule.text}"`,
            span: rule.span
          })
        );
      }
    }
  }

  // A must-preserve statement that names the atom's path/symbol also protects.
  for (const statement of intent.mustPreserve) {
    const lower = statement.text.toLowerCase();
    const pathHit = lower.includes(normalizePath(atom.filePath));
    const symbolHit = atom.symbolPath ? lower.includes(atom.symbolPath.toLowerCase()) : false;
    if (pathHit || symbolHit) {
      evidence.push(
        makeEvidence({
          category: "intent",
          polarity: "supports-protected",
          confidence: 0.8,
          sourceId: statement.sourceId,
          atomId: atomIdValue,
          detail: `must-preserve statement covers this atom: "${statement.text}"`,
          span: {
            sourceId: statement.sourceId,
            startByte: statement.span.startByte,
            endByte: statement.span.endByte,
            startLine: statement.span.startLine,
            endLine: statement.span.endLine,
            excerpt: statement.excerpt
          }
        })
      );
    }
  }

  return { rule: rules.find((rule) => rule.kind === "path-protect" && rule.scopePattern && globMatches(rule.scopePattern, path)), evidence };
}

// ── Main analysis ─────────────────────────────────────────────────

/** Stable hash of the inputs an analysis was derived from. */
function computeAnalysisId(intent: NormalizedIntent, facts: ScopeFacts): string {
  const hash = createHash("sha256");
  hash.update("scope-analysis");
  hash.update(JSON.stringify(intent));
  hash.update(JSON.stringify({
    atoms: [...facts.atoms].sort((a, b) => (a.id ?? atomId(a)).localeCompare(b.id ?? atomId(b))),
    graph: facts.graph,
    rules: [...(facts.rules ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    tests: facts.tests,
    history: facts.history,
    mergedPrs: [...(facts.mergedPrs ?? [])].sort((a, b) => a.pr.localeCompare(b.pr)),
    static: facts.static,
    runtime: facts.runtime,
    memory: facts.memory
  }));
  return `scope-${hash.digest("hex").slice(0, 12)}`;
}

/** Resolve the stable id of an atom, deriving one when absent. */
function resolveAtomId(atom: ChangeAtom): string {
  return atom.id ?? atomId(atom);
}

/**
 * Analyze a set of serializable change atoms against a normalized intent and
 * supporting facts, producing a deterministic Scope Map.
 *
 * This function is pure and read-only: it never touches the filesystem, never
 * spawns a subprocess and never runs the verification oracle. Its classifications
 * are advisory — `requiresRuntimeOracle` is always true, because scope evidence
 * may only say what to try, never what is safe to delete.
 */
export function analyzeScope(
  intent: NormalizedIntent,
  facts: ScopeFacts,
  _options: AnalyzeScopeOptions = {}
): ScopeReport {
  const graph: GraphFacts | undefined = facts.graph;
  const graphComplete = graphIsComplete(graph);
  const rules = facts.rules ?? [];
  const atoms = [...facts.atoms].sort((a, b) => {
    const aid = resolveAtomId(a);
    const bid = resolveAtomId(b);
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });

  // Precompute bare symbol-name ambiguity: a bare name that maps to more than
  // one atom across modules must not be treated as a confident match.
  const ambiguity = buildSymbolAmbiguity(atoms);

  const evidenceById = new Map<string, EvidenceRecord>();
  const classifications: AtomClassification[] = atoms.map((atom) => {
    const { classification, evidence } = classifyAtom(atom, intent, facts, graphComplete, rules, ambiguity);
    for (const record of evidence) {
      evidenceById.set(record.id, record);
    }
    return classification;
  });

  const allEvidence = [...evidenceById.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Caller-asserted merged-PR records are citable GLOBAL evidence: each record
  // carries the actual PR identity, merge commit, input source and byte hash.
  // They claim NO file/symbol relation to any atom, carry weak NEUTRAL weight
  // and never change a classification, eligibility, risk or oracle authority.
  for (const record of facts.mergedPrs ?? []) {
    allEvidence.push(
      makeEvidence({
        category: "history",
        polarity: "neutral",
        confidence: 0.1,
        sourceId: `merged-pr:${record.pr}`,
        reliability: "weak",
        detail:
          `caller-asserted merged PR ${record.pr} (merge commit ${record.mergeCommit}) ` +
          `from local snapshot '${record.snapshotPath}' ` +
          `(input '${record.inputPath}' sha256:${record.inputContentSha}, pinned at ${record.indexedCommit})` +
          (record.labels.length > 0 ? `; labels: ${record.labels.join(", ")}` : ""),
        limits: [
          "merged-PR provenance is a caller assertion, not GitHub authentication; no file or symbol relation to any atom is claimed",
          "merged-PR records never authorise removal or change a scope classification"
        ]
      })
    );
  }

  const summary: ScopeSummary = {
    required: 0,
    supporting: 0,
    candidate: 0,
    uncertain: 0,
    protected: 0,
    flagged: 0
  };
  for (const classification of classifications) {
    summary[classification.state] += 1;
    if (classification.risks.length > 0) {
      summary.flagged += 1;
    }
  }

  const graphDiagnostics: string[] = [];
  if (!graph) {
    graphDiagnostics.push("no graph facts supplied: dependency reachability cannot be evaluated");
  } else {
    graphDiagnostics.push(...graph.incompleteReasons);
  }

  const limits = [
    "Scope classification is advisory and never authorises deletion by itself; the configured runtime oracle is still required.",
    "A missing dependency edge never proves a change is unused when graph facts are incomplete.",
    "Lexical, structural or historical similarity may rank a candidate but never proves a change unnecessary.",
    "Repository rules are prose, not executable instructions, and are applied conservatively with traceable provenance."
  ];

  return {
    schemaVersion: "patchdiet-scope/1",
    analysisId: computeAnalysisId(intent, facts),
    intent: {
      goal: intent.goal,
      confidence: intent.confidence,
      sourceIds: intent.sources.map((source) => source.id)
    },
    atoms: classifications,
    evidence: allEvidence,
    summary,
    graphDiagnostics,
    limits,
    readOnly: true,
    oracleExecuted: false
  };
}

function classifyAtom(
  atom: ChangeAtom,
  intent: NormalizedIntent,
  facts: ScopeFacts,
  graphComplete: boolean,
  rules: readonly RepositoryRule[],
  ambiguity: SymbolAmbiguity
): { classification: AtomClassification; evidence: EvidenceRecord[] } {
  const id = resolveAtomId(atom);
  const evidence: EvidenceRecord[] = [];
  const counterEvidence: EvidenceRecord[] = [];
  const missingInputs: string[] = [];
  const conflicts: string[] = [];
  const risks = detectRisks(atom);

  // History facts (when supplied by the caller from a CURRENT pinned history
  // snapshot) are attached as weak, NEUTRAL evidence with real commit/source
  // identities, to every affected atom. Historical data may only inform
  // ranking context; it never changes a classification state, eligibility,
  // risks, protections or oracle authority on its own.
  const history = facts.history?.[id];
  if (history) {
    const identityParts: string[] = [];
    if (history.snapshotCommit) {
      identityParts.push(`snapshot pinned at ${history.snapshotCommit}`);
    }
    if (history.sourceCommits !== undefined && history.sourceCommits.length > 0) {
      identityParts.push(`recent commits: ${history.sourceCommits.join(", ")}`);
    }
    if (history.coChangedWith !== undefined && history.coChangedWith.length > 0) {
      identityParts.push(
        `file co-change (same-commit heuristic): ${history.coChangedWith.map((c) => `${c.path} x${c.count}`).join(", ")}`,
      );
    }
    evidence.push(
      makeEvidence({
        category: "history",
        polarity: "neutral",
        confidence: 0.2,
        sourceId: history.snapshotCommit ? `history:${history.snapshotCommit}` : "history",
        atomId: id,
        reliability: "weak",
        detail:
          `history facts available (changeCount=${history.changeCount ?? 0})` +
          (identityParts.length > 0 ? `; ${identityParts.join("; ")}` : ""),
        limits: [
          "historical data may only inform ranking context and never authorises removal or changes a scope classification"
        ]
      })
    );
  }

  const done = (state: ScopeState, rest: { explanation: string; removalEligible: boolean }) => ({
    classification: finalize(atom, state, evidence, counterEvidence, missingInputs, conflicts, risks, rest),
    evidence: [...evidence, ...counterEvidence]
  });

  const hasExplicitTask = intent.confidence === "explicit" || intent.confidence === "structured";
  // 2b. Explicit task exclusions: a statement declaring a category unrelated
  // ("debug logging ... unrelated to this task") prevents a text match from
  // forcing the atom to required. The exclusion is recorded as intent evidence
  // with an explicit limit; the oracle, not the exclusion, authorises removal.
  const exclusion = taskExclusions(intent);
  const atomExclusion = atomIsExcluded(atom, exclusion);

  // 1. Protection has the highest precedence: it overrides candidate.
  const protection = findProtection(atom, rules, intent, id);
  if (protection.evidence.length > 0) {
    evidence.push(...protection.evidence);
    return done("protected", {
      explanation: "an explicit protection rule or must-preserve invariant covers this atom",
      removalEligible: false
    });
  }

  // 2. Direct explicit intent match -> required.
  const intentMatch = findIntentMatch(atom, intent, id, ambiguity);
  evidence.push(...intentMatch.evidence);

  if (
    intentMatch.match &&
    !intentMatch.inferred &&
    !intentMatch.ambiguous &&
    hasExplicitTask &&
    !atomExclusion.excluded
  ) {
    return done("required", {
      explanation: "directly named by the explicit task intent",
      removalEligible: false
    });
  }

  if (intentMatch.ambiguous) {
    missingInputs.push("symbol name is ambiguous across modules");
    conflicts.push("an ambiguous symbol name cannot establish required or candidate scope");
    return done("uncertain", {
      explanation: "the intent names a symbol that is ambiguous across modules",
      removalEligible: false
    });
  }

  if (atomExclusion.excluded) {
    evidence.push(
      makeEvidence({
        category: "intent",
        polarity: "limits",
        confidence: 0.6,
        sourceId: exclusion.statements[0]!.sourceId,
        atomId: id,
        detail:
          `task exclusion statement matches this atom` +
          (atomExclusion.matchedTerms.length > 0 ? ` (terms: ${atomExclusion.matchedTerms.join(", ")})` : "") +
          (atomExclusion.localDeclaration ? " (debug-only local declaration)" : ""),
        limits: ["an exclusion prevents required classification; removal still requires the runtime oracle"]
      })
    );
  }

  // 3. Requirement text match -> required when the intent is explicit/structured.
  const requirementMatch = findRequirementTextMatch(atom, intent, id);
  if (requirementMatch.statements.length > 0 && !atomExclusion.excluded) {
    evidence.push(...requirementMatch.evidence);
    if (hasExplicitTask) {
      return done("required", {
        explanation: "matches a stated requirement or acceptance criterion",
        removalEligible: false
      });
    }
  }

  // 4. Graph supporting: this atom is a dependency of a required symbol, i.e.
  // a required atom reaches it along outgoing dependency edges.
  const requiredSymbols = collectRequiredSymbols(facts, intent);
  let graphSupportFound = false;
  if (facts.graph && requiredSymbols.size > 0) {
    for (const requiredId of requiredSymbols) {
      if (requiredId === id) {
        continue;
      }
      const path = findDependencyPath(facts.graph, requiredId, new Set([id]));
      if (path) {
        graphSupportFound = true;
        evidence.push(
          makeEvidence({
            category: "graph",
            polarity: "supports-supporting",
            confidence: 0.8,
            sourceId: `graph:${facts.graph.edges.length}-edges`,
            atomId: id,
            reliability: "strong",
            detail: `required change depends on this atom: ${path.join(" -> ")}`
          })
        );
        break;
      }
    }
  }

  if (graphSupportFound) {
    return done("supporting", {
      explanation: "graph evidence shows this atom supports required changes",
      removalEligible: false
    });
  }

  // 5. Test evidence: a mapped task test supports a required/supporting change.
  const testFacts = facts.tests?.[id];
  if (testFacts && testFacts.mappedTestIds.length > 0) {
    evidence.push(
      makeEvidence({
        category: "test",
        polarity: "supports-supporting",
        confidence: testFacts.mappingType === "coverage" ? 0.85 : 0.6,
        sourceId: `test-mapping:${testFacts.mappingType ?? "unknown"}`,
        atomId: id,
        reliability: testFacts.mappingType === "coverage" || testFacts.mappingType === "explicit" ? "strong" : "medium",
        detail: `${testFacts.mappedTestIds.length} test(s) map to this atom via ${testFacts.mappingType ?? "unknown"} mapping`
      })
    );
    return done("supporting", {
      explanation: "test evidence maps this atom to a task-relevant test",
      removalEligible: false
    });
  }

  // 6. No positive evidence. Decide between candidate and uncertain.
  const hasIntentText = intent.goal.length > 0 || intent.requirements.length > 0;
  const canBeCandidate = hasExplicitTask && graphComplete;

  if (!hasIntentText) {
    missingInputs.push("no task intent was supplied");
    conflicts.push("absence of intent cannot prove unrelatedness");
    return done("uncertain", {
      explanation: "no intent evidence; classification is uncertain by policy",
      removalEligible: false
    });
  }

  if (!hasExplicitTask) {
    missingInputs.push("no explicit task; only inferred prose intent is available");
    return done("uncertain", {
      explanation: "only inferred intent is available, which cannot support a confident candidate",
      removalEligible: false
    });
  }

  if (!graphComplete) {
    missingInputs.push("graph/index facts are incomplete");
    if (!facts.graph) {
      missingInputs.push("no dependency graph supplied");
    } else {
      missingInputs.push(...facts.graph.incompleteReasons);
    }
    return done("uncertain", {
      explanation: "graph facts are incomplete, so absent dependency evidence cannot be trusted",
      removalEligible: false
    });
  }

  if (!canBeCandidate) {
    return done("uncertain", {
      explanation: "insufficient evidence to classify",
      removalEligible: false
    });
  }

  // Candidate: explicit intent + complete graph + no intent/graph/test/protection
  // evidence. Positive evidence for the *absence* is recorded so the candidate
  // is traceable, never merely "unmatched".
  const noPathDetail = requiredSymbols.size > 0
    ? "no required symbol depends on this atom within configured traversal"
    : "no required symbols were identified to compare against";
  evidence.push(
    makeEvidence({
      category: "graph",
      polarity: "supports-candidate",
      confidence: 0.5,
      sourceId: `graph:${facts.graph?.edges.length ?? 0}-edges`,
      atomId: id,
      reliability: "strong",
      detail: noPathDetail
    })
  );
  evidence.push(
    makeEvidence({
      category: "intent",
      polarity: "supports-candidate",
      confidence: 0.5,
      sourceId: intent.sources[0]?.id ?? "intent",
      atomId: id,
      detail: "no requirement or acceptance criterion references this atom"
    })
  );

  const memory = facts.memory?.[id];
  if (memory) {
    evidence.push(
      makeEvidence({
        category: "developer-memory",
        polarity: "neutral",
        confidence: 0.2,
        sourceId: "developer-memory",
        atomId: id,
        reliability: "weak",
        detail: `developer memory: ${memory.support} support / ${memory.reject} reject`,
        limits: ["developer memory affects ranking only and never overrides rules or verification"]
      })
    );
  }

  const runtime = facts.runtime?.[id];
  if (runtime && runtime.length > 0) {
    for (const command of runtime) {
      if (command.status === "inconclusive" || command.flaky) {
        counterEvidence.push(
          makeEvidence({
            category: "runtime",
            polarity: "limits",
            confidence: 0.4,
            sourceId: `command:${command.command}`,
            atomId: id,
            reliability: "weak",
            command,
            detail: `prior command "${command.command}" was inconclusive/flaky`,
            limits: ["an inconclusive check prohibits a high-confidence automatic removal"]
          })
        );
      }
    }
  }

  if (counterEvidence.length > 0) {
    return done("uncertain", {
      explanation: "positive absence evidence is contradicted by inconclusive runtime evidence",
      removalEligible: false
    });
  }

  return done("candidate", {
    explanation: "explicit task and complete graph evidence show no requirement, dependency, test or protection link",
    removalEligible: true
  });
}

/** Symbols/atoms that the intent explicitly requires, used as graph targets. */
function collectRequiredSymbols(facts: ScopeFacts, intent: NormalizedIntent): Set<string> {
  const targets = new Set<string>();
  for (const mention of intent.mentions) {
    if (mention.kind === "symbol") {
      for (const atom of facts.atoms) {
        const atomSymbol = atom.symbolPath?.toLowerCase();
        if (atomSymbol && (atomSymbol === mention.value.toLowerCase() || atomSymbol.endsWith(`.${mention.value.toLowerCase()}`))) {
          targets.add(resolveAtomId(atom));
        }
      }
    }
    if (mention.kind === "path") {
      const mentioned = normalizePath(mention.value);
      for (const atom of facts.atoms) {
        const path = normalizePath(atom.filePath);
        if (path === mentioned || path.endsWith(`/${mentioned}`)) {
          targets.add(resolveAtomId(atom));
        }
      }
    }
  }
  return targets;
}

function finalize(
  atom: ChangeAtom,
  state: ScopeState,
  evidence: EvidenceRecord[],
  counterEvidence: EvidenceRecord[],
  missingInputs: string[],
  conflicts: string[],
  risks: RiskAnnotation[],
  rest: { explanation: string; removalEligible: boolean }
): AtomClassification {
  return {
    atomId: resolveAtomId(atom),
    filePath: atom.filePath,
    symbolPath: atom.symbolPath,
    state,
    evidenceIds: evidence.map((record) => record.id),
    counterEvidenceIds: counterEvidence.map((record) => record.id),
    explanation: rest.explanation,
    missingInputs,
    conflicts,
    risks,
    removalEligible: rest.removalEligible,
    requiresRuntimeOracle: true
  };
}
