import type { DiffFile, DiffHunk, DiffLine, DiffSummary, ParsedDiff } from "./types.js";

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/**
 * Parses a git-style (or plain) unified diff into structured files/hunks/lines.
 *
 * Fidelity rules enforced here (review finding H4):
 * - Deleted files (`+++ /dev/null`) register an entry marked `isDelete` instead
 *   of silently disappearing from the report.
 * - Pure renames/copies (`rename from`/`rename to` with no hunks) register an
 *   entry marked `isRename` with a placeholder hunk.
 * - Quoted paths (git core.quotepath, e.g. `"src/\346\226\207.txt"`) are decoded
 *   from git's octal escape form, and unquoted names keep their spaces while the
 *   git tab terminator is stripped.
 * - Content lines keep their trailing `\r`, so CRLF files round-trip instead of
 *   being misjudged by reverse application.
 * - `\ No newline at end of file` markers attach to the preceding line
 *   (`noNewlineAfter`) instead of being parsed as a context line.
 * - Content lines that happen to look like file headers (`--- a/x` from a
 *   removed `-- a/x`, `+++ b/x` from an added `++ b/x`) never truncate a hunk
 *   while the hunk's declared line counts are not yet consumed.
 * - The extended header block (modes, rename/copy, similarity, index, quoted
 *   `diff --git` line) is captured verbatim so `serializeUnifiedDiff` can
 *   reproduce the input byte-for-byte.
 */
