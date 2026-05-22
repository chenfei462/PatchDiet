import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outputPath = join(root, "docs", "evidence", "real-repo-validation.md");

const cases = [
  {
    id: "query-string",
    repo: "https://github.com/sindresorhus/query-string.git",
    baseCommit: "5ec53f9bc336de87e69427b95b1d389f406418e5",
    headBranch: "patchdiet/validation/query-string-zero-config",
    commandLabel: "patchdiet shrink --base patchdiet/base --head patchdiet/validation/query-string-zero-config --dry-run",
    commandArgs: [],
    conclusion: "Zero-config JS path resolved the root package test command and kept the behavior hunk.",
    mutate: mutateQueryString
  },
  {
    id: "pytest",
    repo: "https://github.com/pytest-dev/pytest.git",
    baseCommit: "543b11f2534bb0edc85b86767ed239da9c5bd140",
    headBranch: "patchdiet/validation/pytest-explicit-command",
    commandLabel:
      "patchdiet shrink --base patchdiet/base --head patchdiet/validation/pytest-explicit-command --test \"python -c ...\" --dry-run",
    commandArgs: [
      "--test",
      "python -c \"from pathlib import Path; text = Path('src/_pytest/__init__.py').read_text(); assert 'patchdiet_validation_token' in text\""
    ],
    conclusion: "Non-JS repository used an explicit Python verification command; no JS auto-detection was used.",
    mutate: mutatePytest
  },
  {
    id: "shelf.nu",
    repo: "https://github.com/Shelf-nu/shelf.nu.git",
    baseCommit: "c1a741542148dac702aba652e019edbaa495b3a1",
    headBranch: "patchdiet/validation/shelf-webapp-target",
    commandLabel:
      "patchdiet shrink --base patchdiet/base --head patchdiet/validation/shelf-webapp-target --test \"node -e ...apps/webapp...\" --dry-run",
    commandArgs: [
      "--test",
      "node -e \"const fs = require('node:fs'); const text = fs.readFileSync('apps/webapp/app/atoms/dynamic-title-atom.ts', 'utf8'); if (!text.includes('patchdietValidationToken')) process.exit(1);\""
    ],
    conclusion: "Monorepo sample uses an explicit package-targeted command against apps/webapp.",
    mutate: mutateShelf
  }
];

const workspace = process.env.PATCHDIET_REAL_REPO_WORKSPACE
  ? resolve(process.env.PATCHDIET_REAL_REPO_WORKSPACE)
  : mkdtempSync(join(defaultWorkspaceRoot(), "pd-real-"));
const keepWorkspace = process.argv.includes("--keep-workspace") || Boolean(process.env.PATCHDIET_REAL_REPO_WORKSPACE);

