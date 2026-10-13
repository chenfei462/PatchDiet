#!/usr/bin/env node
/**
 * PatchDiet labelled benchmark runner (benchmarks/ scope only).
 *
 * Reproducible, repository-contained corpus: labelled synthetic/adversarial
 * and injected fixtures. See benchmarks/README.md for methodology alignment.
 *
 * THREE measured stages, published separately (never merged into one score):
 *  (1) STATIC detection: the public readonly Scope Map (verify analysis path,
 *      queried BEFORE reduction with matching granularity/task) positively
 *      ties a task-exclusion intent record or a no-risk candidate state to a
 *      prelabelled-unnecessary atom, matched by EXACT stable atom id
 *      (packages/intent atomId over the exact public hunk construction —
 *      SPACE context prefix, remove '-', add '+', binary section — or the
 *      shared AST atomizer edit id). No hunkHeader-only or file-name-only
 *      matching. This is pre-reduction readonly analysis only.
 *  (2) RUNTIME-CONFIRMED findings: a labelled-unnecessary atom whose removal
 *      was actually DELIVERED in an artifact advertised verified AND fully
 *      independently re-proven (exact-base apply, full oracle after EACH
 *      command with per-command tree identity, producer tree match,
 *      held-out oracle, and byte-level artifact-label agreement). Raw
 *      removals or labels alone NEVER grant this credit.
 *  (3) DELETION rate: cases with at least one unnecessary atom removed,
 *      regardless of verification outcome. Visibility only; never gated as
 *      detection.
 *  FULL-PIPELINE detection = per-case UNION of (1)+(2), deduplicated,
 *  denominator = ALL original labelled cases containing unnecessary edits,
 *  including conservative misses and failed cases. The >=80% exit gate is
 *  on the UNION, not on deletion. The static-only rate stays published.
 *
 * Labels are assigned BEFORE reduction from declared rules matched against
 * the changed bytes/atoms, never from the reducer verdict. Every automatic
 * removal must map to an `unnecessary` label. Full per-atom provenance (base/
 * head byte spans + source slices) is persisted before reduction so a forged
 * or incorrect removal header cannot hide a necessary deletion; the
 * independent checker verifies the ENTIRE tracked HEAD tree — every path's
 * bytes AND Git mode — requiring the artifact to equal HEAD with exactly the
 * matched unnecessary edits reverted (missing/added/untracked files, mode
 * flips and any unselected-byte change all fail).
 *
 * Gates: precision >=98%, full-pipeline detection >=80%, independent
 * final-oracle 100%, zero hidden regressions, nonzero successful removals.
 * Natural human-labelled agent PRs: sample count 0, NOT VERIFIED.
 *
 * Exit code 0 only if every applicable gate passes. Results are written under
 * benchmarks/results/<stamp>/ (per-case JSON, patches, labels, hashes).
 */

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  GATES,
  aggregateStages,
  perClassStages,
  removalPrecision,
  evaluateGates,
  scopeDetectionVerdict,
} from "./lib/metrics.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(join(HERE, ".."));
const DIST = process.env.PATCHDIET_DIST ? resolve(process.env.PATCHDIET_DIST) : join(REPO_ROOT, "dist");

function fail(message) {
  console.error(`BENCHMARK ERROR: ${message}`);
  process.exit(2);
}

if (!existsSync(join(DIST, "packages/core/src/shrink.js"))) {
  fail(`compiled dist not found at ${DIST}; build first (npm run build) or set PATCHDIET_DIST`);
}

const shrink = (await import(`file:///${join(DIST, "packages/core/src/shrink.js").replaceAll("\\", "/")}`)).runShrink;
const diffModule = await import(`file:///${join(DIST, "packages/core/src/diff.js").replaceAll("\\", "/")}`);
const atomizer = await import(`file:///${join(DIST, "packages/core/src/ast-atomizer.js").replaceAll("\\", "/")}`);
const parsers = await import(`file:///${join(DIST, "packages/parsers/src/index.js").replaceAll("\\", "/")}`);
const intentModule = await import(`file:///${join(DIST, "packages/intent/src/index.js").replaceAll("\\", "/")}`);
const { atomId: publicAtomId } = intentModule;

// ── Environment ───────────────────────────────────────────────────

function discoverPython() {
  const candidates = [process.env.PYTHON, "python", "py -3"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["-c", "import sys"], { stdio: "ignore", windowsHide: true, shell: true, timeout: 30_000 });
      return candidate;
    } catch {
      // try next
    }
  }
  for (const candidate of ["C:/Users/hacjr/AppData/Local/Programs/Python/Python311/python.exe"]) {
    if (existsSync(candidate)) return `"${candidate}"`;
  }
  return undefined;
}
const PYTHON = discoverPython();

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitAsync = async (cwd, ...args) =>
  (await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const gitBuffer = async (cwd, ...args) =>
  (await execFileAsync("git", args, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })).stdout;
const runShell = async (cwd, command, timeoutMs = 120_000) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd, encoding: "utf8", windowsHide: true, shell: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const e = error;
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e.message ?? e) };
  }
};
const sha256 = (content) => createHash("sha256").update(content, "utf8").digest("hex");

/**
 * EXACT public hunk atom construction (mirrors dist packages/cli
 * scope-analysis buildHunkAtom): header line, then every hunk line prefixed
 * with SPACE (context), '-' (remove) or '+' (add), then the file's binary
 * section when present. The stable atom id is packages/intent atomId over
 * { filePath, symbolPath, contentHash } — the same identity the Scope Map
 * reports, so evidence records can be tied to the SAME atom.
 */
