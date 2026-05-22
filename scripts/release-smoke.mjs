import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "patchdiet-release-smoke-"));
const packDir = join(workspace, "pack");
const repoDir = join(workspace, "repo");

try {
  mkdirSync(packDir, { recursive: true });
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: root, stdio: "inherit" });

  const tarball = readdirSync(packDir).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack did not produce a tarball");
  }

  setupReleaseSmokeRepo(repoDir);

  execFileSync("npm", ["install", "--no-save", join(packDir, tarball)], { cwd: repoDir, stdio: "inherit" });
  execFileSync("npm", ["exec", "--", "patchdiet", "--help"], { cwd: repoDir, stdio: "inherit" });
  execFileSync(
    "npm",
    [
      "exec",
      "--",
      "patchdiet",
      "shrink",
      "--base",
      "main",
      "--head",
      "agent/bloated",
      "--dry-run"
    ],
    { cwd: repoDir, stdio: "inherit" }
  );

  const reportPath = join(repoDir, ".patchdiet", "run.json");
  const cleanupPath = join(repoDir, ".patchdiet", "cleanup.diff");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!report || report.baseRef !== "main") {
    throw new Error("release smoke run did not write a valid report");
  }
  if (!readFileSync(cleanupPath, "utf8").includes("multiply")) {
    throw new Error("release smoke run did not produce the expected cleanup patch");
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function setupReleaseSmokeRepo(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: targetDir, stdio: "inherit" });
  execFileSync("git", ["config", "user.email", "patchdiet@example.com"], { cwd: targetDir, stdio: "inherit" });
  execFileSync("git", ["config", "user.name", "PatchDiet"], { cwd: targetDir, stdio: "inherit" });

  mkdirSync(join(targetDir, "src"), { recursive: true });
  mkdirSync(join(targetDir, "test"), { recursive: true });
  writeFileSync(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: "release-smoke-repo",
        private: true,
        type: "module",
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    )
  );
  writeFileSync(
    join(targetDir, "src", "math.ts"),
    "export function add(a, b) {\n  return a + b;\n}\n"
  );
  writeFileSync(
    join(targetDir, "test", "math.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add } from '../src/math.ts';",
      "",
      "test('add sums two numbers', () => {",
      "  assert.equal(add(2, 3), 5);",
      "});",
      ""
    ].join("\n")
  );
  execFileSync("git", ["add", "."], { cwd: targetDir, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", "base smoke repo"], { cwd: targetDir, stdio: "inherit" });

  execFileSync("git", ["checkout", "-b", "agent/bloated"], { cwd: targetDir, stdio: "inherit" });
  writeFileSync(
    join(targetDir, "src", "math.ts"),
    "export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n"
  );
  writeFileSync(
    join(targetDir, "test", "math.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add, multiply } from '../src/math.ts';",
      "",
      "test('add sums two numbers', () => {",
      "  assert.equal(add(2, 3), 5);",
      "});",
      "",
      "test('multiply multiplies two numbers', () => {",
      "  assert.equal(multiply(2, 3), 6);",
      "});",
      ""
    ].join("\n")
  );
  writeFileSync(join(targetDir, "README.md"), "# Demo\n\nUnrelated docs update.\n");
  writeFileSync(join(targetDir, "src", "unused.ts"), "export const notes = 'agent added unrelated file';\n");
  writeFileSync(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: "release-smoke-repo",
        private: true,
        type: "module",
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    )
  );
  execFileSync("git", ["add", "."], { cwd: targetDir, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", "bloated smoke patch"], { cwd: targetDir, stdio: "inherit" });
}
