import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────

/** One reducible change: a byte range in base replaced by a byte range in head. */
export interface SelectiveEdit {
  id: string;
  /** Inclusive start, exclusive end, UTF-8 byte offsets into baseText. */
  baseStartByte: number;
  baseEndByte: number;
  /** Inclusive start, exclusive end, UTF-8 byte offsets into headText. */
  headStartByte: number;
  headEndByte: number;
}

export interface SelectivePatchInput {
  /** Repo-relative forward-slash path the patch will be targeted at. */
  path: string;
  baseText: string;
  headText: string;
  /** The full set of edits that together transform baseText into headText. */
  edits: SelectiveEdit[];
  /** Ids of edits to RETAIN in the reduced patch; omitted ids revert to base. */
  keepEditIds?: string[];
  /** Set by the caller when the target is a symlink; encoding is rejected. */
  isSymlink?: boolean;
  /** Marks whole-file creation; the encoder refuses partial newfile edits. */
  isNewFile?: boolean;
  /** Marks whole-file deletion; the encoder refuses partial deletion edits. */
  isDeletedFile?: boolean;
}

export interface SelectivePatchResult {
  /** Unified diff baseText -> reducedText ("" when nothing is kept). */
  patch: string;
  /** baseText with only the kept edits applied. */
  reducedText: string;
}

export type HunkLineKind = "context" | "delete" | "add";

export interface HunkCoordinateLine {
  kind: HunkLineKind;
  /** 1-based base-side line number (context and delete lines). */
  baseLine?: number;
  /** 1-based head-side line number (context and add lines). */
  headLine?: number;
  /** The diff line verbatim, including its leading kind marker. */
  text: string;
}

export interface HunkCoordinates {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkCoordinateLine[];
  oldNoNewline: boolean;
  newNoNewline: boolean;
}

// ── encodeSelectivePatch ──────────────────────────────────────────

/**
 * Encode a reduced unified patch containing only the kept edits.
 *
 * The full edit set must exactly explain baseText -> headText; the reduced
 * text is baseText with only the kept edits applied, and the patch is
 * regenerated from scratch (fresh @@ headers and offsets) via a real
 * `git diff --no-index` run over temp files. Whole-file creation, deletion,
 * symlinks, binary content and mode metadata are rejected: the caller owns
 * those.
 */