function hunkAtomIdentity(file, hunk, index) {
  const patchText = [
    hunk.header,
    ...hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`),
    ...(file.binarySection ?? []),
  ].join("\n");
  const contentHash = createHash("sha256").update(patchText).digest("hex");
  return {
    patchText,
    contentHash,
    atomId: publicAtomId({ filePath: file.path, symbolPath: undefined, contentHash }),
  };
}

// ── Fixture repository construction (owned throwaway repos) ───────

function buildRepo(caseDef, scratchRoot) {
  const cwd = mkdtempSync(join(scratchRoot, `${caseDef.id}-`));
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.email", "benchmark@patchdiet.local");
  git(cwd, "config", "user.name", "PatchDiet Benchmark");
  git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "commit.gpgsign", "false");
  const writeAll = (files) => {
    for (const file of files) {
      mkdirSync(dirname(join(cwd, file.path)), { recursive: true });
      writeFileSync(join(cwd, file.path), file.content, "utf8");
    }
  };
  // AST cases commit a v2 config on BOTH sides so the public verify path
  // (analyzeDiffScope) resolves the same granularity; the identical file
  // never appears in the diff.
  const configFiles = caseDef.run.atomGranularity === "ast"
    ? [{ path: "patchdiet.yaml", content: "version: 2\nbase: main\nreduction:\n  atom_granularity: ast\n" }]
    : [];
  const baseFiles = [...configFiles, ...caseDef.baseFiles];
  const headFiles = [...configFiles, ...caseDef.headFiles, ...(caseDef.extraHeadFiles ?? [])];
  if (caseDef.pythonOracle) {
    baseFiles.push({ path: caseDef.pythonOracle.file, content: caseDef.pythonOracle.script });
    headFiles.push({ path: caseDef.pythonOracle.file, content: caseDef.pythonOracle.script });
  }
  if (caseDef.secondPythonOracle) {
    baseFiles.push({ path: caseDef.secondPythonOracle.file, content: caseDef.secondPythonOracle.script });
    headFiles.push({ path: caseDef.secondPythonOracle.file, content: caseDef.secondPythonOracle.script });
  }
  writeAll(baseFiles);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "benchmark base");
  const baseSha = git(cwd, "rev-parse", "HEAD");
  git(cwd, "checkout", "-b", "agent");
  writeAll(headFiles);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "benchmark head");
  const headSha = git(cwd, "rev-parse", "HEAD");
  return { cwd, baseSha, headSha };
}

// ── Pre-reduction labelling ───────────────────────────────────────

function matchRule(caseDef, path, text) {
  for (const rule of caseDef.labelRules) {
    if (rule.path === path && text.includes(rule.contains)) {
      return rule.label;
    }
  }
  return undefined;
}

/**
 * Computes the assessed atom set and their labels BEFORE reduction, using the
 * SAME deterministic identity pipeline as the public Scope Map: hunks built
 * exactly like the public buildHunkAtom (SPACE context, binary section,
 * intent atomId over the content hash) for hunk granularity; the shared AST
 * atomizer (edit ids + byte spans) for ast granularity, with the identical
 * conservative per-hunk fallbacks.
 *
 * Each atom persists full provenance — base/head byte spans and source
 * slices — so a forged or incorrect removal header cannot hide a necessary
 * deletion (see verifyArtifactDelta).
 */
async function computeAtoms(caseDef, cwd, baseSha, headSha) {
  const diffText = await gitAsync(cwd, "diff", baseSha, headSha);
  const parsed = diffModule.parseUnifiedDiff(diffText);
  const inputPatch = diffText;
  const atoms = [];
  const ast = caseDef.run.atomGranularity === "ast";
  const hunkFallback = (file, why) => {
    for (const [index, hunk] of file.hunks.entries()) {
      const identity = hunkAtomIdentity(file, hunk, index);
      const label = matchRule(caseDef, file.path, identity.patchText);
      if (label === undefined) throw new Error(`unlabelled changed hunk (${why}): ${file.path} #${index} (${hunk.header})`);
      atoms.push({
        kind: "hunk-fallback",
        fallbackReason: why,
        filePath: file.path,
        index,
        header: hunk.header,
        atomId: identity.atomId,
        patchText: identity.patchText,
        label,
      });
    }
  };
  for (const file of parsed.files) {
    if (!ast) {
      for (const [index, hunk] of file.hunks.entries()) {
        const identity = hunkAtomIdentity(file, hunk, index);
        const label = matchRule(caseDef, file.path, identity.patchText);
        if (label === undefined) throw new Error(`unlabelled changed hunk: ${file.path} #${index} (${hunk.header})`);
        atoms.push({ kind: "hunk", filePath: file.path, index, header: hunk.header, atomId: identity.atomId, patchText: identity.patchText, label });
      }
      continue;
    }
    if (file.hunks.length === 0 || file.isNew || file.isDelete || file.isRename || file.hunks.some((hunk) => hunk.binary)) {
      hunkFallback(file, "new/deleted/renamed/binary");
      continue;
    }
    const baseBlob = await gitBuffer(cwd, "show", `${baseSha}:${file.path}`);
    const headBlob = await gitBuffer(cwd, "show", `${headSha}:${file.path}`);
    const baseText = baseBlob.toString("utf8");
    const headText = headBlob.toString("utf8");
    const baseParse = await parsers.parseSource(file.path, baseText);
    const headParse = await parsers.parseSource(file.path, headText);
    if (!baseParse.complete || !headParse.complete) {
      // Mirror the producer's conservative fallback: unsupported/incomplete
      // parses are labelled per HUNK, never fabricated as AST atoms.
      hunkFallback(file, "unsupported-parse");
      continue;
    }
    const atomized = await atomizer.atomizeFileEdits({
      path: file.path,
      baseText,
      headText,
      baseParse,
      headParse,
      filePatch: diffModule.serializeUnifiedDiff({ files: [file] }),
    });
    if (atomized.edits.length === 0) {
      hunkFallback(file, "atomizer-produced-no-edits");
      continue;
    }
    const headBytes = Buffer.from(headText, "utf8");
    const baseBytes = Buffer.from(baseText, "utf8");
    for (const edit of atomized.edits) {
      const headSlice = headBytes.subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
      const baseSlice = baseBytes.subarray(edit.baseStartByte, edit.baseEndByte).toString("utf8");
      // Pure deletion edits carry an empty HEAD side: no head bytes exist to
      // match a rule against, so they are conservatively labelled uncertain
      // (an automatic removal of them would fail the label gate).
      const label = headSlice.trim().length === 0
        ? "uncertain"
        : matchRule(caseDef, file.path, headSlice);
      if (label === undefined) {
        throw new Error(`unlabelled AST atom ${edit.id}: ${file.path} [${edit.headStartByte},${edit.headEndByte}) ${JSON.stringify(headSlice.slice(0, 80))}`);
      }
      atoms.push({
        kind: "ast",
        id: edit.id,
        filePath: file.path,
        detail: edit.detail,
        header: `ast: ${edit.detail}`,
        label,
        // Full prelabel provenance, persisted before reduction.
        spans: {
          baseBlobSha: sha256(baseText).slice(0, 12),
          headBlobSha: sha256(headText).slice(0, 12),
          baseBytes: [edit.baseStartByte, edit.baseEndByte],
          headBytes: [edit.headStartByte, edit.headEndByte],
        },
        baseSlice,
        headSlice,
      });
    }
  }
  return { atoms, inputPatch };
}