export function parseUnifiedDiff(input: string): ParsedDiff {
  const lines = input.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    // A trailing newline produces one empty element; drop it so it is not read
    // as a phantom context line of the final hunk.
    lines.pop();
  }

  const files: DiffFile[] = [];

  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;
  let hunkCounts: { oldLeft: number; newLeft: number } | undefined;
  let inBinaryBody = false;

  let sectionHeaders: string[] = [];
  let sectionOldPath: string | undefined;
  let sectionNewPath: string | undefined;
  let sectionIsNew = false;
  let sectionIsDelete = false;
  let sectionIsRename = false;
  let sectionRenameKind: "rename" | "copy" = "rename";
  let sectionFileCreated = false;

  function resetSection(): void {
    sectionHeaders = [];
    sectionOldPath = undefined;
    sectionNewPath = undefined;
    sectionIsNew = false;
    sectionIsDelete = false;
    sectionIsRename = false;
    sectionRenameKind = "rename";
    sectionFileCreated = false;
    currentFile = undefined;
    currentHunk = undefined;
    hunkCounts = undefined;
  }

  function sectionHasPaths(): boolean {
    return sectionOldPath !== undefined || sectionNewPath !== undefined;
  }

  function hunkComplete(): boolean {
    return hunkCounts !== undefined && hunkCounts.oldLeft <= 0 && hunkCounts.newLeft <= 0;
  }

  function createFileEntryFromSection(): DiffFile | undefined {
    if (!sectionHasPaths()) {
      return undefined;
    }

    const path = sectionIsDelete
      ? sectionOldPath ?? sectionNewPath
      : sectionNewPath ?? sectionOldPath;
    if (path === undefined) {
      return undefined;
    }

    currentFile = {
      path,
      oldPath: sectionIsRename ? sectionOldPath : sectionIsDelete ? path : undefined,
      isRename: sectionIsRename || undefined,
      isNew: sectionIsNew || undefined,
      isDelete: sectionIsDelete || undefined,
      hunks: [],
      extendedHeaders: sectionHeaders.length > 0 ? [...sectionHeaders] : undefined
    };
    files.push(currentFile);
    sectionFileCreated = true;
    return currentFile;
  }

  function finalizePendingSection(): void {
    if (sectionFileCreated) {
      return;
    }
    const created = createFileEntryFromSection();
    if (created && sectionIsRename) {
      // Pure renames/copies carry no hunks of their own; register a placeholder
      // so the change stays visible in summaries and candidate evaluation.
      created.hunks.push({
        header: `${sectionRenameKind} ${sectionOldPath ?? created.path} -> ${created.path}`,
        lines: []
      });
    }
  }

  function beginHunk(headerLine: string): void {
    if (!currentFile && !createFileEntryFromSection()) {
      return;
    }
    currentHunk = { header: headerLine, lines: [] };
    currentFile!.hunks.push(currentHunk);
    hunkCounts = parseHunkHeaderCounts(headerLine);
  }

  function handleOldPathHeader(headerLine: string): void {
    if (sectionFileCreated && (currentHunk === undefined || hunkComplete())) {
      // A "--- " line after a finished entry starts the next file in a plain
      // unified diff that has no "diff --git" separators.
      resetSection();
    }
    sectionHeaders.push(headerLine);
    if (headerLine.startsWith("--- /dev/null")) {
      sectionIsNew = true;
      return;
    }
    const path = parseHeaderPath(headerLine.slice("--- ".length));
    if (path !== undefined) {
      sectionOldPath = path;
    }
  }

  function handleNewPathHeader(headerLine: string): void {
    if (sectionFileCreated && (currentHunk === undefined || hunkComplete())) {
      resetSection();
    }
    sectionHeaders.push(headerLine);
    if (headerLine.startsWith("+++ /dev/null")) {
      sectionIsDelete = true;
      return;
    }
    const path = parseHeaderPath(headerLine.slice("+++ ".length));
    if (path !== undefined) {
      sectionNewPath = path;
    }
  }

  function handleExtendedHeader(headerLine: string): void {
    const renameFrom = /^(?:rename|copy) from (.+)$/.exec(headerLine);
    if (renameFrom?.[1]) {
      sectionHeaders.push(headerLine);
      sectionOldPath = decodeGitHeaderValue(renameFrom[1]);
      sectionIsRename = true;
      sectionRenameKind = headerLine.startsWith("copy ") ? "copy" : "rename";
      return;
    }

    const renameTo = /^(rename|copy) to (.+)$/.exec(headerLine);
    if (renameTo?.[2]) {
      sectionHeaders.push(headerLine);
      sectionNewPath = decodeGitHeaderValue(renameTo[2]);
      sectionIsRename = true;
      sectionRenameKind = renameTo[1] === "copy" ? "copy" : "rename";
      return;
    }

    if (!isKnownExtendedHeader(headerLine)) {
      // Commit messages and other non-diff text must not leak into the
      // captured header block.
      return;
    }

    sectionHeaders.push(headerLine);
    if (headerLine.startsWith("new file mode ")) {
      sectionIsNew = true;
    } else if (headerLine.startsWith("deleted file mode ")) {
      sectionIsDelete = true;
    }
  }

  function markNoNewlineAfterPreviousLine(): void {
    const lines2 = currentHunk?.lines;
    if (lines2 && lines2.length > 0) {
      lines2[lines2.length - 1]!.noNewlineAfter = true;
    }
  }

  function pushContentLine(line: string): void {
    if (!currentHunk) {
      return;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
      if (hunkCounts) {
        hunkCounts.newLeft -= 1;
      }
      return;
    }

    if (line.startsWith("-")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
      if (hunkCounts) {
        hunkCounts.oldLeft -= 1;
      }
      return;
    }

    const text = line.startsWith(" ") ? line.slice(1) : line;
    currentHunk.lines.push({ kind: "context", text });
    if (hunkCounts) {
      hunkCounts.oldLeft -= 1;
      hunkCounts.newLeft -= 1;
    }
  }

  function createBinaryFileEntry(header: string, path: string | undefined): void {
    currentFile = undefined;
    currentHunk = undefined;
    hunkCounts = undefined;
    sectionFileCreated = true;
    if (!path) {
      return;
    }
    currentFile = {
      path,
      // Typed metadata mirrors createFileEntryFromSection so classification
      // (new/deleted/renamed binary sections) works without re-parsing headers.
      oldPath: sectionIsRename ? sectionOldPath : sectionIsDelete ? path : undefined,
      isRename: sectionIsRename || undefined,
      isNew: sectionIsNew || undefined,
      isDelete: sectionIsDelete || undefined,
      extendedHeaders: sectionHeaders.length > 0 ? [...sectionHeaders] : undefined,
      binarySection: [header],
      hunks: [{ header, lines: [], binary: true }]
    };
    files.push(currentFile);
  }

  for (const line of lines) {
    // Structural/header matching ignores the trailing "\r" so CRLF-transported
    // diffs parse the same as LF ones; content lines keep the raw "\r" so CRLF
    // file content survives parsing (see pushContentLine).
    const headerLine = line.endsWith("\r") ? line.slice(0, -1) : line;

    if (inBinaryBody) {
      // Payload of a "GIT binary patch" section is captured verbatim (raw line
      // including any "\r") until the next "diff --git" separator.
      if (!headerLine.startsWith("diff --git ")) {
        currentFile?.binarySection?.push(line);
        continue;
      }
      inBinaryBody = false;
    }

    if (headerLine.startsWith("diff --git ")) {
      finalizePendingSection();
      resetSection();
      sectionHeaders.push(headerLine);
      const paths = parseDiffGitPaths(headerLine);
      if (paths) {
        sectionOldPath = paths.oldPath;
        sectionNewPath = paths.newPath;
      }
      continue;
    }

    if (currentHunk) {
      if (headerLine.startsWith("@@ ")) {
        beginHunk(headerLine);
        continue;
      }

      if (line.startsWith("\\")) {
        markNoNewlineAfterPreviousLine();
        continue;
      }

      if (hunkComplete() && (headerLine.startsWith("--- ") || headerLine.startsWith("+++ "))) {
        // The hunk's declared line counts are consumed, so this really is the
        // next file header. While counts remain, the same text is content (a
        // removed "-- a/x" or added "++ b/x" line) and must not truncate the
        // hunk.
        if (headerLine.startsWith("--- ")) {
          handleOldPathHeader(headerLine);
        } else {
          handleNewPathHeader(headerLine);
        }
        continue;
      }

      pushContentLine(line);
      continue;
    }

    if (headerLine.startsWith("--- ")) {
      handleOldPathHeader(headerLine);
      continue;
    }

    if (headerLine.startsWith("+++ ")) {
      handleNewPathHeader(headerLine);
      continue;
    }

    if (headerLine.startsWith("@@ ")) {
      beginHunk(headerLine);
      continue;
    }

    if (
      headerLine.startsWith("Binary files ")
      && headerLine.includes(" and ")
      && headerLine.endsWith(" differ")
    ) {
      createBinaryFileEntry(headerLine, parseBinaryFilesPath(headerLine));
      continue;
    }

    if (headerLine === "GIT binary patch") {
      createBinaryFileEntry(headerLine, sectionNewPath ?? sectionOldPath);
      inBinaryBody = true;
      continue;
    }

    handleExtendedHeader(headerLine);
  }

  finalizePendingSection();

  return { files };
}

