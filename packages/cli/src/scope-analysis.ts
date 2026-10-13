import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { parseUnifiedDiff, serializeUnifiedDiff } from "../../core/src/diff.js";
import { atomizeFileEdits } from "../../core/src/ast-atomizer.js";
import { parseSource } from "../../parsers/src/index.js";
import { getDiff, runGit } from "../../core/src/git.js";
import { loadPatchDietConfig } from "../../core/src/config.js";
import { DEFAULT_RULE_FILES, discoverRules, extractRulesFromText, globMatches, type ChangeAtom } from "../../evidence/src/index.js";
import { normalizeIntent, atomId, type IntentSourceDocument } from "../../intent/src/index.js";
import { analyzeScope, type ScopeReport } from "../../scope/src/index.js";
import { openKnowledgeIndexReadonly, type KnowledgeIndex, type SymbolRowView } from "../../knowledge/src/index.js";
import { listTree, readBlobs, resolveRepoRoot } from "../../knowledge/src/git-blobs.js";

export interface ScopeCliOptions {
  cwd: string;
  base: string;
  head: string;
  task?: string;
  taskFile?: string;
}

/** Build an advisory Scope Map from pinned Git refs without writing artifacts or running the oracle. */
export async function analyzeDiffScope(options: ScopeCliOptions): Promise<ScopeReport> {
  const config = loadPatchDietConfig(options.cwd);
  const baseCommit = (await runGit(["rev-parse", "--verify", `${options.base}^{commit}`], options.cwd)).trim();
  const headCommit = (await runGit(["rev-parse", "--verify", `${options.head}^{commit}`], options.cwd)).trim();
  const mergeBase = (await runGit(["merge-base", baseCommit, headCommit], options.cwd)).trim();
  if (mergeBase !== baseCommit) {
    throw new Error("BASE must be the merge-base of HEAD for scope analysis; pass the merge-base or rebase the branch");
  }
  const { diff, encoding } = await getDiff(options.cwd, baseCommit, headCommit);
  const parsed = parseUnifiedDiff(diff);
  // v2 intent source allowlist: config.intent.sources selects which intent
  // source kinds may feed the analysis. Explicit task input (CLI/task file)
  // is governed by the "cli" entry; commits by "commits". Unlisted kinds are
  // EXCLUDED, never silently added back — an allowlist field must be honored.
  // Absent config keeps the historical all-sources behavior.
  const KIND_BY_CONFIG_VALUE: Record<string, string> = {
    cli: "cli",
    github_pr: "pr",
    linked_issue: "issue",
    commits: "commit",
    agent_plan: "agent_plan"
  };
  const configuredSources = config.intent?.sources;
  const allowedKinds: Set<string> | undefined = configuredSources === undefined
    ? undefined
    : new Set(configuredSources.map((value) => KIND_BY_CONFIG_VALUE[value] ?? value));
  const allowed = (kind: string): boolean => allowedKinds === undefined || allowedKinds.has(kind);
  const sources: IntentSourceDocument[] = [];
  if (options.task !== undefined && allowed("cli")) {
    sources.push({ id: "cli:task", kind: "cli", text: options.task, order: 0 });
  }
  if (options.taskFile !== undefined && allowed("cli")) {
    const taskPath = isAbsolute(options.taskFile) ? options.taskFile : resolve(options.cwd, options.taskFile);
    sources.push({ id: `task_file:${options.taskFile}`, kind: "task_file", path: options.taskFile, text: readFileSync(taskPath, "utf8"), order: 1 });
  }
  if (allowed("commit")) {
    const messages = (await runGit(["log", "--format=%B%x00", `${baseCommit}..${headCommit}`], options.cwd))
      .split("\0").map((message) => message.trim()).filter(Boolean);
    for (const [index, message] of messages.entries()) {
      sources.push({ id: `commit:${index}`, kind: "commit", text: message, order: index });
    }
  }

  // ── Granularity resolution + shared pinned-diff AST atom construction ──
  // The SAME pure atomizer the shrink runtime uses (atomizeFileEdits over
  // both pinned blobs) builds the readonly verify/explain atom set, so
  // actual shrink AST member ids are retrievable through the public CLI.
  // Granularity respects the configured/explicit setting; persisted shrink
  // evidence (.patchdiet/run.json) takes precedence when its pinned identity
  // matches the requested refs; stale/missing evidence falls back to the
  // config with an explicit diagnostic. Parser failures yield a per-file
  // conservative hunk fallback, never a fabricated atom.
  const databasePath = resolve(options.cwd, config.knowledge?.database ?? ".patchdiet/semantic-index.db");
  let knowledge: KnowledgeIndex | undefined;
  const indexDiagnostics: string[] = [];
  if (existsSync(databasePath)) {
    try {
      const opened = openKnowledgeIndexReadonly(databasePath);
      const identity = opened.repoIdentity();
      if (identity.lastCommit === headCommit && identity.root.toLowerCase() === resolve(options.cwd).toLowerCase()) {
        knowledge = opened;
      } else {
        opened.close();
        indexDiagnostics.push("semantic index is stale or belongs to a different repository; symbol mapping omitted");
      }
    } catch (error) {
      indexDiagnostics.push(`semantic index could not be read: ${(error as Error).message}`);
    }
  }
  const symbolsFor = (filePath: string): SymbolRowView[] =>
    knowledge ? knowledge.querySymbols({ path: filePath }).filter((symbol) => symbol.fileComplete) : [];
  const atomDiagnostics: string[] = [];
  let granularity = config.reduction.atomGranularity;  const runEvidencePath = join(options.cwd, ".patchdiet", "run.json");
  if (existsSync(runEvidencePath)) {
    try {
      const run = JSON.parse(readFileSync(runEvidencePath, "utf8")) as {
        reduction?: { atomGranularity?: string };
        baseCommitSha?: string;
        headCommitSha?: string;
      };
      const persisted = run.reduction?.atomGranularity;
      if (persisted === "ast" || persisted === "hunk") {
        if (run.baseCommitSha === baseCommit && run.headCommitSha === headCommit) {
          if (persisted !== granularity) {
            atomDiagnostics.push(
              `granularity '${persisted}' in effect from the persisted shrink evidence (run.json matches the pinned refs); config declares '${granularity}'`,
            );
          }
          granularity = persisted;
        } else {
          atomDiagnostics.push(
            `persisted shrink evidence (.patchdiet/run.json) is stale (base ${run.baseCommitSha?.slice(0, 12) ?? "?"}, head ${run.headCommitSha?.slice(0, 12) ?? "?"} vs pinned ${baseCommit.slice(0, 12)}/${headCommit.slice(0, 12)}); config granularity '${granularity}' applies`,
          );
        }
      }
    } catch {
      atomDiagnostics.push("persisted shrink evidence (.patchdiet/run.json) could not be read; config granularity applies");
    }
  }

  const atoms: ChangeAtom[] = [];
  const buildHunkAtom = (file: (typeof parsed.files)[number], hunk: { header: string; lines: { kind: string; text: string }[] }, index: number): ChangeAtom => {
    const patchText = [hunk.header, ...hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`), ...(file.binarySection ?? [])].join("\n");
    return {
      filePath: file.path,
      symbolPath: uniqueChangedSymbol(hunk, symbolsFor(file.path)),
      hunkHeader: hunk.header,
      contentHash: createHash("sha256").update(patchText).digest("hex"),
      index,
      addedLines: hunk.lines.filter((line) => line.kind === "add").length,
      removedLines: hunk.lines.filter((line) => line.kind === "remove").length,
      patchText
    };
  };

  if (granularity === "ast" && encoding === "utf8") {
    const repoRoot = await resolveRepoRoot(options.cwd);
    const [baseTree, headTree] = await Promise.all([
      listTree(repoRoot, baseCommit),
      listTree(repoRoot, headCommit),
    ]);
    const baseByPath = new Map(baseTree.map((entry) => [entry.path, entry.blobSha] as const));
    const headByPath = new Map(headTree.map((entry) => [entry.path, entry.blobSha] as const));
    const wantedBlobs = new Set<string>();
    const eligible = new Set<string>();
    for (const file of parsed.files) {
      if (file.hunks.length === 0) {
        continue;
      }
      if (file.isNew || file.isDelete || file.isRename || file.hunks.some((hunk) => hunk.binary)) {
        atomDiagnostics.push(`AST parse unavailable for ${file.path} (new/deleted/renamed/binary); conservative hunk fallback`);
        continue;
      }
      const baseSha = baseByPath.get(file.path);
      const headSha = headByPath.get(file.path);
      if (baseSha === undefined || headSha === undefined) {
        atomDiagnostics.push(`pinned blob missing for ${file.path}; conservative hunk fallback`);
        continue;
      }
      wantedBlobs.add(baseSha);
      wantedBlobs.add(headSha);
      eligible.add(file.path);
    }
    const blobs = await readBlobs(repoRoot, [...wantedBlobs]);
    let astAtomCount = 0;
    for (const file of parsed.files) {
      if (!eligible.has(file.path)) {
        const hunks = file.hunks.length > 0 ? file.hunks : [{ header: file.isRename ? `rename ${file.oldPath} -> ${file.path}` : `file ${file.path}`, lines: [] }];
        for (const [index, hunk] of hunks.entries()) {
          atoms.push(buildHunkAtom(file, hunk, index));
        }
        continue;
      }
      const baseBytes = blobs.get(baseByPath.get(file.path)!);
      const headBytes = blobs.get(headByPath.get(file.path)!);
      if (baseBytes === undefined || headBytes === undefined || !isUtf8(baseBytes) || !isUtf8(headBytes)) {
        atomDiagnostics.push(`pinned blob not valid UTF-8 for ${file.path}; conservative hunk fallback`);
        for (const [index, hunk] of file.hunks.entries()) {
          atoms.push(buildHunkAtom(file, hunk, index));
        }
        continue;
      }
      const baseText = baseBytes.toString("utf8");
      const headText = headBytes.toString("utf8");
      const [baseParse, headParse] = await Promise.all([
        parseSource(file.path, baseText),
        parseSource(file.path, headText),
      ]);
      if (!baseParse.complete || !headParse.complete) {
        atomDiagnostics.push(`AST parse incomplete for ${file.path} (base complete=${baseParse.complete}, head complete=${headParse.complete}); conservative hunk fallback`);
        for (const [index, hunk] of file.hunks.entries()) {
          atoms.push(buildHunkAtom(file, hunk, index));
        }
        continue;
      }
      const atomized = await atomizeFileEdits({
        path: file.path,
        baseText,
        headText,
        baseParse,
        headParse,
        filePatch: serializeUnifiedDiff({ files: [file] }),
      });
      if (atomized.edits.length === 0) {
        atomDiagnostics.push(`AST atomizer produced no edits for ${file.path}; conservative hunk fallback`);
        for (const [index, hunk] of file.hunks.entries()) {
          atoms.push(buildHunkAtom(file, hunk, index));
        }
        continue;
      }
      const headBytesFull = Buffer.from(headText, "utf8");
      const headBlobSha = headByPath.get(file.path)!;
      const baseBlobSha = baseByPath.get(file.path)!;
      for (const edit of atomized.edits) {
        const headSlice = headBytesFull.subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
        atoms.push({
          id: edit.id,
          filePath: edit.filePath,
          symbolPath: edit.symbolName,
          symbolKind: edit.headKind,
          hunkHeader: `ast: ${edit.detail}`,
          contentHash: createHash("sha256").update(headSlice).digest("hex"),
          index: 0,
          patchText: headSlice,
        });
        astAtomCount += 1;
        if (astAtomCount <= 200) {
          atomDiagnostics.push(
            `AST atom ${edit.id}: ${edit.filePath} base bytes [${edit.baseStartByte},${edit.baseEndByte}) head bytes [${edit.headStartByte},${edit.headEndByte}) (base blob ${baseBlobSha.slice(0, 12)}, head blob ${headBlobSha.slice(0, 12)})`,
          );
        }
      }
    }
    if (astAtomCount > 200) {
      atomDiagnostics.push(`... ${astAtomCount - 200} further AST atom provenance lines omitted`);
    }
    atomDiagnostics.push(`AST granularity in effect (${astAtomCount} atom(s) built with the shared pinned-diff atomizer)`);
  } else {
    for (const file of parsed.files) {
      const hunks = file.hunks.length > 0 ? file.hunks : [{ header: file.isRename ? `rename ${file.oldPath} -> ${file.path}` : `file ${file.path}`, lines: [] }];
      for (const [index, hunk] of hunks.entries()) {
        atoms.push(buildHunkAtom(file, hunk, index));
      }
    }
  }

  // The parser/index may contain unresolved or dynamic dependencies; do not
  // manufacture a complete graph from their absence. This keeps unmatched
  // changes uncertain and prevents a Scope Map from authorising deletion.
  const ruleDiagnostics: string[] = [];
  const rules = discoverRules({ protectedPatterns: config.safety.protect ?? [] }).rules;
  const repoRoot = await resolveRepoRoot(options.cwd);
  const patterns = config.knowledge?.rules.autoDiscover ?? [...DEFAULT_RULE_FILES];
  const ruleEntries = (await listTree(repoRoot, headCommit))
    .filter((entry) => patterns.some((pattern) => globMatches(pattern, entry.path)))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (ruleEntries.length > 50) {
    ruleDiagnostics.push("more than 50 repository rule documents matched; rule discovery omitted");
  } else if (ruleEntries.length > 0) {
    const blobs = await readBlobs(repoRoot, [...new Set(ruleEntries.map((entry) => entry.blobSha))]);
    for (const entry of ruleEntries) {
      const bytes = blobs.get(entry.blobSha);
      if (!bytes || bytes.length > 1024 * 1024 || !isUtf8(bytes)) {
        ruleDiagnostics.push(`repository rule ${entry.path} is missing, too large or not UTF-8; omitted`);
        continue;
      }
      rules.push(...extractRulesFromText(`rule-file:${entry.path}@${headCommit}`, entry.path, bytes.toString("utf8")));
    }
  }
  // v2 history consumption (STRICT readonly): history facts are read from the
  // CURRENT pinned index snapshot only; verify/explain never create a
  // database, migrate one, or write artifacts.
  const historyConfig = config.knowledge?.history;
  const historyDiagnostics: string[] = [];
  let historyFacts: Record<string, import("../../evidence/src/index.js").HistoryFacts> | undefined;
  let mergedPrsFacts: import("../../evidence/src/index.js").MergedPrEvidence[] | undefined;
  // Flag independence: merged_prs without history ingestion states its
  // requirement explicitly instead of disappearing silently.
  if (historyConfig?.mergedPrs === true && historyConfig.git !== true) {
    historyDiagnostics.push(
      "knowledge.history.merged_prs: enabled but requires knowledge.history.git (pinned history ingestion anchors PR records to a pinned commit); merged-PR evidence is unavailable",
    );
  }
  if (historyConfig?.git === true) {
    const snapshot = knowledge?.getHistorySnapshot();
    if (knowledge !== undefined && snapshot?.current === true) {
      const pathFacts = knowledge.getHistoryFactsForPaths([...new Set(atoms.map((atom) => atom.filePath))]);
      const keyed: Record<string, import("../../evidence/src/index.js").HistoryFacts> = {};
      for (const atom of atoms) {
        const factsForPath = pathFacts[atom.filePath];
        if (factsForPath !== undefined) {
          keyed[atom.id ?? atomId(atom)] = factsForPath;
        }
      }
      if (Object.keys(keyed).length > 0) {
        historyFacts = keyed;
      }
      // Explicit limitations travel with the report: shallow/truncated
      // snapshots must never present themselves as complete history.
      historyDiagnostics.push(...snapshot.diagnostics);
    } else {
      historyDiagnostics.push(
        "knowledge.history.git: enabled but no CURRENT pinned history snapshot is available (missing, stale or unrelated semantic index); no history evidence is attached",
      );
    }
    if (historyConfig.mergedPrs === true) {
      const mergedPrs = knowledge !== undefined && snapshot?.current === true ? knowledge.getMergedPrs() : [];
      if (mergedPrs.length > 0) {
        // Citable GLOBAL records (PR identity, merge commit, input source and
        // byte hash) — never a per-atom file/symbol claim, never decorative.
        mergedPrsFacts = mergedPrs.map((record) => ({
          pr: record.pr,
          mergeCommit: record.mergeCommit,
          snapshotPath: record.snapshotPath,
          labels: record.labels,
          inputPath: record.inputPath,
          inputContentSha: record.inputContentSha,
          indexedCommit: record.indexedCommit,
        }));
        historyDiagnostics.push(
          `merged-PR evidence: ${mergedPrs.length} caller-asserted record(s) in the pinned index ` +
            `(${mergedPrs.map((record) => `${record.pr} merge ${record.mergeCommit.slice(0, 12)}`).join(", ")}); ` +
            "provenance 'caller-asserted'; labels are unverified caller assertions, not GitHub authentication",
        );
      } else {
        historyDiagnostics.push(
          "knowledge.history.merged_prs: enabled but unavailable (no caller-supplied snapshot ingested at the pinned commit); no merged-PR evidence is attached",
        );
      }
    }
  }
  const report = analyzeScope(normalizeIntent(sources, { llm: config.intent?.llm ?? "off" }), {
    atoms,
    rules,
    history: historyFacts,
    mergedPrs: mergedPrsFacts,
  });
  if (encoding === "latin1") {
    report.graphDiagnostics.push("diff contains non-UTF-8 bytes; textual atom evidence is not authoritative");
  }
  report.graphDiagnostics.push("dependency graph not proven complete for this diff; unmatched atoms remain uncertain");
  report.graphDiagnostics.push(...indexDiagnostics);
  report.graphDiagnostics.push(...atomDiagnostics);
  report.graphDiagnostics.push(...ruleDiagnostics);
  // v2 runtime field audit: fields the parser accepts but this runtime does
  // not (or cannot) compute are reported truthfully — parser acceptance is
  // not runtime enforcement.
  report.graphDiagnostics.push(...historyDiagnostics);
  if (config.scope.flagDependencyBumps === false) {
    report.graphDiagnostics.push(
      "scope.flag_dependency_bumps=false: no advisory semver-bump detector exists in this version, so this flag toggles no detector behavior; the dependency-manifest human-review policy remains mandatory and unaffected",
    );
  }
  return report;
}

function uniqueChangedSymbol(hunk: { header: string; lines: { kind: string; text: string }[] }, symbols: SymbolRowView[]): string | undefined {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.header);
  if (!match) return undefined;
  let line = Number(match[1]);
  const changed: number[] = [];
  for (const item of hunk.lines) {
    if (item.kind === "add" && item.text.trim().length > 0) changed.push(line - 1);
    if (item.kind !== "remove") line += 1;
  }
  if (changed.length === 0) return undefined;
  const covering = symbols.filter((symbol) =>
    changed.every((row) => row >= symbol.range.startLine &&
      (row < symbol.range.endLine || (row === symbol.range.endLine && symbol.range.endColumn > 0)))
  ).sort((a, b) =>
    (a.range.endLine - a.range.startLine) - (b.range.endLine - b.range.startLine)
  );
  if (covering.length === 0) return undefined;
  if (covering.length > 1 &&
    covering[0]!.range.endLine - covering[0]!.range.startLine === covering[1]!.range.endLine - covering[1]!.range.startLine) return undefined;
  return covering[0]!.name;
}