/**
 * Maps reported removals back to labelled atoms by EXACT atom identity
 * (stable atom id for hunks; atomizer edit id via `ast: <detail>` plus file
 * path for AST atoms). Fails on any ambiguity or unknown removal.
 */
function mapRemovalsToLabels(atoms, report) {
  const removals = report.removals ?? [];
  const mapped = [];
  const used = new Set();
  for (const removal of removals) {
    const candidates = atoms.filter((atom) => {
      if (used.has(atom) || atom.filePath !== removal.filePath) return false;
      if (atom.kind === "hunk" || atom.kind === "hunk-fallback") {
        // Producer removal reports identify hunk atoms by filePath + hunk
        // header; the header is unique per file in these fixtures and our
        // atoms are built with the EXACT public construction, so this is an
        // exact same-atom match (the stable atomId is used on the Scope Map
        // detection side).
        return atom.header === removal.hunkHeader;
      }
      return `ast: ${atom.detail}` === removal.hunkHeader;
    });
    if (candidates.length === 0) {
      return { ok: false, reason: `removal could not be mapped to a labelled atom: ${removal.filePath} ${removal.hunkHeader ?? removal.atomId ?? "?"}` };
    }
    const labels = new Set(candidates.map((atom) => atom.label));
    if (candidates.length > 1 && labels.size > 1) {
      return { ok: false, reason: `ambiguous label pool for removal: ${removal.filePath} ${removal.hunkHeader}` };
    }
    const atom = candidates[0];
    used.add(atom);
    mapped.push({ atom, label: atom.label });
  }
  return { ok: true, mapped };
}

// ── Independent artifact verification ─────────────────────────────

/**
 * Byte-level artifact delta assurance over the WHOLE tracked tree: the
 * delivered artifact must equal HEAD with exactly the matched
 * labelled-unnecessary atoms reverted to their base slices — and NOTHING
 * else. Every tracked HEAD path is verified (bytes AND Git mode), missing
 * tracked files, added files, untracked worktree files and mode flips are
 * rejected, and a file may disappear only when its expected bytes are empty
 * (a fully-removed unnecessary atom). A labelled debug removal can therefore
 * never hide corruption of a separate required file, and an unlabelled
 * executable-bit flip can never escape the checker. File existence is
 * anchored to BASE, independently of expected byte length: a BASE-tracked
 * path must survive in the artifact (empty, with its HEAD mode) even when
 * reverting the added bytes empties it, while whole-file absence is
 * legitimate only when BASE lacks the path and the labelled full creation
 * was actually undone. Note the cleanup.diff
 * itself is a BASE→artifact patch; it is never parsed as the HEAD→artifact
 * delta.
 *
 * The function is deliberately self-contained (its own helpers and only the
 * execFileSync/execFileAsync/existsSync/readFileSync/join primitives) so the
 * independent review and the regression tests can extract and import the
 * ACTUAL implementation verbatim.
 *
 * Fixtures are simple (no multiline strings inside changed lines; all files
 * end with a trailing newline), which the per-atom span model relies on;
 * held-out oracles and tree identity remain mandatory regardless.
 */