export function encodeSelectivePatch(input: SelectivePatchInput): SelectivePatchResult {
  const { path, baseText, headText, edits, keepEditIds } = input;

  if (input.isSymlink) {
    throw new Error(
      `patch-encoder: refusing to encode symlink target ${JSON.stringify(path)}: the caller must handle symlinks`
    );
  }
  if (input.isNewFile) {
    throw new Error(
      `patch-encoder: ${JSON.stringify(path)} is a new file; whole-file creation (newfile metadata) is handled by the caller`
    );
  }
  if (input.isDeletedFile) {
    throw new Error(
      `patch-encoder: ${JSON.stringify(path)} is a fully deleted file; whole-file deletion is handled by the caller`
    );
  }
  assertEncodablePath(path);
  if (baseText.includes("\u0000") || headText.includes("\u0000")) {
    throw new Error(`patch-encoder: ${JSON.stringify(path)} looks binary (NUL byte); the caller must handle binary files`);
  }

  const baseBytes = Buffer.from(baseText, "utf8");
  const headBytes = Buffer.from(headText, "utf8");

  // Validate edit ids and byte ranges (bounds, UTF-8 boundaries, ordering).
  const seenIds = new Set<string>();
  for (const edit of edits) {
    if (seenIds.has(edit.id)) {
      throw new Error(`patch-encoder: duplicate edit id ${JSON.stringify(edit.id)}`);
    }
    seenIds.add(edit.id);
    if (
      !Number.isInteger(edit.baseStartByte) ||
      !Number.isInteger(edit.baseEndByte) ||
      !Number.isInteger(edit.headStartByte) ||
      !Number.isInteger(edit.headEndByte) ||
      edit.baseStartByte < 0 ||
      edit.headStartByte < 0 ||
      edit.baseStartByte > edit.baseEndByte ||
      edit.headStartByte > edit.headEndByte ||
      edit.baseEndByte > baseBytes.length ||
      edit.headEndByte > headBytes.length
    ) {
      throw new Error(`patch-encoder: edit ${JSON.stringify(edit.id)} has invalid byte ranges`);
    }
    for (const [bytes, start, end, side] of [
      [baseBytes, edit.baseStartByte, edit.baseEndByte, "base"],
      [headBytes, edit.headStartByte, edit.headEndByte, "head"],
    ] as const) {
      for (const offset of [start, end]) {
        if (!isUtf8Boundary(bytes, offset)) {
          throw new Error(
            `patch-encoder: edit ${JSON.stringify(edit.id)} ${side} range splits a UTF-8 codepoint at byte ${offset}`
          );
        }
      }
    }
  }

  const sortedByBase = [...edits].sort((a, b) => a.baseStartByte - b.baseStartByte);
  const sortedByHead = [...edits].sort((a, b) => a.headStartByte - b.headStartByte);
  for (const [sorted, side] of [
    [sortedByBase, "base"],
    [sortedByHead, "head"],
  ] as const) {
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]![side === "base" ? "baseStartByte" : "headStartByte"] <
          sorted[i - 1]![side === "base" ? "baseEndByte" : "headEndByte"]) {
        throw new Error(`patch-encoder: edits ${JSON.stringify(sorted[i - 1]!.id)} and ${JSON.stringify(sorted[i]!.id)} overlap on the ${side} side`);
      }
    }
  }

  // The full edit set must reconstruct headText from baseText exactly.
  const fullApply = applyEdits(baseBytes, headBytes, sortedByBase);
  if (!fullApply.equals(headBytes)) {
    throw new Error(
      `patch-encoder: edits do not fully explain the diff between base and head for ${JSON.stringify(path)}`
    );
  }

  // Build the reduced text from the kept subset only.
  const keep = new Set(keepEditIds ?? []);
  for (const id of keep) {
    if (!seenIds.has(id)) {
      throw new Error(`patch-encoder: keepEditIds references unknown edit id ${JSON.stringify(id)}`);
    }
  }
  const keptSorted = sortedByBase.filter((e) => keep.has(e.id));
  const reducedBytes = applyEdits(baseBytes, headBytes, keptSorted);
  const reducedText = reducedBytes.toString("utf8");

  if (reducedBytes.equals(baseBytes)) {
    return { patch: "", reducedText };
  }

  return { patch: diffViaGit(path, baseBytes, reducedBytes), reducedText };
}

/** Apply byte-range replacements (base coords) sourced from head, in order. */
function applyEdits(baseBytes: Buffer, headBytes: Buffer, edits: SelectiveEdit[]): Buffer {
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(baseBytes.subarray(cursor, edit.baseStartByte));
    parts.push(headBytes.subarray(edit.headStartByte, edit.headEndByte));
    cursor = edit.baseEndByte;
  }
  parts.push(baseBytes.subarray(cursor));
  return Buffer.concat(parts);
}

/** True when `offset` is a character boundary in a UTF-8 buffer. */
function isUtf8Boundary(bytes: Buffer, offset: number): boolean {
  if (offset <= 0 || offset >= bytes.length) {
    return true;
  }
  return (bytes[offset]! & 0xc0) !== 0x80;
}

function assertEncodablePath(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.includes("\u0000") || path.includes("\n")) {
    throw new Error(`patch-encoder: invalid path ${JSON.stringify(path)}`);
  }
  // Treat both separators as directory boundaries so ".." cannot slip
  // through as "src\\..\\..\\evil" and drive-relative forms ("C:evil") fail.
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s.length === 0 || s === "." || s === ".." || s === ".git")) {
    throw new Error(`patch-encoder: invalid path ${JSON.stringify(path)} (must be repo-relative, no ".", ".." or ".git" segments)`);
  }
  if (/:/.test(segments[0]!)) {
    throw new Error(`patch-encoder: invalid path ${JSON.stringify(path)} (drive-relative paths are not allowed)`);
  }
}

/**
 * Produce a unified diff for two buffers with git diff --no-index over temp
 * files, then rewrite the temp headers onto the real target path.
 */
