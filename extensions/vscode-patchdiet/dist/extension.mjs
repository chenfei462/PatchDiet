// extension.mjs
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

// ../../packages/core/src/insights.ts
function estimateReviewMinutes(summary) {
  return Math.max(1, Math.ceil(summary.changedLineCount / 20 + summary.fileCount * 0.75 + summary.hunkCount * 0.5));
}
function percentReduced(before, after) {
  if (before <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((before - after) / before * 100)));
}
function buildReviewMetrics(report) {
  const reviewMinutesBefore = estimateReviewMinutes(report.input);
  const reviewMinutesAfter = estimateReviewMinutes(report.output);
  const suggestedDeletionHunks = report.removals.length;
  return {
    before: { fileCount: report.input.fileCount, hunkCount: report.input.hunkCount, changedLineCount: report.input.changedLineCount },
    after: { fileCount: report.output.fileCount, hunkCount: report.output.hunkCount, changedLineCount: report.output.changedLineCount },
    changedLineReductionPercent: percentReduced(report.input.changedLineCount, report.output.changedLineCount),
    fileReductionPercent: percentReduced(report.input.fileCount, report.output.fileCount),
    hunkReductionPercent: percentReduced(report.input.hunkCount, report.output.hunkCount),
    savedReviewTimePercent: percentReduced(reviewMinutesBefore, reviewMinutesAfter),
    suggestedDeletionHunks,
    reviewMinutesBefore,
    reviewMinutesAfter
  };
}
function analyzeDiffPreview(diff, options) {
  const lines = diff.split(/\r?\n/);
  const files = [];
  let currentFile;
  let currentHunk;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = void 0;
      currentFile = void 0;
      continue;
    }
    if (line.startsWith("--- a/")) continue;
    if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length);
      currentFile = { path, hunks: [] };
      files.push(currentFile);
      currentHunk = void 0;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!currentFile) continue;
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
    } else {
      currentHunk.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  const suggestions = files.flatMap((file) => {
    const category = classifyPreviewFile(file.path);
    if (!category) return [];
    return file.hunks.map((hunk) => ({
      filePath: file.path,
      hunkHeader: hunk.header,
      category,
      reason: previewReason(category),
      verificationReceipt: previewVerificationReceipt()
    }));
  });
  const suggestedPaths = new Set(suggestions.map((s) => s.filePath));
  const keptFiles = files.filter((f) => !suggestedPaths.has(f.path));
  const input = {
    fileCount: files.length,
    hunkCount: files.reduce((s, f) => s + f.hunks.length, 0),
    addedLineCount: files.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "add").length,
    removedLineCount: files.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "remove").length,
    changedLineCount: 0
  };
  input.changedLineCount = input.addedLineCount + input.removedLineCount;
  const output = {
    fileCount: keptFiles.length,
    hunkCount: keptFiles.reduce((s, f) => s + f.hunks.length, 0),
    addedLineCount: keptFiles.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "add").length,
    removedLineCount: keptFiles.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "remove").length,
    changedLineCount: 0
  };
  output.changedLineCount = output.addedLineCount + output.removedLineCount;
  const metrics = buildReviewMetrics({
    baseRef: "",
    headRef: "",
    input,
    output,
    testCommand: { command: "", status: "not-run", durationMs: 0, attempts: 1 },
    candidates: [],
    removals: suggestions,
    kept: [],
    needsHumanReview: [],
    artifacts: []
  });
  return {
    projectName: options.projectName,
    mode: "preview",
    verificationStatus: "preview-only",
    input,
    output,
    metrics,
    suggestions,
    disclaimer: "Web demo preview uses local diff heuristics only. Run patchdiet shrink for test-verified cleanup decisions.",
    judgeMode: {
      headline: "Live PR Liposuction",
      hook: "AI wrote more. Humans review less.",
      verificationStatus: "preview-only",
      verificationReceipt: previewVerificationReceipt(),
      reviewNoiseRemovedPercent: metrics.changedLineReductionPercent,
      humanAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
      cliProofCommand: 'patchdiet shrink --test "npm test"'
    }
  };
}
function classifyPreviewFile(filePath) {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (normalized === "readme.md" || normalized.startsWith("docs/") || normalized.endsWith(".md") || normalized.endsWith(".mdx") || normalized.endsWith(".txt")) {
    return "docs-only";
  }
  if (normalized.startsWith("dist/") || normalized.includes("/dist/") || normalized.startsWith("build/") || normalized.includes("/build/") || normalized.endsWith(".generated.ts") || normalized.endsWith(".generated.js") || normalized.endsWith(".min.js") || normalized.endsWith(".snap")) {
    return "generated-like";
  }
  return void 0;
}
function previewReason(category) {
  switch (category) {
    case "docs-only":
      return "preview candidate: docs-only change that may be outside the PR intent";
    case "generated-like":
      return "preview candidate: generated-like artifact that reviewers may not need to inspect";
    default:
      return "preview candidate: run patchdiet shrink to verify with tests";
  }
}
function previewVerificationReceipt() {
  return 'Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test "npm test"; only removals that still pass checks should be treated as verified.';
}

