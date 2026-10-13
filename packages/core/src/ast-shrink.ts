import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { normalizeIntent, type IntentSourceDocument } from "../../intent/src/index.js";
import { analyzeScope } from "../../scope/src/index.js";
import { parseSource, type ParseResult } from "../../parsers/src/index.js";

import { atomizeFileEdits, type AtomEdit } from "./ast-atomizer.js";
import {
  buildDependencyGroups,
  deriveAtomEdges,
  removedIdsForGroups,
  toReductionGroups,
  type AtomDependencyEdge,
  type AtomGroup,
  type DependencyReason
} from "./dependency-groups.js";
import type { GraphEdgeFact, GraphFacts } from "../../evidence/src/index.js";
import { encodeSelectivePatch, type SelectiveEdit } from "./patch-encoder.js";
import { reduceGroups, type ReductionAttempt } from "./reducer.js";
import { serializeUnifiedDiff } from "./diff.js";
import type { DiffFile, ParsedDiff } from "./types.js";
import {
  classifyCandidate,
  createEvalWorktree,
  evaluateAllCandidates,
  getConservativeSkipEvaluation,
  readPatchDietVersion,
  registerActiveWorktree,
  removeEvalWorktree,
  runTargetedCommandsForTrial,
  runVerificationStage,
  treeOf,
  writeTreeOf,
  type EvaluationContext,
  type HunkEvaluation
} from "./shrink.js";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────

export interface AstShrinkParams {
  ctx: EvaluationContext;
  parsed: ParsedDiff;
  markPartial: (reason: string) => void;
  /** Explicit task text (--task/--task-file); undefined keeps oracle-only v1 semantics. */
  taskText?: string;
}

export interface AstShrinkReduction {
  strategy: "ddmin";
  selectedGroupIds: string[];
  attempts: ReductionAttempt[];
  atomGranularity: "ast";
  dependencyGroups: { id: string; memberIds: string[]; reasons: string[] }[];
}

export interface AstShrinkOutcome {
  evaluations: HunkEvaluation[];
  completed: boolean;
  expectedTreeSha?: string;
  reduction: AstShrinkReduction;
  /**
   * Regenerated kept patch: AST files via the approved patch encoder
   * (BASE -> reduced), unsupported files byte-faithful.
   */
  buildKeptPatch: () => string;
}

interface AstFileContext {
  file: DiffFile;
  baseText: string;
  headText: string;
  baseParse: ParseResult;
  headParse: ParseResult;
  edits: AtomEdit[];
}

interface AstEntry {
  ast: AstFileContext;
  edit: AtomEdit;
  evaluation: HunkEvaluation;
}

// ── Entry point ───────────────────────────────────────────────────

/**
 * AST-granular, task-aware shrink runtime.
 *
 * Every reduction unit is a paired AST edit produced by the atomizer from the
 * pinned BASE and HEAD blobs. Removal trials regenerate BOTH sides with the
 * approved patch encoder — the BASE->reduced artifact patch and the reversed
 * HEAD->reduced candidate set — because hunk coordinates are invalid after a
 * partial AST removal. The full configured oracle, the tree-identity checks
 * and the mandatory final artifact verification from the P0 pipeline are
 * reused unchanged; nothing here short-circuits them, including zero-removal
 * runs.
 *
 * With a task, scope classification gates eligibility (required / supporting /
 * protected / risky atoms are always retained; only unlinked low-risk
 * candidates are trialed). Without a task every non-protected edit is a trial
 * candidate and the oracle is the only authority (v1-compatible semantics).
 */
