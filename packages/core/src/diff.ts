import type { DiffFile, DiffHunk, DiffLine, DiffSummary, ParsedDiff } from "./types.js";

export function parseUnifiedDiff(input: string): ParsedDiff {
  const lines = input.split(/\r?\n/);
  const files: DiffFile[] = [];

  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;
  let pendingOldPath: string | undefined;
  let pendingNewPath: string | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = undefined;
      currentFile = undefined;
      const paths = parseDiffGitPaths(line);
      pendingOldPath = paths?.oldPath;
      pendingNewPath = paths?.newPath;
      continue;
    }

    if (line.startsWith("--- a/")) {
      pendingOldPath = line.slice("--- a/".length);
      continue;
    }

    if (line.startsWith("+++ b/")) {
      pendingNewPath = line.slice("+++ b/".length);
      currentFile = {
        path: pendingNewPath,
        hunks: []
      };
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("Binary files ") && line.includes(" and ") && line.endsWith(" differ")) {
      const path = parseBinaryFilesPath(line);
      if (path) {
        files.push(createBinaryFile(path, "Binary files differ"));
      }
      currentFile = undefined;
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("GIT binary patch")) {
      const path = pendingNewPath ?? pendingOldPath;
      if (path) {
        files.push(createBinaryFile(path, "GIT binary patch"));
      }
      currentFile = undefined;
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!currentFile) {
        continue;
      }

      currentHunk = {
        header: line,
        lines: []
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
      continue;
    }

    currentHunk.lines.push(toContextLine(line));
  }

  return { files };
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

function toContextLine(line: string): DiffLine {
  if (line.startsWith(" ")) {
    return { kind: "context", text: line.slice(1) };
  }

  return { kind: "context", text: line };
}

function createBinaryFile(path: string, header: string): DiffFile {
  return {
    path,
    hunks: [
      {
        header,
        lines: [],
        binary: true
      }
    ]
  };
}

function parseDiffGitPaths(line: string): { oldPath: string; newPath: string } | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    oldPath: match[1],
    newPath: match[2]
  };
}

function parseBinaryFilesPath(line: string): string | undefined {
  const match = /^Binary files (.+) and (.+) differ$/.exec(line);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const oldPath = normalizeBinaryEndpoint(match[1]);
  const newPath = normalizeBinaryEndpoint(match[2]);
  return newPath ?? oldPath;
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