/**
 * Serializes a parsed diff back into unified diff text.
 *
 * Sections whose extended header block was captured during parsing are
 * reproduced byte-for-byte (modes, rename/copy headers, quoted paths, the
 * `diff --git` line). Binary sections (`GIT binary patch` payloads and
 * `Binary files … differ` lines) are re-emitted verbatim from
 * `binarySection`, so a round-trip is byte-exact for every section git
 * produces. Files built programmatically without captured headers get a
 * minimal reconstruction from their typed fields. `\ No newline at end of
 * file` markers are re-emitted from `noNewlineAfter` flags.
 */
export function serializeUnifiedDiff(parsed: ParsedDiff): string {
  return parsed.files.map(serializeFileSection).join("");
}

function serializeFileSection(file: DiffFile): string {
  const parts = file.extendedHeaders ? [...file.extendedHeaders] : buildDefaultHeaders(file);

  if (file.binarySection && file.binarySection.length > 0) {
    parts.push(...file.binarySection);
  }

  for (const hunk of file.hunks) {
    if (isSyntheticHunk(hunk)) {
      continue;
    }
    parts.push(hunk.header);
    for (const line of hunk.lines) {
      parts.push(serializeDiffLine(line));
      if (line.noNewlineAfter) {
        parts.push(NO_NEWLINE_MARKER);
      }
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return `${parts.join("\n")}\n`;
}

function isSyntheticHunk(hunk: DiffHunk): boolean {
  // Placeholder hunks (pure rename/copy registration, binary summaries) have no
  // parsed content and are already represented by the file's header block.
  if (hunk.binary) {
    return true;
  }
  return hunk.lines.length === 0 && !hunk.header.startsWith("@@ ");
}

function serializeDiffLine(line: DiffLine): string {
  const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  return `${prefix}${line.text}`;
}

function buildDefaultHeaders(file: DiffFile): string[] {
  const oldPath = file.oldPath ?? file.path;
  const hasContent = file.hunks.some((hunk) => !isSyntheticHunk(hunk));
  const headers: string[] = [
    `diff --git ${quoteGitPath(`a/${oldPath}`)} ${quoteGitPath(`b/${file.path}`)}`
  ];

  if (file.isRename && file.oldPath) {
    headers.push(`rename from ${file.oldPath}`);
    headers.push(`rename to ${file.path}`);
  }

  if (!file.isRename || hasContent) {
    headers.push(`--- ${file.isNew ? "/dev/null" : quoteGitPath(`a/${oldPath}`)}`);
    headers.push(`+++ ${file.isDelete ? "/dev/null" : quoteGitPath(`b/${file.path}`)}`);
  }

  return headers;
}

export function summarizeDiff(parsed: ParsedDiff): DiffSummary {
  const fileCount = parsed.files.length;
  const hunkCount = parsed.files.reduce((sum, file) => sum + file.hunks.length, 0);
  const lineKinds = parsed.files
    .flatMap((file) => file.hunks)
    .flatMap((hunk) => hunk.lines)
    .map((line) => line.kind);

  const addedLineCount = lineKinds.filter((kind) => kind === "add").length;
  const removedLineCount = lineKinds.filter((kind) => kind === "remove").length;

  return {
    fileCount,
    hunkCount,
    addedLineCount,
    removedLineCount,
    changedLineCount: addedLineCount + removedLineCount
  };
}

function parseHunkHeaderCounts(headerLine: string): { oldLeft: number; newLeft: number } | undefined {
  const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(headerLine);
  if (!match) {
    return undefined;
  }
  return {
    oldLeft: match[1] !== undefined ? Number.parseInt(match[1], 10) : 1,
    newLeft: match[2] !== undefined ? Number.parseInt(match[2], 10) : 1
  };
}

function isKnownExtendedHeader(headerLine: string): boolean {
  return /^index \S+\.\.\S+(?: \d+)?$/.test(headerLine)
    || /^(?:new|deleted) file mode \d+$/.test(headerLine)
    || /^(?:old|new) mode \d+$/.test(headerLine)
    || /^similarity index \d+%$/.test(headerLine)
    || /^dissimilarity index \d+%$/.test(headerLine);
}

/** Extracts the old/new path from a `diff --git a/x b/y` line, quoted or not. */
function parseDiffGitPaths(line: string): { oldPath: string; newPath: string } | undefined {
  const rest = line.slice("diff --git ".length);

  if (rest.startsWith('"')) {
    const first = splitQuotedToken(rest);
    if (!first) {
      return undefined;
    }
    const oldPath = stripSidePrefix(decodeGitPath(first.token));
    const newPath = stripSidePrefix(decodeGitPath(first.remainder));
    if (!oldPath || !newPath) {
      return undefined;
    }
    return { oldPath, newPath };
  }

  // Greedy so the last " b/" separates the two endpoints; git only leaves
  // space-containing paths unquoted here when the split is unambiguous.
  const match = /^a\/(.+) b\/(.+)$/.exec(rest);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { oldPath: match[1], newPath: match[2] };
}

/** Splits a leading `"…"` token (with escapes) off `rest` and returns the remainder. */
function splitQuotedToken(rest: string): { token: string; remainder: string } | undefined {
  for (let index = 1; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"') {
      const token = rest.slice(0, index + 1);
      let remainder = rest.slice(index + 1);
      if (remainder.startsWith(" ")) {
        remainder = remainder.slice(1);
      }
      return { token, remainder };
    }
  }
  return undefined;
}

function findClosingQuote(token: string): number | undefined {
  for (let index = 1; index < token.length; index += 1) {
    const char = token[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"') {
      return index;
    }
  }
  return undefined;
}

/**
 * Extracts the path from a `--- `/`+++ ` value. Handles quoted paths, the tab
 * terminator git appends after names containing spaces, and /dev/null.
 */
function parseHeaderPath(token: string): string | undefined {
  if (token.startsWith('"')) {
    const closing = findClosingQuote(token);
    if (closing === undefined) {
      return undefined;
    }
    return stripSidePrefix(decodeGitPath(token.slice(0, closing + 1)));
  }

  const tabAt = token.indexOf("\t");
  const raw = tabAt === -1 ? token : token.slice(0, tabAt);
  return stripSidePrefix(raw);
}

function stripSidePrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function decodeGitHeaderValue(value: string): string {
  return value.startsWith('"') ? decodeGitPath(value) : value;
}

/**
 * Decodes a git-quoted path (`"src/\346\226\207.txt"`) into its real value,
 * resolving standard C escapes and octal byte escapes as UTF-8. Unquoted input
 * is returned unchanged.
 */
function decodeGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }

  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    index += 1;
    const escape = inner[index];
    if (escape === undefined) {
      bytes.push(0x5c);
      continue;
    }
    switch (escape) {
      case "a": bytes.push(0x07); break;
      case "b": bytes.push(0x08); break;
      case "t": bytes.push(0x09); break;
      case "n": bytes.push(0x0a); break;
      case "v": bytes.push(0x0b); break;
      case "f": bytes.push(0x0c); break;
      case "r": bytes.push(0x0d); break;
      case '"': bytes.push(0x22); break;
      case "\\": bytes.push(0x5c); break;
      default: {
        if (escape >= "0" && escape <= "7") {
          let value = 0;
          let digits = 0;
          while (digits < 3 && index < inner.length) {
            const digit = inner[index];
            if (digit === undefined || digit < "0" || digit > "7") {
              break;
            }
            value = value * 8 + (digit.charCodeAt(0) - 0x30);
            digits += 1;
            index += 1;
          }
          index -= 1;
          bytes.push(value & 0xff);
        } else {
          bytes.push(escape.charCodeAt(0) & 0xff);
        }
      }
    }
  }
  return decodeUtf8Bytes(bytes);
}