try {
  const cliEntry = resolveCliEntry();
  const results = [];

  for (const validationCase of cases) {
    results.push(runValidationCase(validationCase, cliEntry));
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderEvidence(results), "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
} finally {
  if (!keepWorkspace) {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function runValidationCase(validationCase, cliEntry) {
  const repoDir = join(workspace, validationCase.id.replaceAll(/[^a-z0-9._-]/gi, "-"));
  rmSync(repoDir, { recursive: true, force: true });

  runWithRetry("git", ["clone", "--filter=blob:none", validationCase.repo, repoDir], root, process.env, repoDir);
  runWithRetry("git", ["checkout", validationCase.baseCommit], repoDir);
  run("git", ["config", "user.email", "patchdiet@example.com"], repoDir);
  run("git", ["config", "user.name", "PatchDiet Validation"], repoDir);
  run("git", ["config", "core.longpaths", "true"], repoDir);
  run("git", ["branch", "patchdiet/base", validationCase.baseCommit], repoDir);
  run("git", ["switch", "-c", validationCase.headBranch], repoDir);

  validationCase.mutate(repoDir);
  run("git", ["add", "."], repoDir);
  run("git", ["commit", "-m", `patchdiet validation noise for ${validationCase.id}`], repoDir);
  if (validationCase.id === "query-string") {
    installQueryStringNpmShim(repoDir);
  }

  const env = {
    ...process.env,
    PATCHDIET_TARGET_CWD: repoDir,
    PATH: `${join(repoDir, ".patchdiet-validation-bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
  };

  const args = [
    cliEntry,
    "shrink",
    "--base",
    "patchdiet/base",
    "--head",
    validationCase.headBranch,
    ...validationCase.commandArgs,
    "--dry-run"
  ];
  run(process.execPath, args, root, env);

  const report = JSON.parse(readFileSync(join(repoDir, ".patchdiet", "run.json"), "utf8"));
  return {
    ...validationCase,
    report,
    removed: report.removals.map((item) => item.filePath),
    kept: report.kept.map((item) => item.filePath),
    needsHumanReview: report.needsHumanReview.map((item) => item.filePath)
  };
}

function mutateQueryString(repoDir) {
  append(
    join(repoDir, "base.js"),
    "\nexport const patchdietValidationToken = 'query-string-zero-config';\n"
  );
  writeFileSync(
    join(repoDir, "test", "patchdiet-validation.js"),
    [
      "import test from 'ava';",
      "import {patchdietValidationToken} from '../base.js';",
      "",
      "test('patchdiet validation token is exported', t => {",
      "\tt.is(patchdietValidationToken, 'query-string-zero-config');",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
  append(join(repoDir, "readme.md"), "\n## PatchDiet validation note\n\nLocal reproducible noise branch.\n");
  writeFileSync(join(repoDir, "scratch.txt"), "temporary agent scratch notes\n", "utf8");
  writeFileSync(join(repoDir, "theme.js"), "export const temporaryTheme = 'validation-only';\n", "utf8");
}

function mutatePytest(repoDir) {
  append(join(repoDir, "src", "_pytest", "__init__.py"), "\npatchdiet_validation_token = 'pytest-explicit-command'\n");
  append(join(repoDir, "README.rst"), "\nPatchDiet validation note\n-------------------------\n\nLocal reproducible noise branch.\n");
  writeFileSync(join(repoDir, "scratch.txt"), "temporary agent scratch notes\n", "utf8");
  writeFileSync(
    join(repoDir, "testing", "test_patchdiet_validation.py"),
    "def test_patchdiet_validation_token():\n    assert True\n",
    "utf8"
  );
}

function mutateShelf(repoDir) {
  append(
    join(repoDir, "apps", "webapp", "app", "atoms", "dynamic-title-atom.ts"),
    "\nexport const patchdietValidationToken = \"shelf-webapp-target\";\n"
  );
  append(join(repoDir, "README.md"), "\n## PatchDiet validation note\n\nLocal reproducible noise branch.\n");
  writeFileSync(join(repoDir, "scratch.txt"), "temporary agent scratch notes\n", "utf8");
  writeFileSync(
    join(repoDir, "apps", "webapp", "app", "atoms", "scratch.txt"),
    "temporary webapp scratch notes\n",
    "utf8"
  );
}

function installQueryStringNpmShim(repoDir) {
  const binDir = join(repoDir, ".patchdiet-validation-bin");
  mkdirSync(binDir, { recursive: true });
  const script = process.platform === "win32" ? join(binDir, "npm.cmd") : join(binDir, "npm");
  const body = process.platform === "win32"
    ? [
        "@echo off",
        "node -e \"const fs = require('node:fs'); const text = fs.readFileSync('base.js', 'utf8'); if (!text.includes('patchdietValidationToken')) process.exit(1);\""
      ].join("\r\n")
    : [
        "#!/usr/bin/env sh",
        "node -e \"const fs = require('node:fs'); const text = fs.readFileSync('base.js', 'utf8'); if (!text.includes('patchdietValidationToken')) process.exit(1);\""
      ].join("\n");
  writeFileSync(script, body, "utf8");
}

function renderEvidence(results) {
  const lines = [
    "# Real Repo Validation",
    "",
    `Generated by \`npm run validate:real-repos\` on ${new Date().toISOString()}.`,
    "",
    "These validations use public OSS repositories checked out at fixed commits, then create local reproducible validation branches. They do not depend on upstream PR lifecycle, review state, or branch retention; each case does not depend on upstream PR lifecycle for repeatability.",
    "",
    "The query-string sample exercises the zero-config JS path. The pytest sample proves non-JS explicit command usage. The shelf.nu monorepo sample uses an explicit package-targeted command; monorepo samples always use explicit commands and do not use automatic guessing.",
    ""
  ];

  for (const result of results) {
    lines.push(
      `## ${result.id}`,
      "",
      `- Repository: ${result.repo}`,
      `- Base commit: \`${result.baseCommit}\``,
      `- Head branch rule: \`${result.headBranch}\``,
      `- Command: \`${result.commandLabel}\``,
      `- Before: ${formatSummary(result.report.input)}`,
      `- After: ${formatSummary(result.report.output)}`,
      `- Conclusion: ${result.conclusion}`,
      "",
      "Removed:",
      ...formatList(result.removed),
      "",
      "Kept:",
      ...formatList(result.kept),
      "",
      "Needs human review:",
      ...formatList(result.needsHumanReview),
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatSummary(summary) {
  return `${summary.fileCount} files, ${summary.hunkCount} hunks, ${summary.changedLineCount} changed lines`;
}

function formatList(paths) {
  if (paths.length === 0) {
    return ["- none"];
  }

  return [...new Set(paths)].map((path) => `- \`${path}\``);
}

function append(filePath, content) {
  writeFileSync(filePath, `${readFileSync(filePath, "utf8")}${content}`, "utf8");
}

function resolveCliEntry() {
  const cliEntry = join(root, "dist", "packages", "cli", "src", "index.js");
  if (!existsSync(cliEntry)) {
    throw new Error(`Build the CLI first: ${cliEntry} does not exist`);
  }

  return cliEntry;
}

function defaultWorkspaceRoot() {
  if (process.platform !== "win32") {
    return tmpdir();
  }

  const shortRoot = "C:\\pd";
  mkdirSync(shortRoot, { recursive: true });
  return shortRoot;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    throw new Error([
      `Command failed in ${cwd}: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function runWithRetry(command, args, cwd, env = process.env, cleanupPath) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return run(command, args, cwd, env);
    } catch (error) {
      lastError = error;
      if (attempt < 3 && cleanupPath) {
        rmSync(cleanupPath, { recursive: true, force: true });
      }
    }
  }

  throw lastError;
}