async function verifyArtifactDelta({ mapped, root, baseSha, headSha }) {
  const failed = [];

  // Byte offset of each line start for a UTF-8 text (offsets[0] === 0).
  function lineOffsets(text) {
    const offsets = [0];
    let offset = 0;
    for (const line of text.split("\n")) {
      offset += Buffer.byteLength(line, "utf8") + 1; // + newline
      offsets.push(offset);
    }
    return offsets;
  }

  const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  /**
   * Byte span of a hunk atom in BASE and HEAD texts, derived from the EXACT
   * public hunk construction (same header numbers): base lines [-a,+b), head
   * lines [+c,+d). Returns { baseStart, baseEnd, headStart, headEnd } in bytes.
   */
  function hunkByteSpans(header, baseText, headText) {
    const match = HUNK_HEADER.exec(header);
    if (match === null) return undefined;
    const baseLine = Number(match[1]);
    const baseCount = match[2] === undefined ? 1 : Number(match[2]);
    const headLine = Number(match[3]);
    const headCount = match[4] === undefined ? 1 : Number(match[4]);
    const baseOffsets = lineOffsets(baseText);
    const headOffsets = lineOffsets(headText);
    const baseStart = baseCount === 0 ? undefined : baseOffsets[baseLine - 1];
    const baseEnd = baseCount === 0 ? baseStart : baseOffsets[Math.min(baseLine - 1 + baseCount, baseOffsets.length - 1)];
    const headStart = headCount === 0 ? undefined : headOffsets[headLine - 1];
    const headEnd = headCount === 0 ? headStart : headOffsets[Math.min(headLine - 1 + headCount, headOffsets.length - 1)];
    // Pure insertion at end-of-file anchors to file end.
    return {
      baseStart: baseStart ?? baseEnd ?? 0,
      baseEnd: baseEnd ?? baseStart ?? 0,
      headStart: headStart ?? headEnd ?? 0,
      headEnd: headEnd ?? headStart ?? 0,
    };
  }

  const unnecessary = mapped.filter((entry) => entry.label === "unnecessary").map((entry) => entry.atom);
  const byPath = new Map();
  for (const atom of unnecessary) {
    if (!byPath.has(atom.filePath)) byPath.set(atom.filePath, []);
    byPath.get(atom.filePath).push(atom);
  }
  const readBlob = async (sha, path) =>
    (await execFileAsync("git", ["show", `${sha}:${path}`], { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 })).stdout;
  const existsInCommit = (path, sha) => {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}:${path}`], { cwd: root, stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return false;
    }
  };

  // Full inventory: every tracked HEAD path (with mode) and every staged
  // artifact path (with mode), plus untracked worktree files. The artifact
  // under review has been applied with `git apply --index` and staged, so
  // `ls-files -s` reflects the delivered tree including modes.
  const parseZList = (buffer) => {
    const entries = new Map();
    for (const record of buffer.toString("utf8").split("\0")) {
      if (record.length === 0) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) throw new Error(`unparsable git listing record: ${record}`);
      const meta = record.slice(0, tab).split(" ");
      entries.set(record.slice(tab + 1), meta);
    }
    return entries;
  };
  let headEntries;
  let artifactEntries;
  let untracked;
  try {
    // NOTE: execFileSync returns the captured output directly (Buffer with
    // encoding "buffer") — unlike execFileAsync, there is no .stdout wrapper.
    headEntries = parseZList(
      execFileSync("git", ["ls-tree", "-r", "-z", headSha], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }),
    );
    artifactEntries = parseZList(
      execFileSync("git", ["ls-files", "-s", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }),
    );
    untracked = execFileSync("git", ["ls-files", "--others", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true })
      .toString("utf8")
      .split("\0")
      .filter((path) => path.length > 0);
  } catch (error) {
    return { ok: false, failures: [`artifact inventory unavailable: ${String(error.message ?? error)}`] };
  }
  if (untracked.length > 0) {
    failed.push(`artifact contains untracked files not present in HEAD: ${untracked.join(", ")}`);
  }

  for (const path of new Set([...headEntries.keys(), ...artifactEntries.keys()])) {
    const headMeta = headEntries.get(path);
    const artifactMeta = artifactEntries.get(path);
    if (headMeta === undefined) {
      failed.push(`${path}: artifact adds a file that is not tracked in HEAD`);
      continue;
    }
    if (!existsInCommit(path, baseSha) && !existsInCommit(path, headSha)) {
      failed.push(`${path}: tracked in neither base nor head; inventory unsound`);
      continue;
    }

    // Expected bytes: HEAD content with ONLY this path's matched
    // unnecessary atoms reverted to their base slices; unchanged paths must
    // survive byte-faithfully.
    let expected;
    if (byPath.has(path)) {
      let headBytes;
      let baseBytes;
      const missingBase = !existsInCommit(path, baseSha);
      try {
        headBytes = await readBlob(headSha, path);
        baseBytes = missingBase ? Buffer.alloc(0) : await readBlob(baseSha, path);
      } catch (error) {
        failed.push(`${path}: blob unavailable for delta reconstruction: ${String(error.message ?? error)}`);
        continue;
      }
      const headText = headBytes.toString("utf8");
      const baseText = baseBytes.toString("utf8");
      const replacements = [];
      let spanError = false;
      for (const atom of byPath.get(path)) {
        if (atom.kind === "ast") {
          replacements.push({
            start: atom.spans.headBytes[0],
            end: atom.spans.headBytes[1],
            base: Buffer.from(baseText, "utf8").subarray(atom.spans.baseBytes[0], atom.spans.baseBytes[1]),
          });
        } else {
          const spans = hunkByteSpans(atom.header, baseText, headText);
          if (spans === undefined) {
            failed.push(`${path}: hunk atom has no parsable header for span derivation: ${atom.header}`);
            spanError = true;
            continue;
          }
          replacements.push({
            start: spans.headStart,
            end: spans.headEnd,
            base: Buffer.from(baseText, "utf8").subarray(spans.baseStart, spans.baseEnd),
          });
        }
      }
      if (spanError) continue;
      replacements.sort((a, b) => a.start - b.start);
      // Overlap check: two unnecessary replacements must not overlap (else
      // the span model itself is ambiguous and reconstruction is unsound).
      let overlap = false;
      for (let i = 1; i < replacements.length; i += 1) {
        if (replacements[i].start < replacements[i - 1].end) {
          failed.push(`${path}: unnecessary atom spans overlap; byte reconstruction unsound`);
          overlap = true;
        }
      }
      if (overlap) continue;
      // Reconstruct HEAD with ONLY the unnecessary atoms reverted (ascending
      // spans, non-overlapping by the check above); empty result = file
      // expected to be fully deleted.
      const parts = [];
      let cursor = 0;
      for (const replacement of replacements) {
        parts.push(headBytes.subarray(cursor, replacement.start), replacement.base);
        cursor = replacement.end;
      }
      parts.push(headBytes.subarray(cursor));
      expected = Buffer.concat(parts);
    } else {
      try {
        expected = await readBlob(headSha, path);
      } catch (error) {
        failed.push(`${path}: blob unavailable for delta reconstruction: ${String(error.message ?? error)}`);
        continue;
      }
    }

    if (artifactMeta === undefined) {
      // Absent from the staged artifact. Presence is decided independently
      // of expected byte length: file EXISTENCE in BASE is unlabelled
      // baseline metadata and must survive, so a BASE-tracked path must
      // remain in the artifact (empty, with its HEAD mode) even when the
      // revert empties it. Whole-file absence is legitimate only when BASE
      // lacks the path (the labelled full creation was actually undone).
      if (expected.length !== 0) {
        failed.push(`${path}: tracked HEAD file missing from artifact but expected bytes remain (${expected.length} bytes)`);
        continue;
      }
      if (existsInCommit(path, baseSha)) {
        failed.push(`${path}: BASE tracks this file; reverting the added bytes must retain the (empty) file with its HEAD mode, not delete it`);
        continue;
      }
      if (existsSync(join(root, path))) {
        failed.push(`${path}: artifact removed the file from the index but the worktree file remains`);
      }
      continue;
    }
    // Git mode (100644/100755/120000) must be unchanged: an executable-bit
    // or symlink flip is a HEAD→artifact change no label ever covers.
    if (artifactMeta[0] !== headMeta[0]) {
      failed.push(`${path}: Git mode changed from ${headMeta[0]} to ${artifactMeta[0]} without a labelled necessary/unnecessary edit covering it`);
      continue;
    }
    let delivered;
    try {
      delivered = readFileSync(join(root, path));
    } catch (error) {
      failed.push(`${path}: artifact file unreadable: ${String(error.message ?? error)}`);
      continue;
    }
    if (!delivered.equals(expected)) {
      failed.push(
        `${path}: delivered artifact bytes differ from HEAD-with-only-unnecessary-atoms-removed (delivered ${delivered.length} bytes, expected ${expected.length})`,
      );
    }
  }
  return { ok: failed.length === 0, failures: failed };
}

async function independentlyVerify(caseDef, cwd, report, scratchRoot, requiredCommands, python, deltaInput) {
  const result = {
    advertisedVerified: report.mode === "verified",
    attempted: false,
    appliedClean: false,
    oracleExitCodes: [],
    treeMatchesProducer: false,
    treeUnchangedByCommands: false,
    heldOutRun: false,
    heldOutExitCode: null,
    artifactDeltaOk: false,
  };
  if (result.advertisedVerified !== true) {
    return result; // not advertised as verified: nothing to independently prove
  }
  result.attempted = true;
  const artifactSha = report.verification?.final?.artifactTreeSha;
  if (!report.patchPath || !existsSync(report.patchPath)) {
    result.error = "verified report has no cleanup.diff on disk";
    return result;
  }
  if (artifactSha === undefined) {
    result.error = "verified report has no final artifactTreeSha";
    return result;
  }
  const worktree = join(scratchRoot, `${caseDef.id}-verify`);
  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktree, report.baseCommitSha], { cwd, windowsHide: true });
    await execFileAsync("git", ["apply", "--index", report.patchPath], { cwd: worktree, windowsHide: true });
    result.appliedClean = true;
    await execFileAsync("git", ["add", "-u"], { cwd: worktree, windowsHide: true });
    const treeBefore = await gitAsync(worktree, "write-tree");
    result.treeMatchesProducer = treeBefore === artifactSha;
    if (!result.treeMatchesProducer) {
      result.error = `independent artifact tree ${treeBefore} != producer artifactTreeSha ${artifactSha}`;
      return result;
    }
    // Byte-level artifact delta assurance: HEAD→artifact changed bytes must
    // equal ONLY the matched labelled-unnecessary edits; retained bytes
    // survive byte-faithfully. A forged removal header cannot hide a
    // necessary deletion from this check.
    const delta = await verifyArtifactDelta({ ...deltaInput, root: worktree });
    result.artifactDeltaOk = delta.ok;
    result.artifactDeltaFailures = delta.failures;
    if (!delta.ok) {
      result.error = `artifact delta does not equal the matched unnecessary edits: ${delta.failures.join("; ")}`;
      return result;
    }
    // Full configured oracle (resolved commands), independently executed.
    // Tree identity is checked after EACH command: a transient repair/restore
    // by a later command can never count as a valid independent oracle pass.
    for (const command of requiredCommands) {
      const outcome = await runShell(worktree, command);
      result.oracleExitCodes.push({ command, exitCode: outcome.exitCode });
      if (outcome.exitCode !== 0) {
        result.error = `independent oracle failed: ${command}`;
        return result;
      }
      await execFileAsync("git", ["add", "-u"], { cwd: worktree, windowsHide: true });
      const treeAfterCommand = await gitAsync(worktree, "write-tree");
      if (treeAfterCommand !== treeBefore) {
        result.error = `required command altered tracked source during independent verification: ${command}`;
        return result;
      }
    }
    result.treeUnchangedByCommands = true;
    // Retained-path assertions against INDEPENDENT artifact BYTES: each
    // retained path must be byte-identical to HEAD in the delivered artifact.
    const byteCheckPaths = [
      ...(caseDef.expect.retainedPaths ?? []),
      ...(caseDef.expect.coarseMixedEvidenceRetained ? [caseDef.expect.coarseMixedEvidenceRetained] : []),
    ];
    for (const path of byteCheckPaths) {
      const headBytes = await gitBuffer(cwd, "show", `${report.headCommitSha}:${path}`);
      const deliveredBytes = readFileSync(join(worktree, path));
      if (!headBytes.equals(deliveredBytes)) {
        result.error = `retained path ${path} bytes differ from HEAD in the delivered artifact`;
        return result;
      }
    }
    // Held-out necessary-behavior oracle (untracked files: tree unchanged).
    if (caseDef.heldOut) {
      for (const file of caseDef.heldOut.files) {
        writeFileSync(join(worktree, file.path), file.content, "utf8");
      }
      const heldOutCommand = resolveCommand(caseDef.heldOut.command, python);
      if (heldOutCommand === undefined) {
        result.error = "python interpreter unavailable for held-out oracle";
        return result;
      }
      const heldOut = await runShell(worktree, heldOutCommand);
      result.heldOutRun = true;
      result.heldOutExitCode = heldOut.exitCode;
    }
    return result;
  } catch (error) {
    result.error = String(error.message ?? error);
    return result;
  } finally {
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktree], { cwd, windowsHide: true });
    } catch {
      try {
        rmSync(worktree, { recursive: true, force: true });
      } catch {
        // best effort; scratch root is owned and bounded
      }
    }
  }
}

// ── Public readonly Scope Map detection (pre-reduction) ───────────

/**
 * Queries the ACTUAL public readonly Scope Map (the verify CLI's analysis
 * path, dist packages/cli scope-analysis) with matching granularity and task
 * text, and persists the map per case.
 */
async function publicScopeMap(caseDef, cwd) {
  const scopeAnalysis = await import(
    `file:///${join(DIST, "packages/cli/src/scope-analysis.js").replaceAll("\\", "/")}`
  );
  return scopeAnalysis.analyzeDiffScope({ cwd, base: "main", head: "agent", task: caseDef.run.taskText });
}