function diffViaGit(path: string, baseBytes: Buffer, reducedBytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "patch-encoder-diff-"));
  try {
    const baseFile = join(dir, "base");
    const reducedFile = join(dir, "reduced");
    writeFileSync(baseFile, baseBytes);
    writeFileSync(reducedFile, reducedBytes);
    // Empty config so global/system gitconfig (external diff drivers,
    // attributes, autocrlf...) cannot produce a fake diff.
    const emptyConfig = join(dir, "empty-gitconfig");
    writeFileSync(emptyConfig, "");

    const res = spawnSync(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        `core.attributesFile=${emptyConfig}`,
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        "base",
        "reduced",
      ],
      {
        cwd: dir,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: emptyConfig,
          GIT_ATTR_NOSYSTEM: "1",
        },
      }
    );
    // git diff exits 1 when files differ (0 when identical) — both fine.
    if (res.status !== 0 && res.status !== 1) {
      const stderr = res.stderr?.toString("utf8") ?? "";
      throw new Error(`patch-encoder: git diff --no-index failed with status ${res.status}: ${stderr}`);
    }

    const out = res.stdout.toString("utf8");
    return rewriteDiffHeaders(out, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replace a/base-reduced temp paths with the real target path, quoted like git does. */
function rewriteDiffHeaders(diff: string, path: string): string {
  const lines = diff.split("\n");
  const header: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("@@")) {
      break;
    }
    if (line.startsWith("diff --git ")) {
      header.push(`diff --git ${quotePath(`a/${path}`)} ${quotePath(`b/${path}`)}`);
    } else if (line.startsWith("--- ")) {
      header.push(`--- ${quotePath(`a/${path}`)}`);
    } else if (line.startsWith("+++ ")) {
      header.push(`+++ ${quotePath(`b/${path}`)}`);
    } else {
      header.push(line);
    }
  }
  return [...header, ...lines.slice(i)].join("\n");
}

/** Quote a diff header path the way git does when it needs quoting. */
function quotePath(p: string): string {
  // Bare only when the path is printable ASCII without spaces, quotes or
  // backslashes; anything else (spaces, control chars, quotes, non-ASCII)
  // goes into double quotes. Control characters and non-ASCII use the same
  // escaping git accepts: \t \r \n, \" \\ and octal \NNN bytes.
  if (/^[\x20-\x7e]*$/.test(p) && !p.includes('"') && !p.includes("\\")) {
    return p;
  }
  let quoted = "";
  for (const byte of Buffer.from(p, "utf8")) {
    if (byte === 0x22) quoted += '\\"';
    else if (byte === 0x5c) quoted += "\\\\";
    else if (byte === 0x09) quoted += "\\t";
    else if (byte === 0x0a) quoted += "\\n";
    else if (byte === 0x0d) quoted += "\\r";
    // Control bytes and non-ASCII (>= 128) use git's octal escaping so the
    // raw UTF-8 bytes survive round-trips through tools that mangle them.
    else if (byte < 0x20 || byte >= 0x7f) quoted += `\\${byte.toString(8).padStart(3, "0")}`;
    else quoted += String.fromCharCode(byte);
  }
  return `"${quoted}"`;
}

// ── mapHunkCoordinates ────────────────────────────────────────────

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const FILE_HEADER_RE =
  /^(diff --git |index |--- |new file mode|deleted file mode|old mode|new mode|similarity index|rename |copy |Binary files|GIT binary patch)/;

/**
 * Parse a unified patch and map every hunk line to its 1-based base and head
 * line numbers. Zero-count sides carry no lines: for `@@ -N,0 ...` the old
 * start N is the line AFTER which content is inserted; for `@@ ... +M,0 @@`
 * the new start M is the line after which content is deleted. Hunks are
 * consumed strictly by their declared counts, so multi-file patches with
 * several hunks parse correctly and count mismatches are rejected.
 */