function decodeUtf8Bytes(bytes: number[]): string {
  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
      index += 1;
      continue;
    }

    let sequenceLength = 0;
    let codePoint = 0;
    if ((byte & 0xe0) === 0xc0) {
      sequenceLength = 2;
      codePoint = byte & 0x1f;
    } else if ((byte & 0xf0) === 0xe0) {
      sequenceLength = 3;
      codePoint = byte & 0x0f;
    } else if ((byte & 0xf8) === 0xf0) {
      sequenceLength = 4;
      codePoint = byte & 0x07;
    } else {
      result += "\uFFFD";
      index += 1;
      continue;
    }

    if (index + sequenceLength > bytes.length) {
      result += "\uFFFD";
      index += 1;
      continue;
    }

    let valid = true;
    for (let offset = 1; offset < sequenceLength; offset += 1) {
      const continuation = bytes[index + offset]!;
      if ((continuation & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (!valid || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      result += "\uFFFD";
      index += 1;
      continue;
    }

    result += String.fromCodePoint(codePoint);
    index += sequenceLength;
  }
  return result;
}

/** Extracts the surviving path from a `Binary files a and b differ` line. */
function parseBinaryFilesPath(line: string): string | undefined {
  const rest = line.slice("Binary files ".length, line.length - " differ".length);
  const [oldToken, newToken] = splitBinaryEndpoints(rest);
  const oldPath = normalizeBinaryEndpoint(decodeGitHeaderValue(oldToken));
  const newPath = normalizeBinaryEndpoint(decodeGitHeaderValue(newToken));
  return newPath ?? oldPath;
}

function splitBinaryEndpoints(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const closing = findClosingQuote(rest);
    if (closing !== undefined) {
      const first = rest.slice(0, closing + 1);
      const remainder = rest.slice(closing + 1);
      const andAt = remainder.indexOf(" and ");
      const second = andAt === -1 ? "" : remainder.slice(andAt + " and ".length);
      return [first, second];
    }
  }

  const andAt = rest.indexOf(" and ");
  if (andAt === -1) {
    return [rest, ""];
  }
  return [rest.slice(0, andAt), rest.slice(andAt + " and ".length)];
}

function normalizeBinaryEndpoint(value: string): string | undefined {
  if (value === "/dev/null") {
    return undefined;
  }

  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }

  return value;
}

/** Re-quotes a path the way git does (control chars, quote, backslash, non-ASCII). */
function quoteGitPath(prefixedPath: string): string {
  if (!/["\\\u0000-\u001f\u007f-\uffff]/.test(prefixedPath)) {
    return prefixedPath;
  }

  let quoted = '"';
  for (const char of prefixedPath) {
    const code = char.codePointAt(0)!;
    if (char === '"') {
      quoted += '\\"';
    } else if (char === "\\") {
      quoted += "\\\\";
    } else if (code < 0x20 || code >= 0x7f) {
      for (const byte of utf8Bytes(code)) {
        quoted += `\\${byte.toString(8).padStart(3, "0")}`;
      }
    } else {
      quoted += char;
    }
  }
  return `${quoted}"`;
}

function utf8Bytes(codePoint: number): number[] {
  if (codePoint < 0x80) {
    return [codePoint];
  }
  if (codePoint < 0x800) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  }
  if (codePoint < 0x10000) {
    return [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f)
  ];
}