export async function runAstShrink(params: AstShrinkParams): Promise<AstShrinkOutcome> {
  const { ctx, parsed, markPartial } = params;
  const options = ctx.options;

  // 1. Conservative skips stay byte-faithful human review (accepted policy).
  const skippedFiles = new Map<DiffFile, Omit<HunkEvaluation, "hunk" | "index">>();
  const candidateFiles: DiffFile[] = [];
  for (const file of parsed.files) {
    const skip = getConservativeSkipEvaluation(file, options);
    if (skip) {
      skippedFiles.set(file, skip);
    } else {
      candidateFiles.push(file);
    }
  }

  // 2. Atomization per candidate file; explicit conservative fallbacks.
  const astFiles = new Map<DiffFile, AstFileContext>();
  const hunkPathFiles: DiffFile[] = [];
  const fallbackReasons = new Map<DiffFile, string>();
  for (const file of candidateFiles) {
    if (file.hunks.length === 0) {
      hunkPathFiles.push(file); // metadata-only sections round-trip via the diff serializer
      continue;
    }
    if (file.isNew || file.isDelete || file.isRename || file.hunks.some((hunk) => hunk.binary)) {
      // P0 policy: whole-file creation/deletion, binary/rename/metadata changes
      // stay on the existing whole-file/hunk path; no partial newfile patches.
      hunkPathFiles.push(file);
      fallbackReasons.set(file, "new/deleted/rename/binary files follow the existing whole-file/hunk policy");
      continue;
    }
    const filePatch = serializeUnifiedDiff({ files: [file] });
    const blobs = await readSideTexts(ctx, file.path);
    if (!blobs) {
      hunkPathFiles.push(file);
      fallbackReasons.set(file, "pinned blob missing or not valid UTF-8; hunk fallback");
      continue;
    }
    const [baseParse, headParse] = await Promise.all([
      parseSource(file.path, blobs.baseText),
      parseSource(file.path, blobs.headText)
    ]);
    if (!baseParse.complete || !headParse.complete) {
      hunkPathFiles.push(file);
      fallbackReasons.set(
        file,
        `AST parse incomplete (base complete=${baseParse.complete}, head complete=${headParse.complete}); hunk fallback`
      );
      continue;
    }
    const atomized = await atomizeFileEdits({
      path: file.path,
      baseText: blobs.baseText,
      headText: blobs.headText,
      baseParse,
      headParse,
      filePatch
    });
    if (atomized.edits.length === 0) {
      hunkPathFiles.push(file);
      fallbackReasons.set(file, `atomizer produced no edits: ${atomized.diagnostics.join("; ") || "unknown"}`);
      continue;
    }
    astFiles.set(file, {
      file,
      baseText: blobs.baseText,
      headText: blobs.headText,
      baseParse,
      headParse,
      edits: atomized.edits
    });
  }

  // Partiality from fallbacks is recorded BEFORE any removal selection: a
  // run with an unverified file is partial, and a partial run publishes no
  // removals (gated at step 5).
  if (fallbackReasons.size > 0) {
    markPartial(
      [...fallbackReasons.values()].map((reason) => `AST fallback: ${reason}`).join("; ")
    );
  }

  // 3. Hunk-path files keep the existing (accepted) evaluation behavior.
  const hunkEvaluations = hunkPathFiles.length > 0
    ? await evaluateAllCandidates({ files: hunkPathFiles }, ctx)
    : [];

  // 4. Scope/task gating over AST edits. Missing/incomplete evidence is the
  // scope engine's job to surface; here a non-candidate state always retains.
  const allEdits = [...astFiles.values()].flatMap((ast) => ast.edits);
  const contentKeyByEditId = new Map<string, string>();
  for (const ast of astFiles.values()) {
    const baseBytes = Buffer.from(ast.baseText, "utf8");
    const headBytes = Buffer.from(ast.headText, "utf8");
    for (const edit of ast.edits) {
      const key = createHash("sha256")
        .update("patchdiet-ast-feedback-v1\0")
        .update(edit.filePath).update("\0")
        .update(edit.id).update("\0")
        .update(baseBytes.subarray(edit.baseStartByte, edit.baseEndByte)).update("\0")
        .update(headBytes.subarray(edit.headStartByte, edit.headEndByte))
        .digest("hex");
      contentKeyByEditId.set(edit.id, key);
    }
  }
  const scopeReasonByEditId = new Map<string, string>();
  if (params.taskText !== undefined && params.taskText.trim().length > 0) {
    const sources: IntentSourceDocument[] = [
      { id: "cli:task", kind: "cli", text: params.taskText, order: 0 }
    ];
    const intent = normalizeIntent(sources);
    const headBytesByPath = new Map<string, Buffer>(
      [...astFiles.values()].map((ast) => [ast.file.path, Buffer.from(ast.headText, "utf8")])
    );
    const scopeAtoms = allEdits.map((edit) => {
      const bytes = headBytesByPath.get(edit.filePath)!;
      const headSlice = bytes.subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
      return {
        id: edit.id,
        filePath: edit.filePath,
        symbolPath: edit.symbolName,
        symbolKind: edit.headKind,
        hunkHeader: `ast: ${edit.detail}`,
        contentHash: createHash("sha256").update(headSlice).digest("hex"),
        index: 0,
        patchText: headSlice
      };
    });
    // Def-use graph over the changed atoms, built from the same real AST
    // facts as the reduction groups (edge direction: dependent -> dependency).
    // Any file that fell back to the hunk path makes the changed-file facts
    // incomplete: absence of a dependency path is then untrustworthy and the
    // scope engine must downgrade to `uncertain` (retain).
    const graphEdges: GraphEdgeFact[] = [];
    const graphIncomplete: string[] = [...fallbackReasons.values()];
    if (hunkPathFiles.some((file) => file.hunks.length > 0)) {
      graphIncomplete.push("some changed files were not AST-atomized; changed-file reference facts are partial");
    }
    if (graphIncomplete.length === 0) {
      const parses = new Map<string, ParseResult>();
      const headTexts = new Map<string, string>();
      for (const ast of astFiles.values()) {
        parses.set(ast.file.path, ast.headParse);
        headTexts.set(ast.file.path, ast.headText);
      }
      const edgeTypeOf = (reason: AtomDependencyEdge["reason"]): GraphEdgeFact["edgeType"] =>
        reason === "import-use" ? "import"
        : reason === "call-reference" ? "call"
        : reason === "test-fixture" ? "test-of"
        : "reference";
      for (const edge of deriveAtomEdges(allEdits, { parses, headTexts })) {
        graphEdges.push({
          fromId: edge.toEditId,
          toId: edge.fromEditId,
          edgeType: edgeTypeOf(edge.reason),
          reliability: "strong",
          sourceId: `ast-def-use:${edge.reason}`
        });
      }
    }
    const graph: GraphFacts | undefined = graphIncomplete.length > 0
      ? { edges: [], incompleteReasons: graphIncomplete }
      : { edges: graphEdges, incompleteReasons: [] };
    const scope = analyzeScope(intent, { atoms: scopeAtoms, graph });
    const evidenceById = new Map(scope.evidence.map((record) => [record.id, record]));
    // Symbols the task positively requires (from required/supporting atoms).
    const requiredSymbolNames = new Set<string>();
    for (const classification of scope.atoms) {
      if (classification.state === "required" || classification.state === "supporting") {
        const last = classification.symbolPath?.split(".").pop();
        if (last) requiredSymbolNames.add(last.toLowerCase());
      }
    }
    const editsById = new Map(allEdits.map((edit) => [edit.id, edit]));
    const headParseByPath = new Map([...astFiles.values()].map((ast) => [ast.file.path, ast.headParse]));
    for (const classification of scope.atoms) {
      // Task gating: only a low-risk, positively supported `candidate` may
      // enter the removal search. required / supporting / protected / uncertain
      // atoms and any atom carrying a risk flag are always retained — missing
      // or incomplete evidence never proves a change unnecessary.
      //
      // Positive support means the supplied task itself ties evidence to THIS
      // atom: a task exclusion statement matched the atom ("debug logging is
      // unrelated"). A candidate with no atom-tied task evidence (a vague task
      // that mentions nothing about the change) is retained — absence of a
      // mention is not evidence of unrelatedness.
      let retain = classification.state !== "candidate" || classification.risks.length > 0;
      if (!retain) {
        const taskTiedEvidence = classification.evidenceIds.some(
          (evidenceId) => evidenceById.get(evidenceId)?.polarity === "limits"
        );
        retain = !taskTiedEvidence;
      }
      // Mixed coarse-atom evidence: a coarse edit (e.g. a whole export
      // statement produced by an untiled replacement) whose span fully covers
      // the declaration of a task-required symbol carries CONFLICTING
      // evidence — the task excludes a debug sub-span of its text, but the
      // same span also contains the required behavior named by the task.
      // The requirement names the symbol either directly (requirement text)
      // or via another atom classified required/supporting. Exclusion of a
      // sub-span can never authorize reverting the whole required function,
      // so the edit is retained as uncertain rather than trialed.
      let mixedCoarseEvidence = false;
      if (!retain) {
        const edit = editsById.get(classification.atomId);
        const parse = edit ? headParseByPath.get(edit.filePath) : undefined;
        if (edit && parse && edit.headEndByte > edit.headStartByte) {
          const taskNamesSymbol = (symbolName: string): boolean =>
            requiredSymbolNames.has(symbolName.toLowerCase()) ||
            [...intent.requirements, ...intent.acceptanceCriteria].some((statement) =>
              statement.text.toLowerCase().includes(symbolName.toLowerCase())
            );
          mixedCoarseEvidence = parse.symbols.some(
            (symbol) =>
              symbol.span.endByte > symbol.span.startByte &&
              taskNamesSymbol(symbol.name) &&
              symbol.span.startByte >= edit.headStartByte &&
              symbol.span.endByte <= edit.headEndByte
          );
          if (mixedCoarseEvidence) {
            retain = true;
          }
        }
      }
      scopeReasonByEditId.set(
        classification.atomId,
        retain
          ? `RETAIN scope state ${classification.state}` +
            (classification.risks.length > 0
              ? ` (risk flags: ${classification.risks.map((risk) => risk.flag).join(", ")})`
              : "") +
            (mixedCoarseEvidence
              ? " (mixed evidence: this coarse edit's span covers a task-required symbol; a debug sub-span exclusion cannot authorize reverting it)"
              : classification.state === "candidate"
                ? " (no task evidence positively tied to this atom)"
                : "")
          : `TRIAL scope state ${classification.state}: ${classification.explanation}`
      );
    }
  }

  // 5. Dependency grouping over eligible edits (def-use / import-use /
  //    call-reference / test-fixture; singleton groups when disabled).
  // A fallback anywhere in the diff makes the run partial: unverified
  // removals are never published, so no edit is trialed (review finding 4).
  const fallbackBlocksTrials = fallbackReasons.size > 0;
  if (fallbackBlocksTrials) {
    for (const edit of allEdits) {
      scopeReasonByEditId.set(
        edit.id,
        "RETAIN another changed file fell back to the hunk path; the run is partial and publishes no removals"
      );
    }
  }
  const eligibleEdits = allEdits.filter((edit) => !fallbackBlocksTrials && isScopeEligible(edit.id));
  const feedbackPriorities = options.feedbackRanking?.priorities ?? {};
  for (const edit of eligibleEdits) {
    const key = contentKeyByEditId.get(edit.id)!;
    if (feedbackPriorities[key] > 0) ctx.feedbackPrioritizedKeys.add(key);
  }
  function isScopeEligible(editId: string): boolean {
    const reason = scopeReasonByEditId.get(editId);
    // Without a task every edit is a trial candidate (oracle authority).
    return reason === undefined || !reason.startsWith("RETAIN");
  }
  const eligibleSet = new Set(eligibleEdits.map((edit) => edit.id));
  const atomGroups: AtomGroup[] = (() => {
    if (options.dependencyGrouping === false || eligibleEdits.length === 0) {
      return eligibleEdits.map((edit) => ({
        id: `grp-${edit.id}`,
        memberIds: [edit.id],
        reasons: [] as DependencyReason[],
        details: []
      }));
    }
    const parses = new Map<string, ParseResult>();
    const headTexts = new Map<string, string>();
    for (const ast of astFiles.values()) {
      parses.set(ast.file.path, ast.headParse);
      headTexts.set(ast.file.path, ast.headText);
    }
    const edges = deriveAtomEdges(eligibleEdits, { parses, headTexts });
    return buildDependencyGroups(eligibleEdits, edges);
  })();

  const reductionGroups = toReductionGroups(atomGroups, allEdits);
  const groupPriority = Object.fromEntries(reductionGroups.map((group) => [group.id,
    Math.max(0, ...group.memberIds.map((id) => feedbackPriorities[contentKeyByEditId.get(id) ?? ""] ?? 0))]));
  const reduction: AstShrinkReduction = {
    strategy: "ddmin",
    selectedGroupIds: [],
    attempts: [],
    atomGranularity: "ast",
    dependencyGroups: atomGroups.map((group) => ({
      id: group.id,
      memberIds: group.memberIds,
      reasons: group.reasons
    }))
  };

  // 6. ddmin over the grouped eligible edits.
  const astEntries: AstEntry[] = [];
  for (const ast of astFiles.values()) {
    for (const edit of ast.edits) {
      const scopeReason = scopeReasonByEditId.get(edit.id);
      astEntries.push({
        ast,
        edit,
        evaluation: {
          filePath: edit.filePath,
          hunk: { header: `ast: ${edit.detail}`, lines: [] },
          index: 0,
          verdict: "kept",
          reason: scopeReason
            ? scopeReason
            : "trial candidate (no task supplied; the configured oracle is the authority)",
          category: classifyCandidate(edit.filePath, []),
          contentSha256: contentKeyByEditId.get(edit.id)
        }
      });
    }
  }
  const evaluationOfEdit = new Map(astEntries.map((entry) => [entry.edit.id, entry.evaluation]));

  let expectedTreeSha: string | undefined;
  let completed = true;
  let failureDetail: string | undefined;

  const markAllEligibleHumanReview = (detail: string): void => {
    for (const entry of astEntries) {
      if (!eligibleSet.has(entry.edit.id)) continue;
      entry.evaluation.verdict = "needs-human-review";
      entry.evaluation.reason = `${detail}; this candidate requires human review`;
    }
  };

  if (reductionGroups.length === 0) {
    expectedTreeSha = await treeOf(ctx.pinnedHeadSha, options.cwd);
  } else {
    const context = {
      baseSha: ctx.pinnedBaseSha,
      headSha: ctx.pinnedHeadSha,
      requiredCommands: options.requiredCommands,
      environment: createHash("sha256").update(JSON.stringify([
        process.execPath, process.version, process.platform, process.arch,
        process.env.NODE_ENV ?? "", process.env.CI ?? "",
        options.commandTimeoutMs ?? null, options.retryFlakyTests ?? 0,
      ])).digest("hex"),
      toolVersion: readPatchDietVersion() ?? "unknown",
    };
    let trialCounter = 0;

    const evaluate = (searchGroups: { id: string; memberIds: string[] }[]) =>
      async (selectedIds: string[]): Promise<"PASS" | "FAIL" | "INCONCLUSIVE"> => {
        // Resolve against the ACTUAL group list of the current search. An
        // unknown group id fails closed instead of collapsing into an empty
        // (trivially passing) removal set (review finding 2).
        let removedIds: Set<string>;
        try {
          removedIds = removedIdsForGroups(selectedIds, searchGroups);
        } catch {
          return "INCONCLUSIVE";
        }
        if (removedIds.size === 0) {
          // Genuinely empty selection: nothing removed is trivially consistent.
          return "PASS";
        }
        trialCounter += 1;
        return evaluateTrial(removedIds, `ast-trial-${trialCounter}-${randomUUID().slice(0, 8)}`);
      };

    const result = await reduceGroups(reductionGroups, context, evaluate(reductionGroups), {
      cache: options.cacheTests !== false, priority: groupPriority
    });
    reduction.attempts.push(...result.attempts);
    let finalResult = result;
    let finalGroupList = reductionGroups;
    if (!result.inconclusive && result.selectedIds.length === 0) {
      // Granularity escalation: a coarse dependency group failing as a whole
      // does not prove its members are necessary. Retry the search over
      // singleton groups (finer AST statements) before concluding "kept".
      const singletonGroups = eligibleEdits.map((edit) => ({
        id: `grp-single-${edit.id}`,
        contentHash: createHash("sha256").update(edit.id).digest("hex"),
        memberIds: [edit.id]
      }));
      if (singletonGroups.length > reductionGroups.length) {
        const finer = await reduceGroups(singletonGroups, context, evaluate(singletonGroups), {
          cache: options.cacheTests !== false,
          priority: Object.fromEntries(singletonGroups.map((group) => [group.id,
            feedbackPriorities[contentKeyByEditId.get(group.memberIds[0]!) ?? ""] ?? 0]))
        });
        reduction.attempts.push(...finer.attempts);
        if (!finer.inconclusive && finer.selectedIds.length > 0) {
          finalResult = finer;
          finalGroupList = singletonGroups;
        }
      }
    }
    if (finalResult.inconclusive) {
      failureDetail = "at least one grouped oracle result was inconclusive";
      markAllEligibleHumanReview(failureDetail);
      markPartial("AST ddmin observed an inconclusive oracle result; all removals require human review");
      completed = false;
    } else if (finalResult.selectedIds.length === 0) {
      failureDetail = "no passing grouped removal set was found";
      markAllEligibleHumanReview(failureDetail);
      markPartial("AST ddmin found no passing grouped removal set; all removals require human review");
      completed = false;
    } else {
      reduction.selectedGroupIds = finalResult.selectedIds;
      const selected = new Set(finalResult.selectedIds);
      for (const group of finalGroupList) {
        if (selected.has(group.id)) continue;
        for (const memberId of group.memberIds) {
          const evaluation = evaluationOfEdit.get(memberId);
          if (evaluation) {
            evaluation.verdict = "kept";
            evaluation.reason = "kept after ddmin: this group was not part of the passing combined removal set";
          }
        }
      }
      for (const groupId of finalResult.selectedIds) {
        for (const memberId of finalGroupList.find((group) => group.id === groupId)?.memberIds ?? []) {
          const evaluation = evaluationOfEdit.get(memberId);
          if (evaluation) {
            evaluation.verdict = "removed";
            evaluation.reason = "removed after ddmin: the grouped removal set passed the full configured oracle";
          }
        }
      }
      // 7. Mandatory combined verification of the exact selected removal set
      // (never a union of individually passing removals).
      const combinedRemoved = new Set<string>();
      for (const groupId of finalResult.selectedIds) {
        for (const memberId of finalGroupList.find((group) => group.id === groupId)?.memberIds ?? []) {
          combinedRemoved.add(memberId);
        }
      }
      const combined = await verifyAstCombinedRemovalSet(combinedRemoved, "ast-combined");
      if (!combined.completed) {
        reduction.selectedGroupIds = [];
        completed = false;
      } else {
        expectedTreeSha = combined.expectedTreeSha;
      }
    }
  }

  /** Apply a removal set as one reversed patch in a pinned HEAD worktree and prove it. */
  async function evaluateTrial(removedIds: Set<string>, label: string): Promise<"PASS" | "FAIL" | "INCONCLUSIVE"> {
    if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
      return "INCONCLUSIVE";
    }
    let removalPatch: string;
    try {
      removalPatch = buildRemovalPatch(removedIds);
    } catch {
      return "INCONCLUSIVE"; // encoder rejection: structural/encoding problem, not proof of necessity
    }
    if (removalPatch.trim().length === 0) {
      return "PASS"; // nothing removed: trivially consistent
    }
    // Syntax gate BEFORE any oracle run: a trial that breaks a supported
    // source file is inconclusive, never a passing removal — even when the
    // user oracle is weak.
    for (const ast of astFiles.values()) {
      if (!ast.edits.some((edit) => removedIds.has(edit.id))) continue;
      const { reducedText } = encodeSelectivePatch({
        path: ast.file.path,
        baseText: ast.baseText,
        headText: ast.headText,
        edits: ast.edits,
        keepEditIds: ast.edits.filter((edit) => !removedIds.has(edit.id)).map((edit) => edit.id)
      });
      const parsed = await parseSource(ast.file.path, reducedText);
      if (!parsed.complete) {
        return "INCONCLUSIVE";
      }
    }
    const worktreePath = join(ctx.runEvalRoot, label);
    const patchPath = join(ctx.runEvalRoot, `${label}.diff`);
    writeFileSync(patchPath, removalPatch, ctx.patchEncoding);
    registerActiveWorktree(worktreePath, options.cwd);
    try {
      await createEvalWorktree(worktreePath, ctx.pinnedHeadSha, options.cwd);
      try {
        await execFileAsync("git", ["apply", patchPath], { cwd: worktreePath });
      } catch {
        return "INCONCLUSIVE"; // apply error: grouping/encoding problem, not proof of necessity
      }
      await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
      const trialTree = await writeTreeOf(worktreePath);
      // v2 targeted-first: mapped tests for the touched files run on the
      // ACTUAL removal state, before the full required oracle. A failure may
      // only reject this trial (FAIL); the required oracle below still runs
      // and the combined/final verification is unchanged.
      if (ctx.options.targetedFirst === true && ctx.targeted) {
        const touchedPaths = astFiles.size > 0
          ? [...astFiles.values()]
              .filter((ast) => ast.edits.some((edit) => removedIds.has(edit.id)))
              .map((ast) => ast.file.path)
          : [];
        const targeted = await runTargetedCommandsForTrial(ctx, worktreePath, touchedPaths);
        if (targeted === "failed") {
          return "FAIL";
        }
        if (targeted === "unverifiable") {
          return "INCONCLUSIVE";
        }
      }
      const stage = await runVerificationStage(options.requiredCommands, worktreePath, options, ctx.deadlineAt);
      if (stage.status !== "passed") {
        return stage.oscillated || stage.commands.some((record) => record.status === "not-run")
          ? "INCONCLUSIVE"
          : "FAIL";
      }
      await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
      if ((await writeTreeOf(worktreePath)) !== trialTree) {
        return "INCONCLUSIVE"; // required commands altered tracked source
      }
      if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
        return "INCONCLUSIVE";
      }
      return "PASS";
    } catch {
      return "INCONCLUSIVE";
    } finally {
      await removeEvalWorktree(worktreePath, options.cwd);
    }
  }

  async function verifyAstCombinedRemovalSet(
    removedIds: Set<string>,
    label: string
  ): Promise<{ completed: boolean; expectedTreeSha?: string }> {
    if (removedIds.size === 0) {
      return { completed: true, expectedTreeSha: await treeOf(ctx.pinnedHeadSha, options.cwd) };
    }
    if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
      markAllEligibleHumanReview("the global runtime budget was exhausted before combined verification");
      markPartial("combined AST removal verification was skipped because the global runtime budget was exhausted");
      return { completed: false };
    }
    let removalPatch: string;
    try {
      removalPatch = buildRemovalPatch(removedIds);
    } catch {
      markAllEligibleHumanReview("the combined removal patch could not be encoded");
      markPartial("combined AST removal verification failed: the removal patch could not be encoded");
      return { completed: false };
    }
    if (removalPatch.trim().length === 0) {
      return { completed: true, expectedTreeSha: await treeOf(ctx.pinnedHeadSha, options.cwd) };
    }
    const worktreePath = join(ctx.runEvalRoot, label);
    const patchPath = join(ctx.runEvalRoot, `${label}.diff`);
    writeFileSync(patchPath, removalPatch, ctx.patchEncoding);
    registerActiveWorktree(worktreePath, options.cwd);
    try {
      await createEvalWorktree(worktreePath, ctx.pinnedHeadSha, options.cwd);
      try {
        await execFileAsync("git", ["apply", patchPath], { cwd: worktreePath });
      } catch {
        markAllEligibleHumanReview("the combined removal patch could not be applied as a whole");
        markPartial("combined AST removal verification failed: the full removal set could not be applied as one patch");
        return { completed: false };
      }
      await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
      const combinedTree = await writeTreeOf(worktreePath);
      // v2 targeted-first: mapped tests for the combined removal set run on
      // the ACTUAL removal state before the full required stage; a targeted
      // failure only rejects the set, never approves it.
      if (ctx.options.targetedFirst === true && ctx.targeted) {
        const touchedPaths = [...astFiles.values()]
          .filter((ast) => ast.edits.some((edit) => removedIds.has(edit.id)))
          .map((ast) => ast.file.path);
        const targeted = await runTargetedCommandsForTrial(ctx, worktreePath, touchedPaths);
        if (targeted === "failed") {
          markAllEligibleHumanReview("targeted mapped tests failed on the combined AST removal state");
          markPartial("combined AST removal verification rejected by targeted screening; all removals were downgraded to keep-only");
          return { completed: false };
        }
        if (targeted === "unverifiable") {
          markAllEligibleHumanReview("targeted mapped tests could not be verified on the combined AST removal state");
          markPartial("combined AST removal verification was inconclusive during targeted screening; all removals were downgraded to keep-only");
          return { completed: false };
        }
      }
      const stage = await runVerificationStage(options.requiredCommands, worktreePath, options, ctx.deadlineAt);
      if (stage.status !== "passed") {
        const failed = stage.commands.find((record) => record.status === "failed");
        failureDetail = stage.oscillated
          ? "INCONCLUSIVE: a required command produced conflicting pass/fail attempts"
          : failed?.timedOut
            ? `required command '${failed.command}' timed out`
            : `required command '${failed?.command ?? "(unknown)"}' failed`;
        markAllEligibleHumanReview(`${failureDetail} during combined removal verification`);
        markPartial(`combined AST removal verification failed: ${failureDetail}; all removals were downgraded to keep-only`);
        return { completed: false };
      }
      await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
      if ((await writeTreeOf(worktreePath)) !== combinedTree) {
        markAllEligibleHumanReview("required commands altered tracked source during combined removal verification");
        markPartial("combined AST removal verification failed: required commands altered tracked source");
        return { completed: false };
      }
      if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
        markAllEligibleHumanReview("the global runtime budget was exhausted during combined removal verification");
        markPartial("combined AST removal verification finished after the runtime budget was exhausted");
        return { completed: false };
      }
      return { completed: true, expectedTreeSha: combinedTree };
    } finally {
      await removeEvalWorktree(worktreePath, options.cwd);
    }
  }

  /** Reversed HEAD -> reduced patch for a removal set (real encoder output). */
  function buildRemovalPatch(removedIds: Set<string>): string {
    const patches: string[] = [];
    for (const ast of astFiles.values()) {
      const removedHere = ast.edits.filter((edit) => removedIds.has(edit.id));
      if (removedHere.length === 0) continue;
      const inverted: SelectiveEdit[] = ast.edits.map((edit) => ({
        id: edit.id,
        baseStartByte: edit.headStartByte,
        baseEndByte: edit.headEndByte,
        headStartByte: edit.baseStartByte,
        headEndByte: edit.baseEndByte
      }));
      const { patch } = encodeSelectivePatch({
        path: ast.file.path,
        baseText: ast.headText,
        headText: ast.baseText,
        edits: inverted,
        keepEditIds: removedHere.map((edit) => edit.id)
      });
      if (patch.trim().length > 0) {
        patches.push(patch.endsWith("\n") ? patch : `${patch}\n`);
      }
    }
    return patches.join("");
  }

  // 8. Kept patch regeneration: BASE -> reduced via the encoder for AST files,
  // byte-faithful originals for everything else. Reads the LIVE verdicts so
  // the final-failure downgrade path in shrink.ts re-encodes correctly.
  const buildKeptPatch = (): string => {
    const patches: string[] = [];
    for (const ast of astFiles.values()) {
      const keepEditIds = astEntries
        .filter((entry) => entry.ast === ast && entry.evaluation.verdict !== "removed")
        .map((entry) => entry.edit.id);
      const { patch } = encodeSelectivePatch({
        path: ast.file.path,
        baseText: ast.baseText,
        headText: ast.headText,
        edits: ast.edits,
        keepEditIds
      });
      if (patch.trim().length > 0) {
        patches.push(patch.endsWith("\n") ? patch : `${patch}\n`);
      }
    }
    const keptNonAst: DiffFile[] = [];
    for (const file of [...skippedFiles.keys(), ...hunkPathFiles]) {
      const hunks = file.hunks.filter((_hunk, index) => {
        const evaluation = hunkEvaluations.find(
          (candidate) => candidate.filePath === file.path && candidate.index === index
        );
        return evaluation?.verdict !== "removed";
      });
      if (hunks.length > 0) {
        keptNonAst.push({ ...file, hunks });
      } else if (file.hunks.length === 0 && (file.extendedHeaders?.length ?? 0) > 0) {
        keptNonAst.push({ ...file, hunks });
      }
    }
    if (keptNonAst.length > 0) {
      const nonAstPatch = serializeUnifiedDiff({ files: keptNonAst });
      if (nonAstPatch.trim().length > 0) {
        patches.push(nonAstPatch.endsWith("\n") ? nonAstPatch : `${nonAstPatch}\n`);
      }
    }
    return patches.join("");
  };

  // 9. Report entries: AST edits + hunk-path evaluations (live objects).
  const evaluations: HunkEvaluation[] = [
    ...astEntries.map((entry) => entry.evaluation),
    ...hunkEvaluations
  ];
  for (const [file, skip] of skippedFiles) {
    for (const [index, hunk] of file.hunks.entries()) {
      evaluations.push({ ...skip, hunk, index });
    }
  }
  return {
    evaluations,
    completed,
    expectedTreeSha,
    reduction,
    buildKeptPatch
  };
}

// ── Helpers ───────────────────────────────────────────────────────

async function readSideTexts(
  ctx: EvaluationContext,
  path: string
): Promise<{ baseText: string; headText: string } | undefined> {
  try {
    const base = await execFileAsync(
      "git",
      ["show", "--no-textconv", `${ctx.pinnedBaseSha}:${path}`],
      { cwd: ctx.options.cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
    );
    const head = await execFileAsync(
      "git",
      ["show", "--no-textconv", `${ctx.pinnedHeadSha}:${path}`],
      { cwd: ctx.options.cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
    );
    const baseBytes = base.stdout as Buffer;
    const headBytes = head.stdout as Buffer;
    if (!isUtf8(baseBytes) || !isUtf8(headBytes)) {
      return undefined;
    }
    return { baseText: baseBytes.toString("utf8"), headText: headBytes.toString("utf8") };
  } catch {
    return undefined;
  }
}
