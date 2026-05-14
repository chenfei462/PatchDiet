import type { DiffFile, DiffHunk, DiffLine, DiffSummary, ParsedDiff } from "./types.js";

export function parseUnifiedDiff(input: string): ParsedDiff {
  const lines = input.split(/\r?\n/);
  const files: DiffFile[] = [];

  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = undefined;
      currentFile = undefined;
      continue;
    }

    if (line.startsWith("+++ b/")) {
      currentFile = {
        path: line.slice("+++ b/".length),
        hunks: []
      };
      files.push(currentFile);
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