// ── Case execution ────────────────────────────────────────────────

function resolveCommand(command, python) {
  if (command.includes("PYTHON")) {
    if (python === undefined) return undefined;
    return command.split("PYTHON").join(python);
  }
  return command;
}

async function runCase(caseDef, scratchRoot, artifactsDir, python) {
  const startedAt = Date.now();
  const outcome = { id: caseDef.id, class: caseDef.class, language: caseDef.language, ok: false, checks: [] };
  const check = (name, passed, detail) => {
    outcome.checks.push({ name, passed, detail });
    return passed;
  };
  const { cwd, baseSha, headSha } = buildRepo(caseDef, scratchRoot);
  outcome.baseSha = baseSha;
  outcome.headSha = headSha;

  const { atoms, inputPatch } = await computeAtoms(caseDef, cwd, baseSha, headSha);
  // Full prelabel provenance persisted BEFORE reduction: per-atom stable ids,
  // base/head byte spans and source slices.
  const labels = atoms.map((atom) => ({
    filePath: atom.filePath,
    identity: atom.id ?? atom.atomId,
    kind: atom.kind,
    label: atom.label,
    ...(atom.kind === "ast"
      ? { spans: atom.spans, baseSlice: atom.baseSlice, headSlice: atom.headSlice, header: atom.header }
      : { header: atom.header, atomId: atom.atomId }),
  }));
  writeFileSync(join(artifactsDir, `${caseDef.id}-labels.json`), JSON.stringify({ case: caseDef.id, labels }, null, 2));
  writeFileSync(join(artifactsDir, `${caseDef.id}-input.patch`), inputPatch, "utf8");
  outcome.labelCounts = {
    necessary: labels.filter((l) => l.label === "necessary").length,
    unnecessary: labels.filter((l) => l.label === "unnecessary").length,
    uncertain: labels.filter((l) => l.label === "uncertain").length,
  };
  outcome.hasUnnecessaryLabel = labels.some((l) => l.label === "unnecessary");

  // Stage 1 — public readonly Scope Map detection, queried BEFORE reduction
  // with matching granularity and task; the map is persisted per case.
  let scopeDetection;
  try {
    const scopeMap = await publicScopeMap(caseDef, cwd);
    writeFileSync(join(artifactsDir, `${caseDef.id}-scope-map.json`), JSON.stringify(scopeMap, null, 2));
    const matchFor = (atom) => (classification) =>
      classification.atomId === (caseDef.run.atomGranularity === "ast" ? atom.id : atom.atomId);
    const unnecessaryAtoms = atoms.filter((atom) => atom.label === "unnecessary");
    const perAtom = unnecessaryAtoms.map((atom) => ({
      identity: atom.id ?? atom.atomId,
      filePath: atom.filePath,
      ...scopeDetectionVerdict(scopeMap, matchFor(atom)),
    }));
    scopeDetection = {
      unnecessaryAtoms: perAtom.length,
      detected: perAtom.filter((entry) => entry.detected).length,
      perAtom,
    };
  } catch (error) {
    scopeDetection = { error: String(error.message ?? error) };
  }
  outcome.scopeDetection = scopeDetection;
  // Stage 1 result: detected == at least one unnecessary atom with an actual
  // same-atom task-exclusion/no-risk-candidate finding.
  outcome.staticDetected =
    scopeDetection !== undefined &&
    !scopeDetection.error &&
    scopeDetection.unnecessaryAtoms > 0 &&
    scopeDetection.detected > 0;

  const requiredCommands = caseDef.run.requiredCommands
    .map((command) => resolveCommand(command, python))
    .map((command) => {
      if (command === undefined) throw new Error(`python interpreter unavailable for case ${caseDef.id}`);
      return command;
    });

  let report;
  let shrinkError;
  const runOptions = {
    cwd,
    baseRef: "main",
    headRef: "agent",
    requiredCommands,
    strategy: caseDef.run.strategy,
    atomGranularity: caseDef.run.atomGranularity,
    dependencyGrouping: caseDef.run.atomGranularity === "ast" ? true : undefined,
    taskText: caseDef.run.taskText,
    protectPaths: caseDef.run.protectPaths,
    dependencyManifestsHumanReview: caseDef.run.dependencyManifestsHumanReview,
    optionalCommands: caseDef.run.optionalCommands,
    targetedFirst: caseDef.run.targetedFirst,
    testMappings: caseDef.run.testMappings,
    retryFlakyTests: caseDef.run.retryFlakyTests,
    allowFormatOnlyRemoval: caseDef.run.allowFormatOnlyRemoval,
    dryRun: false,
  };
  const shrinkStarted = Date.now();
  try {
    report = await shrink(runOptions);
  } catch (error) {
    shrinkError = String(error.message ?? error);
  }
  outcome.shrinkDurationMs = Date.now() - shrinkStarted;
  outcome.wallClockMs = Date.now() - startedAt;

  // Producer failure is acceptable ONLY for cases expecting unverified
  // outcomes via thrown baseline errors (flaky oracle).
  if (report === undefined) {
    const expectedUnverified = caseDef.expect.verified === false;
    const credible = expectedUnverified && /required command|timed out|failed|inconclusive/i.test(shrinkError ?? "");
    check("producer-failure-matches-expectation", credible, shrinkError ?? "no error");
    outcome.removedCount = 0;
    outcome.mode = "unverified (producer failed closed)";
    outcome.removedUnnecessary = false;
    outcome.runtimeConfirmed = false;
    outcome.ok = credible;
    return outcome;
  }

  writeFileSync(join(artifactsDir, `${caseDef.id}-report.json`), JSON.stringify(report, null, 2));
  if (report.patchPath && existsSync(report.patchPath)) {
    writeFileSync(join(artifactsDir, `${caseDef.id}-cleanup.diff`), readFileSync(report.patchPath, "utf8"), "utf8");
  }
  outcome.mode = report.mode;
  outcome.partial = report.partial ?? false;

  // Removal mapping and label gate (exact atom-identity mapping).
  const mapping = mapRemovalsToLabels(atoms, report);
  if (!mapping.ok) {
    check("removal-label-mapping", false, mapping.reason);
    outcome.removedUnnecessary = false;
    outcome.runtimeConfirmed = false;
    return outcome;
  }
  outcome.removedCount = mapping.mapped.length;
  outcome.removedLabels = mapping.mapped.map((entry) => entry.label);
  const badRemovals = mapping.mapped.filter((entry) => entry.label !== "unnecessary");
  check("no-necessary-automatic-removal", !badRemovals.some((entry) => entry.label === "necessary"), JSON.stringify(badRemovals));
  check("no-uncertain-automatic-removal", !badRemovals.some((entry) => entry.label === "uncertain"), JSON.stringify(badRemovals));

  // Removal policy expectations.
  if (caseDef.expect.removalsAllowed === false) {
    check("zero-removals-when-disallowed", report.removals.length === 0, `removed ${report.removals.length}`);
  }
  if (caseDef.expect.removedCountBounds) {
    const [min, max] = caseDef.expect.removedCountBounds;
    check("removed-count-bounds", report.removals.length >= min && report.removals.length <= max, `removed ${report.removals.length}, expected ${min}..${max}`);
  }
  if (caseDef.expect.retainedPaths) {
    const patchText = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    for (const path of caseDef.expect.retainedPaths) {
      check(`retained:${path}`, patchText.includes(path), "missing from cleanup patch");
    }
  }
  if (caseDef.expect.coarseMixedEvidenceRetained) {
    const path = caseDef.expect.coarseMixedEvidenceRetained;
    const patchText = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    const required = caseDef.labelRules.find((rule) => rule.path === path && rule.label === "necessary");
    check("coarse-mixed-evidence-retained", patchText.includes(path) && (!required || patchText.includes(required.contains)), "coarse required change not retained");
  }

  // Mode expectations.
  check(
    "mode-matches-expectation",
    caseDef.expect.verified ? report.mode === "verified" : report.mode !== "verified",
    `mode=${report.mode} partial=${String(report.partial)}`,
  );
  if (caseDef.expect.partialExpected) {
    check("partial-flagged", report.partial === true, `partial=${String(report.partial)}`);
  }

  // Independent verification of artifacts advertised as verified, including
  // the byte-level artifact delta assurance.
  const independent = await independentlyVerify(caseDef, cwd, report, scratchRoot, requiredCommands, python, {
    mapped: mapping.ok ? mapping.mapped : [],
    baseSha,
    headSha,
  });
  outcome.independent = independent;
  if (independent.advertisedVerified) {
    check("independent-apply-clean", independent.appliedClean, independent.error ?? "");
    check("independent-tree-matches-producer", independent.treeMatchesProducer, independent.error ?? "");
    check("artifact-delta-equals-matched-unnecessary-edits", independent.artifactDeltaOk, (independent.artifactDeltaFailures ?? []).join("; ") || (independent.error ?? ""));
    check("independent-oracle-passes", independent.oracleExitCodes.every((entry) => entry.exitCode === 0), JSON.stringify(independent.oracleExitCodes));
    check("independent-tree-unchanged-by-commands", independent.treeUnchangedByCommands, "");
    if (caseDef.heldOut) {
      check("held-out-necessary-behavior", independent.heldOutExitCode === 0, `exit ${String(independent.heldOutExitCode)}`);
    }
  }

  // Stage 2 — runtime-confirmed: an unnecessary atom was actually removed AND
  // the artifact was fully independently re-proven. A failed/unverified
  // removal NEVER grants runtime credit.
  const independentFullyPassed = independent.advertisedVerified &&
    independent.appliedClean === true &&
    independent.treeMatchesProducer === true &&
    independent.artifactDeltaOk === true &&
    independent.oracleExitCodes.length > 0 &&
    independent.oracleExitCodes.every((entry) => entry.exitCode === 0) &&
    independent.treeUnchangedByCommands === true &&
    (!caseDef.heldOut || independent.heldOutExitCode === 0);
  outcome.runtimeConfirmed =
    mapping.mapped.some((entry) => entry.label === "unnecessary") && independentFullyPassed;

  // Stage 3 — deletion (visibility only): at least one unnecessary atom
  // actually removed, regardless of verification outcome.
  outcome.removedUnnecessary = mapping.mapped.some((entry) => entry.label === "unnecessary");
  outcome.necessaryRemovals = mapping.mapped.filter((entry) => entry.label === "necessary").length;
  outcome.ok = outcome.checks.every((entry) => entry.passed);
  return outcome;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const implementation = {
    version: packageJson.version,
    workspaceHead: (() => {
      try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
      } catch {
        return "unavailable";
      }
    })(),
    distShrinkSha256: sha256(readFileSync(join(DIST, "packages/core/src/shrink.js"), "utf8")),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = join(HERE, "results", `${stamp}`);
  mkdirSync(resultsDir, { recursive: true });
  const scratchRoot = mkdtempSync(join(tmpdir(), "patchdiet-benchmark-"));

  const { cases } = await import(`file:///${join(HERE, "corpus", "cases.mjs").replaceAll("\\", "/")}`);
  const python = discoverPython();
  const outcomes = [];
  // BENCHMARK_ONLY=<id> runs a single case for focused diagnosis; results of
  // a filtered run are never comparable to a full-corpus run (the summary
  // says so explicitly).
  const onlyCase = process.env.BENCHMARK_ONLY;
  const selectedCases = onlyCase ? cases.filter((caseDef) => caseDef.id === onlyCase) : cases;
  if (onlyCase && selectedCases.length === 0) fail(`BENCHMARK_ONLY=${onlyCase} matches no corpus case`);
  for (const caseDef of selectedCases) {
    if (caseDef.language === "python" && python === undefined) {
      outcomes.push({
        id: caseDef.id,
        class: caseDef.class,
        ok: false,
        skipped: true,
        hasUnnecessaryLabel: true,
        staticDetected: false,
        runtimeConfirmed: false,
        removedUnnecessary: false,
        reason: "python interpreter unavailable; python corpus cases are applicable gates, not skippable",
      });
      continue;
    }
    process.stdout.write(`running ${caseDef.id} ... `);
    let outcome;
    try {
      outcome = await runCase(caseDef, scratchRoot, resultsDir, python);
    } catch (error) {
      outcome = { id: caseDef.id, class: caseDef.class, ok: false, checks: [{ name: "runner-exception", passed: false, detail: String(error.stack ?? error) }] };
    }
    outcomes.push(outcome);
    console.log(outcome.ok ? "OK" : "FAILED");
  }

  // Bounded awaited cleanup of owned scratch repositories (results stay).
  // BENCHMARK_KEEP=1 keeps the scratch fixture repositories for diagnosis
  // (never used in gate runs; the summary warns results were not cleaned).
  if (process.env.BENCHMARK_KEEP !== "1") {
    rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // ── Aggregate measurements: three stages + union, per class & combined ──
  const stages = aggregateStages(outcomes);
  const precision = removalPrecision(outcomes.filter((o) => !o.skipped).flatMap((o) => o.removedLabels ?? []));
  const advertisedVerified = outcomes.filter((o) => !o.skipped && o.independent?.advertisedVerified === true);
  const independentPassed = advertisedVerified.filter(
    (o) =>
      o.independent.appliedClean &&
      o.independent.treeMatchesProducer &&
      o.independent.artifactDeltaOk &&
      o.independent.oracleExitCodes.every((entry) => entry.exitCode === 0) &&
      o.independent.treeUnchangedByCommands &&
      (!o.heldOut || o.independent.heldOutExitCode === 0),
  ).length;
  const finalOracle = {
    numerator: independentPassed,
    denominator: advertisedVerified.length,
    rate: advertisedVerified.length === 0 ? undefined : independentPassed / advertisedVerified.length,
  };
  const hiddenRegressions = advertisedVerified.filter((o) => o.independent.heldOutRun && o.independent.heldOutExitCode !== 0).length;
  const successfulReductionCases = outcomes.filter((o) => !o.skipped && (o.removedCount ?? 0) > 0).map((o) => o.id);

  const classStages = {};
  for (const className of ["synthetic", "injected"]) {
    const classOutcomes = outcomes.filter((o) => o.class === className && !o.skipped);
    const classPrecision = removalPrecision(classOutcomes.flatMap((o) => o.removedLabels ?? []));
    classStages[className] = {
      inputCount: classOutcomes.length,
      atomLabelCounts: {
        necessary: classOutcomes.reduce((sum, o) => sum + (o.labelCounts?.necessary ?? 0), 0),
        unnecessary: classOutcomes.reduce((sum, o) => sum + (o.labelCounts?.unnecessary ?? 0), 0),
        uncertain: classOutcomes.reduce((sum, o) => sum + (o.labelCounts?.uncertain ?? 0), 0),
      },
      removalPrecision: classPrecision,
      stages: perClassStages(outcomes, className),
      cases: classOutcomes.map((o) => ({
        id: o.id, ok: o.ok, mode: o.mode,
        staticDetected: o.staticDetected === true,
        runtimeConfirmed: o.runtimeConfirmed === true,
        removedUnnecessary: o.removedUnnecessary === true,
        removedCount: o.removedCount ?? 0,
      })),
    };
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    implementation,
    gates: GATES,
    stageDefinitions: {
      staticDetection:
        "STAGE 1 (readonly, pre-reduction): public Scope Map ties an explicit task-exclusion intent record (category=intent, polarity=limits, exclusion detail) or a no-risk candidate classification to a prelabelled-unnecessary atom, matched by EXACT stable atom id. Static pre-analysis alone does not identify runtime redundancy; this rate is never advertised as >=80.",
      runtimeConfirmed:
        "STAGE 2: a labelled-unnecessary atom whose removal was actually delivered in an artifact advertised verified AND fully independently re-proven (exact-base apply, producer tree match, whole-tree byte-level delta equal to ONLY the matched unnecessary edits across every tracked HEAD path and Git mode (missing/added/untracked files and mode flips included), oracle after each command with per-command tree identity, held-out oracle). Failed/unverified removals never count.",
      deletion:
        "STAGE 3 (visibility only): fixtures with at least one labelled-unnecessary atom automatically removed, regardless of verification outcome. Never used as a detection gate.",
      fullPipelineDetection:
        "GATE METRIC: per-case UNION of stage 1 and stage 2, deduplicated; denominator = ALL original labelled cases containing unnecessary edits, including conservative misses and failed cases.",
    },
    corpus: {
      synthetic: classStages.synthetic,
      injected: classStages.injected,
      naturalAgentPRs: { sampleCount: 0, status: "NOT VERIFIED", note: "no human-labelled natural agent PR dataset is available; no substitute corpus may claim production precision" },
    },
    measurements: {
      inputCount: outcomes.filter((o) => !o.skipped).length,
      removedTotal: precision.denominator,
      removedUnnecessary: precision.numerator,
      removalPrecision: { ...precision, undefinedWhenZeroDenominator: true },
      stages,
      independentFinalOracle: { ...finalOracle, undefinedWhenZeroDenominator: true },
      hiddenRegressions,
      successfulReductionCases,
      timingsMs: Object.fromEntries(outcomes.filter((o) => !o.skipped).map((o) => [o.id, o.wallClockMs ?? null])),
    },
    perCase: outcomes,
  };
  writeFileSync(join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2));

  const rate = (stage) =>
    stage.rate === undefined ? "undefined (zero denominator)" : `${stage.numerator}/${stage.denominator} = ${(stage.rate * 100).toFixed(1)}%`;
  console.log("\n=== benchmark summary ===");
  console.log(`implementation: v${implementation.version} (workspace ${implementation.workspaceHead.slice(0, 12)}, dist shrink ${implementation.distShrinkSha256.slice(0, 12)})`);
  console.log(`removal precision: ${rate(precision)}`);
  console.log(`stage 1 static detection (public Scope Map): ${rate(stages.staticDetection)} (non-detected: ${stages.staticDetection.missCases.join(", ") || "none"})`);
  console.log(`stage 2 runtime-confirmed findings: ${rate(stages.runtimeConfirmed)} (misses: ${stages.runtimeConfirmed.missCases.join(", ") || "none"})`);
  console.log(`full-pipeline detection (static UNION runtime-confirmed): ${rate(stages.fullPipelineDetection)} (misses: ${stages.fullPipelineDetection.missCases.join(", ") || "none"})`);
  console.log(`stage 3 deletion rate (visibility only, NOT the detection gate): ${rate(stages.deletion)}`);
  console.log(`independent final oracle: ${rate(finalOracle)}`);
  console.log(`hidden regressions: ${hiddenRegressions}`);
  console.log(`natural agent PRs: sample count 0 (NOT VERIFIED)`);
  console.log(`results: ${resultsDir}`);

  // ── Gates ───────────────────────────────────────────────────────
  const gateFailures = evaluateGates({ stages, precision, finalOracle, hiddenRegressions, successfulReductionCases });
  const failedCases = outcomes.filter((outcome) => !outcome.ok);
  for (const failedCase of failedCases) {
    const failedChecks = (failedCase.checks ?? []).filter((entry) => !entry.passed);
    gateFailures.push(`case ${failedCase.id}: ${failedChecks.map((entry) => `${entry.name} (${entry.detail})`).join("; ") || "failed"}`);
  }
  if (gateFailures.length > 0) {
    console.error("\nGATE FAILURES:");
    for (const failure of gateFailures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log("\nALL APPLICABLE GATES PASSED");
}

await main();
