import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import * as vscode from "vscode";

// Bundled at build time by esbuild (`npm run bundle`), so the packaged VSIX is
// self-contained: no runtime import from the repository root, which would escape
// the extension directory once installed.
import { analyzeDiffPreview } from "../../packages/core/src/insights.js";

const execFileAsync = promisify(execFile);
let lastReport = "Run PatchDiet: Analyze Current Git Diff first.";
let latestCandidates = [];
let treeDataProvider;

export function activate(context) {
  treeDataProvider = new PatchDietCandidatesProvider();
  const treeView = vscode.window.createTreeView("patchdiet.candidates", { treeDataProvider });
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("patchdiet.analyzeDiff", async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspace) {
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
        const diff = await runShellLikeGitDiff(diffArgs, workspace);
        const preview = analyzeDiffPreview(diff, {
          projectName: vscode.workspace.name ?? "workspace"
        });
        lastReport = renderMarkdown(preview);
        latestCandidates = preview.suggestions.map((item) => ({
          ...item,
          workspace
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
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspace) {
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
        const stdout = await runPatchdietDryRun(workspace, baseRef, testCommand);
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

export function deactivate() {}

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

// Node >= 18.20 refuses to spawn a bare "patchdiet" on Windows because the npm shim
// is patchdiet.cmd (EINVAL). Spawning through the shell resolves the shim, and every
// argument is quoted so a hostile baseRef/testCommand cannot inject a command.
function runPatchdietDryRun(workspace, baseRef, testCommand) {
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
      cwd: workspace,
      maxBuffer: 1024 * 1024 * 20
    });
  }
  return execFileAsync("patchdiet", args, { cwd: workspace, maxBuffer: 1024 * 1024 * 20 });
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

// Whitelist instead of blacklist: only `git diff` with plain ref/path arguments.
// Everything else is rejected, so a malicious .vscode/settings.json cannot inject
// shell metacharacters, redirection, or a different executable.
const DIFF_ARG_PATTERN = /^[A-Za-z0-9._/@~^:+-]+$/;

function parseTrustedGitDiffCommand(command) {
  if (typeof command !== "string") {
    return undefined;
  }
  const tokens = command.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens[0] !== "git" || tokens[1] !== "diff") {
    return undefined;
  }
  const rest = tokens.slice(2);
  if (rest.length === 0) {
    return undefined;
  }
  for (const token of rest) {
    if (!DIFF_ARG_PATTERN.test(token)) {
      return undefined;
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

class PatchDietCandidatesProvider {
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
    treeItem.tooltip = `${item.hunkHeader}\n${item.reason}`;
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
}

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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}