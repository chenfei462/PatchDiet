/**
 * Real-Git adversarial tests for the independent artifact-delta checker
 * (verifyArtifactDelta in benchmarks/run-benchmark.mjs). Run:
 * node --test benchmarks/tests/
 *
 * The ACTUAL implementation is extracted from the runner source exactly the
 * way the independent root review does it (slice between the function
 * markers, prepend the same primitive imports, import as a module), so these
 * tests can never drift from the code the benchmark really executes.
 *
 * Covered: the two root-review defects (a labelled debug removal hiding
 * corruption of a separate required file; an unlabelled executable-mode flip
 * on a selected path), forged removal identity, missing/added tracked files,
 * unlabelled mode flips on unselected paths, and the legitimate positive.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, before, after } from "node:test";

import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "run-benchmark.mjs");

// Extract the actual checker implementation from the runner source (same
// slicing contract as the independent review script).
const source = readFileSync(RUNNER, "utf8");
const start = source.indexOf("async function verifyArtifactDelta(");
const end = source.indexOf("async function independentlyVerify(", start);
assert.ok(start >= 0 && end > start, "verifyArtifactDelta not found in run-benchmark.mjs");
const modulePath = join(mkdtempSync(join(tmpdir(), "patchdiet-artifact-delta-test-")), "artifact-checker-under-test.mjs");
writeFileSync(
  modulePath,
  "import {execFile,execFileSync} from 'node:child_process';import {promisify} from 'node:util';import {existsSync,readFileSync} from 'node:fs';import {join} from 'node:path';const execFileAsync=promisify(execFile);\n" +
    source.slice(start, end).replace("async function verifyArtifactDelta(", "export async function verifyArtifactDelta("),
);
const { verifyArtifactDelta } = await import(pathToFileURL(modulePath).href);

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

// Real fixture repo: base = empty debug.js + required.js v1; head = debug
// line added to debug.js AND the required change in required.js. The mapped
// unnecessary atom is ONLY the debug line.
const debug = "console.error('unrelated debug');\n";
let root;
let baseSha;
let headSha;
const mapped = [
  {
    label: "unnecessary",
    atom: {
      kind: "ast",
      id: "known-debug",
      filePath: "debug.js",
      spans: { baseBytes: [0, 0], headBytes: [0, Buffer.byteLength(debug)] },
      baseSlice: "",
      headSlice: debug,
    },
  },
];

before(() => {
  root = mkdtempSync(join(tmpdir(), "patchdiet-artifact-delta-fixture-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "debug.js"), "");
  writeFileSync(join(root, "required.js"), "export const required=1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "base");
  baseSha = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "debug.js"), debug);
  writeFileSync(join(root, "required.js"), "export const required=2;\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "needed change and unrelated debug");
  headSha = git(root, "rev-parse", "HEAD");
});

after(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(dirname(modulePath), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Deliver the LEGITIMATE artifact: exactly the labelled debug removal.
// Also resets any state a previous test left behind (added/untracked files,
// executable bits) so every test starts from the same staged artifact.
const stageArtifact = () => {
  rmSync(join(root, "extra"), { recursive: true, force: true });
  rmSync(join(root, "sneaky.txt"), { force: true });
  writeFileSync(join(root, "debug.js"), "");
  writeFileSync(join(root, "required.js"), "export const required=2;\n");
  git(root, "add", "-A");
  git(root, "update-index", "--chmod=-x", "debug.js");
  git(root, "update-index", "--chmod=-x", "required.js");
};

test("legitimate labelled removal of debug.js alone passes", async () => {
  stageArtifact();
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.deepEqual(verdict, { ok: true, failures: [] });
});

test("a labelled debug removal cannot hide corruption of a separate required file (root review)", async () => {
  stageArtifact();
  writeFileSync(join(root, "required.js"), "export const required=0;\n");
  git(root, "add", "-u");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.startsWith("required.js:")), JSON.stringify(verdict.failures));
});

test("unlabelled executable-mode flip on a selected path is rejected (root review)", async () => {
  stageArtifact();
  git(root, "update-index", "--chmod=+x", "debug.js");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.includes("mode changed from 100644 to 100755")), JSON.stringify(verdict.failures));
});

test("unlabelled executable-mode flip on an UNSELECTED path is rejected", async () => {
  stageArtifact();
  git(root, "update-index", "--chmod=+x", "required.js");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.startsWith("required.js:") && f.includes("mode changed")), JSON.stringify(verdict.failures));
});

test("forged removal identity: a necessary change dressed as an unnecessary removal is rejected", async () => {
  stageArtifact();
  // Forge: claim the required.js HEAD-side change is a labelled-unnecessary
  // atom (wrong identity for a real removal). The delivered artifact keeps
  // the required change, so HEAD-minus-claimed-removal differs from it.
  const requiredHead = "export const required=2;\n";
  const forged = [
    ...mapped,
    {
      label: "unnecessary",
      atom: {
        kind: "ast",
        id: "forged",
        filePath: "required.js",
        spans: { baseBytes: [22, 23], headBytes: [22, 23] },
        baseSlice: "1",
        headSlice: "2",
      },
    },
  ];
  const verdict = await verifyArtifactDelta({ mapped: forged, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.startsWith("required.js:") && f.includes("differ")), JSON.stringify(verdict.failures));
});

test("missing tracked file (unlabelled deletion) is rejected", async () => {
  stageArtifact();
  const verdict = await verifyArtifactDelta({ mapped: [], root, baseSha, headSha });
  // With no mapped atoms, the debug line itself is an unselected change.
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.startsWith("debug.js:") && f.includes("differ")), JSON.stringify(verdict.failures));
});

// Root-review regression 3: file existence is unlabelled baseline metadata.
// debug.js is tracked (empty) in BASE, so reverting the added debug bytes
// must RETAIN the empty file — whole-file deletion is rejected even though
// the reconstructed expected bytes are empty.
test("deleting a BASE-tracked (empty) labelled file is rejected even when expected bytes are empty (root review)", async () => {
  stageArtifact();
  git(root, "rm", "-f", "--", "debug.js");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(
    verdict.failures.some((f) => f.startsWith("debug.js:") && f.includes("BASE tracks this file")),
    JSON.stringify(verdict.failures),
  );
  // Same deletion but the worktree file left behind: also rejected.
  writeFileSync(join(root, "debug.js"), "");
  git(root, "add", "debug.js");
  git(root, "rm", "--cached", "debug.js");
  const verdict2 = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict2.ok, false, JSON.stringify(verdict2));
});

// Positive counterpart: a genuinely NEW file (absent from BASE) whose full
// creation was prelabelled unnecessary may legitimately disappear entirely.
test("undoing a labelled full creation of a file BASE lacks is legitimate", async () => {
  stageArtifact();
  const created = "export const generated=1;\n";
  writeFileSync(join(root, "generated.js"), created);
  git(root, "add", "-A");
  git(root, "commit", "-m", "head adds generated file");
  const headSha2 = git(root, "rev-parse", "HEAD");
  const baseSha2 = git(root, "rev-parse", "HEAD~1");
  const createdMapped = [
    {
      label: "unnecessary",
      atom: {
        kind: "ast",
        id: "created-file",
        filePath: "generated.js",
        spans: { baseBytes: [0, 0], headBytes: [0, Buffer.byteLength(created)] },
        baseSlice: "",
        headSlice: created,
      },
    },
  ];
  git(root, "rm", "-f", "--", "generated.js");
  const verdict = await verifyArtifactDelta({ mapped: createdMapped, root, baseSha: baseSha2, headSha: headSha2 });
  assert.deepEqual(verdict, { ok: true, failures: [] });
  // The same whole-file deletion with NO labelled removal covering it is
  // still rejected (unlabelled deletion of a HEAD-tracked file).
  const verdict2 = await verifyArtifactDelta({ mapped: [], root, baseSha: baseSha2, headSha: headSha2 });
  assert.equal(verdict2.ok, false, JSON.stringify(verdict2));
  assert.ok(verdict2.failures.some((f) => f.includes("expected bytes remain")), JSON.stringify(verdict2.failures));
  // Restore the original fixture state for subsequent tests.
  rmSync(join(root, "generated.js"), { force: true });
  git(root, "add", "-A");
});

test("added file not tracked in HEAD is rejected", async () => {
  stageArtifact();
  mkdirSync(join(root, "extra"), { recursive: true });
  writeFileSync(join(root, "extra", "new.js"), "export const sneaky=1;\n");
  git(root, "add", "-A");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.includes("adds a file that is not tracked in HEAD")), JSON.stringify(verdict.failures));
});

test("untracked worktree file is rejected", async () => {
  stageArtifact();
  writeFileSync(join(root, "sneaky.txt"), "untracked\n");
  const verdict = await verifyArtifactDelta({ mapped, root, baseSha, headSha });
  assert.equal(verdict.ok, false, JSON.stringify(verdict));
  assert.ok(verdict.failures.some((f) => f.includes("untracked files not present in HEAD")), JSON.stringify(verdict.failures));
});