// extension.mjs
var execFileAsync = promisify(execFile);
var lastReport = "Run PatchDiet: Analyze Current Git Diff first.";
var latestCandidates = [];
var treeDataProvider;
function activate(context) {
  treeDataProvider = new PatchDietCandidatesProvider();
  const treeView = vscode.window.createTreeView("patchdiet.candidates", { treeDataProvider });
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("patchdiet.analyzeDiff", async () => {
      const workspace2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspace2) {
        vscode.window.showWarningMessage("Open a workspace before running PatchDiet.");
        return;
      }
      if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage("PatchDiet analysis failed: Workspace is not trusted. Run `patchdiet.analyzeDiff` only in a trusted workspace.");
        return;
      }
      const config = vscode.workspace.getConfiguration("patchdiet");
      const diffCommand = config.get("diffCommand", "git diff origin/main...HEAD");
      const diffArgs = parseTrustedGitDiffCommand(diffCommand);
      if (!diffArgs) {
        vscode.window.showErrorMessage("PatchDiet analysis failed: diffCommand contains untrusted content. Use only safe git commands.");
        return;
      }
      try {
        const diff = await runShellLikeGitDiff(diffArgs, workspace2);
        const preview = analyzeDiffPreview(diff, {
          projectName: vscode.workspace.name ?? "workspace"
        });
        lastReport = renderMarkdown(preview);
        latestCandidates = preview.suggestions.map((item) => ({
          ...item,
          workspace: workspace2
        }));
        treeDataProvider.refresh(latestCandidates);
        showPanel(context, preview);
      } catch (error) {
        vscode.window.showErrorMessage(`PatchDiet analysis failed: ${formatError(error)}`);
      }
    }),
    vscode.commands.registerCommand("patchdiet.copyReport", async () => {
      await vscode.env.clipboard.writeText(lastReport);
      vscode.window.showInformationMessage("PatchDiet report copied.");
    }),
    vscode.commands.registerCommand("patchdiet.openCandidate", async (candidate) => {
      const item = candidate?.candidate ?? candidate;
      if (!item?.workspace || !item.filePath) {
        vscode.window.showWarningMessage("Run PatchDiet analysis before opening a candidate.");
        return;
      }
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(item.workspace, item.filePath)));
      await vscode.window.showTextDocument(document, { preview: true });
    }),
    vscode.commands.registerCommand("patchdiet.copySuggestion", async (candidate) => {
      const item = candidate?.candidate ?? candidate ?? latestCandidates[0];
      if (!item) {
        vscode.window.showWarningMessage("Run PatchDiet analysis before copying a suggestion.");
        return;
      }
      await vscode.env.clipboard.writeText(`${item.filePath} ${item.hunkHeader}: ${item.reason}`);
      vscode.window.showInformationMessage("PatchDiet suggestion copied.");
    }),
    vscode.commands.registerCommand("patchdiet.runDryRunJson", async () => {
      const workspace2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspace2) {
        vscode.window.showWarningMessage("Open a workspace before running PatchDiet.");
        return;
      }
      if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage("PatchDiet dry run failed: Workspace is not trusted. Run `patchdiet.runDryRunJson` only in a trusted workspace.");
        return;
      }
      const config = vscode.workspace.getConfiguration("patchdiet");
      const baseRef = config.get("baseRef", "origin/main");
      const testCommand = config.get("testCommand", "npm test");
      try {
        const stdout = await runPatchdietDryRun(workspace2, baseRef, testCommand);
        const document = await vscode.workspace.openTextDocument({
          content: stdout,
          language: "json"
        });
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        vscode.window.showErrorMessage(`PatchDiet dry run failed: ${formatError(error)}`);
      }
    })
  );
}
function deactivate() {
}
async function runShellLikeGitDiff(args, cwd) {
  if (!vscode.workspace.isTrusted) {
    throw new Error("Workspace is not trusted. Run `patchdiet.analyzeDiff` only in a trusted workspace.");
  }
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024 * 20
  });
  return stdout;
}
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
function runPatchdietDryRun(workspace2, baseRef, testCommand) {
  const args = [
    "shrink",
    "--base",
    baseRef,
    "--head",
    "HEAD",
    "--test",
    testCommand,
    "--dry-run",
    "--json"
  ];
  if (process.platform === "win32") {
    const quoted = args.map((arg) => quoteForCmd(arg)).join(" ");
    return execFileAsync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `patchdiet ${quoted}`], {
      cwd: workspace2,
      maxBuffer: 1024 * 1024 * 20
    });
  }
  return execFileAsync("patchdiet", args, { cwd: workspace2, maxBuffer: 1024 * 1024 * 20 });
}
function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
var DIFF_ARG_PATTERN = /^[A-Za-z0-9._/@~^:+-]+$/;
function parseTrustedGitDiffCommand(command) {
  if (typeof command !== "string") {
    return void 0;
  }
  const tokens = command.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens[0] !== "git" || tokens[1] !== "diff") {
    return void 0;
  }
  const rest = tokens.slice(2);
  if (rest.length === 0) {
    return void 0;
  }
  for (const token of rest) {
    if (!DIFF_ARG_PATTERN.test(token)) {
      return void 0;
    }
  }
  return rest;
}
function showPanel(context, preview) {
  const panel = vscode.window.createWebviewPanel(
    "patchdiet",
    "PatchDiet",
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  panel.webview.html = renderHtml(preview);
  context.subscriptions.push(panel);
}
var PatchDietCandidatesProvider = class {
  constructor() {
    this.items = [];
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  refresh(items) {
    this.items = items;
    this.emitter.fire();
  }
  getTreeItem(item) {
    const treeItem = new vscode.TreeItem(item.filePath, vscode.TreeItemCollapsibleState.None);
    treeItem.description = item.category;
    treeItem.tooltip = `${item.hunkHeader}
${item.reason}`;
    treeItem.command = {
      command: "patchdiet.openCandidate",
      title: "Open Candidate",
      arguments: [{ candidate: item }]
    };
    treeItem.contextValue = "patchdietCandidate";
    return treeItem;
  }
  getChildren() {
    return this.items;
  }
};
function renderMarkdown(preview) {
  const lines = [
    "# PatchDiet Preview",
    "",
    `Project: ${preview.projectName}`,
    `Saved review time: ${preview.metrics.savedReviewTimePercent}%`,
    `Before: ${preview.input.fileCount} files, ${preview.input.changedLineCount} lines`,
    `After: ${preview.output.fileCount} files, ${preview.output.changedLineCount} lines`,
    "",
    "## Suggested deletion hunks",
    ...preview.suggestions.map((item) => `- ${item.filePath} ${item.hunkHeader}: ${item.reason}`)
  ];
  return lines.join("\n");
}
function renderHtml(preview) {
  const candidates = preview.suggestions.map((item) => `
    <li>
      <strong>${escapeHtml(item.filePath)}</strong>
      <span>${escapeHtml(item.category)} - ${escapeHtml(item.hunkHeader)}</span>
      <p>${escapeHtml(item.reason)}</p>
    </li>
  `).join("");
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body{font-family:ui-monospace,Menlo,Consolas,monospace;margin:0;padding:24px;background:#0c100e;color:#f5f1e8}
          h1{font-family:Georgia,serif;font-size:42px;line-height:1;margin:0 0 18px}
          .grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #314138;margin:18px 0}
          .grid div{padding:14px;border-right:1px solid #314138}.grid div:last-child{border-right:0}
          span{display:block;color:#80d7ff;margin:6px 0}p{color:#a9b4ac}li{border:1px solid #314138;padding:12px;margin:10px 0;list-style:none}
          button{border:1px solid #314138;background:#9cf36b;color:#10200f;padding:8px 12px}
        </style>
      </head>
      <body>
        <h1>Saved ${preview.metrics.savedReviewTimePercent}% review time</h1>
        <p>${escapeHtml(preview.disclaimer)}</p>
        <div class="grid">
          <div>Files<br><strong>${preview.input.fileCount} -> ${preview.output.fileCount}</strong></div>
          <div>Lines<br><strong>${preview.input.changedLineCount} -> ${preview.output.changedLineCount}</strong></div>
          <div>Deletion hunks<br><strong>${preview.metrics.suggestedDeletionHunks}</strong></div>
        </div>
        <button onclick="navigator.clipboard.writeText(document.body.innerText)">Copy report</button>
        <ul>${candidates || "<li>No obvious preview candidates. Run the CLI for test-verified analysis.</li>"}</ul>
      </body>
    </html>
  `;
}
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export {
  activate,
  deactivate
};