export function mapHunkCoordinates(patch: string): HunkCoordinates[] {
  const hunks: HunkCoordinates[] = [];
  let current: HunkCoordinates | null = null;
  let nextBase = 0;
  let nextHead = 0;
  let oldConsumed = 0;
  let newConsumed = 0;

  const hunkComplete = (): boolean =>
    current !== null && oldConsumed === current.oldCount && newConsumed === current.newCount;

  const endHunk = (): void => {
    current = null;
  };

  const lines = patch.replace(/\n$/, "").split("\n");
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current !== null && !hunkComplete()) {
        throw new Error(
          `patch-encoder: hunk declared ${current.oldCount} old / ${current.newCount} new lines but only ${oldConsumed} / ${newConsumed} were present`
        );
      }
      const match = HUNK_HEADER_RE.exec(line);
      if (!match) {
        throw new Error(`patch-encoder: malformed hunk header: ${JSON.stringify(line)}`);
      }
      current = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
        oldNoNewline: false,
        newNoNewline: false,
      };
      nextBase = current.oldStart;
      nextHead = current.newStart;
      oldConsumed = 0;
      newConsumed = 0;
      hunks.push(current);
      continue;
    }

    if (current !== null && hunkComplete()) {
      // Hunk fully consumed: only "\ No newline" markers may still follow;
      // blank separators and file headers end the hunk, anything else is an
      // undeclared extra line.
      if (line.startsWith("\\")) {
        attachNoNewline(current, current.lines[current.lines.length - 1]);
        continue;
      }
      if (line === "" || FILE_HEADER_RE.test(line)) {
        endHunk();
        continue;
      }
      throw new Error(
        `patch-encoder: hunk declared ${current.oldCount} old / ${current.newCount} new lines but extra content follows: ${JSON.stringify(line)}`
      );
    }

    if (current === null) {
      continue; // file headers, comments, blank separators
    }

    const marker = line[0];
    if (marker === "\\") {
      attachNoNewline(current, current.lines[current.lines.length - 1]);
      continue;
    }

    if (marker === " " || marker === "-" || marker === "+") {
      // While counts are unconsumed, every line is content — even one that
      // happens to start with "---" or "+++".
      if (marker === " ") {
        if (oldConsumed >= current.oldCount || newConsumed >= current.newCount) {
          throw new Error(
            `patch-encoder: hunk declared ${current.oldCount} old / ${current.newCount} new lines but extra content follows: ${JSON.stringify(line)}`
          );
        }
        current.lines.push({
          kind: "context",
          baseLine: nextBase++,
          headLine: nextHead++,
          text: line,
        });
        oldConsumed++;
        newConsumed++;
      } else if (marker === "-") {
        if (oldConsumed >= current.oldCount) {
          throw new Error(
            `patch-encoder: hunk declared ${current.oldCount} old lines but extra delete content follows: ${JSON.stringify(line)}`
          );
        }
        current.lines.push({ kind: "delete", baseLine: nextBase++, text: line });
        oldConsumed++;
      } else {
        if (newConsumed >= current.newCount) {
          throw new Error(
            `patch-encoder: hunk declared ${current.newCount} new lines but extra add content follows: ${JSON.stringify(line)}`
          );
        }
        current.lines.push({ kind: "add", headLine: nextHead++, text: line });
        newConsumed++;
      }
      continue;
    }

    if (line === "") {
      // git renders an empty context line as a single space, but tolerates a
      // truly empty line as empty context; do the same while counts are
      // pending, otherwise treat it as the end of the hunk.
      if (!hunkComplete()) {
        if (oldConsumed >= current.oldCount || newConsumed >= current.newCount) {
          throw new Error(
            `patch-encoder: hunk declared ${current.oldCount} old / ${current.newCount} new lines but a blank line appeared before completion`
          );
        }
        current.lines.push({
          kind: "context",
          baseLine: nextBase++,
          headLine: nextHead++,
          text: " ",
        });
        oldConsumed++;
        newConsumed++;
        continue;
      }
      endHunk();
      continue;
    }

    throw new Error(`patch-encoder: unrecognized diff line: ${JSON.stringify(line)}`);
  }

  if (current !== null && !hunkComplete()) {
    throw new Error(
      `patch-encoder: hunk declared ${current.oldCount} old / ${current.newCount} new lines but only ${oldConsumed} / ${newConsumed} were present`
    );
  }

  return hunks;
}

/** Attach a "\ No newline at end of file" marker to the right side(s). */
function attachNoNewline(hunk: HunkCoordinates, last: HunkCoordinateLine | undefined): void {
  if (last?.kind === "add") {
    hunk.newNoNewline = true;
  } else if (last?.kind === "delete") {
    hunk.oldNoNewline = true;
  } else if (last?.kind === "context") {
    // A context line without a trailing newline means BOTH sides end here.
    hunk.oldNoNewline = true;
    hunk.newNoNewline = true;
  }
}
