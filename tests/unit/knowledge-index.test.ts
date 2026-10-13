import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  KnowledgeIndex,
  indexRepository,
  openKnowledgeIndexReadonly,
} from "../../packages/knowledge/src/index.js";

const execFileAsync = promisify(execFile);

/**
 * Junction/symlink creation is a Windows privilege precondition
 * (SeCreateSymbolicLinkPrivilege / reparse-point policy). Probed once; when
 * unavailable the physical-link tests are skipped with an explicit reason so
 * the reviewer's environment can run the same gates for real.
 */
let junctionCapability: boolean | null = null;
async function canCreateJunctions(): Promise<boolean> {
  if (junctionCapability === null) {
    const probeDir = makeTempDir("patchdiet-junction-probe");
    try {
      await mkdir(join(probeDir, "target"), { recursive: true });
      await symlink(join(probeDir, "target"), join(probeDir, "link"), "junction");
      junctionCapability = true;
    } catch {
      junctionCapability = false;
    }
  }
  return junctionCapability;
}

/**
 * Bounded awaited cleanup (contract rule 5): Windows Node 24 rmSync does not
 * retry EPERM/EBUSY correctly, so tests use fs/promises.rm with bounded
 * retries and never swallow cleanup failures.
 */
const tempDirs: string[] = [];

async function removeBounded(target: string, attempts = 10): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
  throw new Error(`bounded cleanup failed for '${target}' after ${attempts} attempts`, { cause: lastError });
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeBounded(dir);
  }
});

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "core.autocrlf=false", ...args],
    {
      cwd,
      windowsHide: true,
    },
  );
  return result.stdout;
}

async function initRepo(files: Record<string, string>, commitMessage = "init"): Promise<string> {
  const dir = makeTempDir("patchdiet-knowledge-repo");
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await git(dir, "init", "-b", "main");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", commitMessage);
  return dir;
}

/** Repo init that writes EXACT bytes (BOM / invalid UTF-8 cases). */
async function initRepoWithBytes(files: Record<string, Buffer>, commitMessage = "init"): Promise<string> {
  const dir = makeTempDir("patchdiet-knowledge-repo-bytes");
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  await git(dir, "init", "-b", "main");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", commitMessage);
  return dir;
}

async function withReadonlyIndex<T>(dbPath: string, fn: (index: KnowledgeIndex) => T): Promise<T> {
  const index = openKnowledgeIndexReadonly(dbPath);
  try {
    return await fn(index);
  } finally {
    index.close();
  }
}

const SAMPLE_TS = 'export function alpha() { return beta(); }\nfunction beta() { return 1; }\n';
const SAMPLE_TS_V2 = 'export function alpha() { return gamma(); }\nfunction gamma() { return 2; }\n';
const SAMPLE_PY = 'def train(model):\n    return model\n\nclass Trainer:\n    def run(self):\n        return train(None)\n';

describe("indexRepository: baseline indexing", () => {
  it("indexes pinned-commit git blobs and exposes query APIs", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS, "src/m.py": SAMPLE_PY });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");

    const result = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(result.repo.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.schemaVersion).toBe(1);
    expect(result.files.indexed).toBe(2);
    expect(result.files.reparsed).toBe(0);

    await withReadonlyIndex(dbPath, (index) => {
      const symbols = index.querySymbols({ name: "alpha" });
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        path: "src/a.ts",
        name: "alpha",
        kind: "function",
        exported: true,
        language: "typescript",
      });
      expect(index.querySymbols({ name: "Trainer" })).toEqual([
        expect.objectContaining({ name: "Trainer", kind: "class", path: "src/m.py", language: "python" }),
      ]);

      const graph = index.getFileGraph("src/a.ts");
      expect(graph.file).toMatchObject({ path: "src/a.ts", language: "typescript", complete: true });
      expect(graph.symbols.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
      expect(graph.edges.some((e) => e.kind === "call" && e.toName === "beta" && e.resolved)).toBe(true);
    });
  });
});

describe("indexRepository: dirty working tree isolation", () => {
  it("indexes committed blobs only, never dirty filesystem content", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");

    // Dirty the working tree WITHOUT committing.
    await writeFile(join(repo, "src", "a.ts"), "function dirtyOnly() { return 9; }\n", "utf8");

    const result = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(result.files.indexed).toBe(1);

    await withReadonlyIndex(dbPath, (index) => {
      expect(index.querySymbols({ name: "dirtyOnly" })).toEqual([]);
      expect(index.querySymbols({ name: "alpha" })).toHaveLength(1);
    });
  });
});

describe("indexRepository: incremental behavior", () => {
  it("skips unchanged blobs, reparses changed ones, and cleans up deleted files", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS, "src/old.ts": "export const old = 1;\n" });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    // Second index of the same commit: everything is skipped.
    const unchanged = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(unchanged.files.skipped).toBe(2);
    expect(unchanged.files.reparsed).toBe(0);

    // Commit a change + a deletion.
    await writeFile(join(repo, "src", "a.ts"), SAMPLE_TS_V2, "utf8");
    await rm(join(repo, "src", "old.ts"));
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "change and delete");

    const updated = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(updated.files.skipped).toBe(0);
    expect(updated.files.reparsed).toBe(1);
    expect(updated.files.deleted).toBe(1);

    await withReadonlyIndex(dbPath, (index) => {
      expect(index.querySymbols({ name: "gamma" })).toHaveLength(1);
      expect(index.querySymbols({ name: "beta" })).toEqual([]);
      expect(index.querySymbols({ name: "old" })).toEqual([]);
    });
  });

  it("records renames when content moves between paths", async () => {
    const repo = await initRepo({ "src/orig.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    const content = await readFile(join(repo, "src", "orig.ts"), "utf8");
    await rm(join(repo, "src", "orig.ts"));
    await writeFile(join(repo, "src", "moved.ts"), content, "utf8");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "rename");

    const result = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(result.files.renamed).toBe(1);

    await withReadonlyIndex(dbPath, (index) => {
      expect(index.querySymbols({ name: "alpha" })).toEqual([
        expect.objectContaining({ path: "src/moved.ts" }),
      ]);
    });
  });
});

describe("indexRepository: rules and coverage provenance", () => {
  it("discovers rules from approved configured paths and queries them via FTS", async () => {
    const repo = await initRepo({
      "src/a.ts": SAMPLE_TS,
      "docs/rules/no-raw-secret.md": "---\nname: no-raw-secret\n---\nForbid raw secrets in changed hunks.\n",
      "docs/rules/require-tests.md": "---\nname: require-tests\n---\nEvery exported symbol change needs a test.\n",
    });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");

    const result = await indexRepository({
      cwd: repo,
      databasePath: dbPath,
      rules: { globs: ["docs/rules/*.md"] },
    });
    expect(result.rules.sources.sort()).toEqual(["docs/rules/no-raw-secret.md", "docs/rules/require-tests.md"]);

    await withReadonlyIndex(dbPath, (index) => {
      const hits = index.searchRules("secrets");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ name: "no-raw-secret", sourcePath: "docs/rules/no-raw-secret.md" });
      // Deterministic ordering by source path.
      expect(index.searchRules("secret OR test").map((r) => r.name)).toEqual([
        "no-raw-secret",
        "require-tests",
      ]);
    });
  });

  it("ingests validated coverage input with provenance, never as complete mapping", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    const coveragePath = join(repo, ".patchdiet", "coverage.json");
    await mkdir(join(repo, ".patchdiet"), { recursive: true });
    await writeFile(
      coveragePath,
      JSON.stringify({ schemaVersion: 1, source: "vitest-json", tests: [{ name: "alpha test", files: ["src/a.ts"] }] }),
      "utf8",
    );

    const result = await indexRepository({ cwd: repo, databasePath: dbPath, coveragePath });
    expect(result.coverage).toMatchObject({ tests: 1, source: "vitest-json" });

    await withReadonlyIndex(dbPath, (index) => {
      const mappings = index.getTestMappings({ path: "src/a.ts" });
      expect(mappings).toHaveLength(1);
      expect(mappings[0]).toMatchObject({
        testName: "alpha test",
        filePath: "src/a.ts",
        provenance: "coverage-input",
      });
    });
  });

  it("rejects coverage input that does not match the bounded schema", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    const coveragePath = join(repo, ".patchdiet", "bad-coverage.json");
    await mkdir(join(repo, ".patchdiet"), { recursive: true });
    await writeFile(coveragePath, JSON.stringify({ tests: "all of them" }), "utf8");

    await expect(indexRepository({ cwd: repo, databasePath: dbPath, coveragePath })).rejects.toThrow(/coverage/i);
  });
});

describe("indexRepository: database safety", () => {
  it("refuses to index a different repository into an existing database", async () => {
    const repoA = await initRepo({ "src/a.ts": SAMPLE_TS });
    const repoB = await initRepo({ "src/b.ts": SAMPLE_TS });
    const dbPath = join(repoA, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repoA, databasePath: dbPath });

    await expect(indexRepository({ cwd: repoB, databasePath: dbPath })).rejects.toThrow(
      /not inside the canonical owner root|different (repository|repo)|cross-repo/i,
    );

    // Repo A's index must be untouched.
    await withReadonlyIndex(dbPath, (index) => {
      expect(index.querySymbols({ name: "alpha" })).toHaveLength(1);
    });
  });

  it("refuses future schema versions without modifying the database", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "future.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(dbPath);
    raw.pragma("user_version = 99");
    raw.close();
    const bytesBefore = await readFile(dbPath);

    await expect(indexRepository({ cwd: repo, databasePath: dbPath })).rejects.toThrow(/future|schema/i);
    expect(await readFile(dbPath)).toEqual(bytesBefore);
  });

  it("refuses unknown non-PatchDiet databases instead of reinitializing them", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "user.db");
    await mkdir(join(repo, ".patchdiet"), { recursive: true });
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(dbPath);
    raw.exec("CREATE TABLE photos (id INTEGER PRIMARY KEY, data BLOB); INSERT INTO photos VALUES (1, x'00');");
    raw.close();
    const bytesBefore = await readFile(dbPath);

    await expect(indexRepository({ cwd: repo, databasePath: dbPath })).rejects.toThrow(/not a PatchDiet|unknown/i);
    expect(await readFile(dbPath)).toEqual(bytesBefore);

    // A read-only open of an unknown DB must also refuse rather than migrate.
    expect(() => openKnowledgeIndexReadonly(dbPath)).toThrow(/not a PatchDiet|unknown/i);
  });

  it("refuses symlinked database leaves (including dangling junctions)", async ({ skip }) => {
    if (!(await canCreateJunctions())) {
      skip("junction creation not permitted in this environment (privilege precondition)");
      return;
    }
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    await mkdir(join(repo, ".patchdiet"), { recursive: true });
    const outside = makeTempDir("patchdiet-outside");
    await mkdir(join(outside, "realdir"), { recursive: true });
    const dbPath = join(repo, ".patchdiet", "linked.db");

    // A directory junction AT the database path (junctions can only target
    // directories, but the leaf gate must reject the link before SQLite ever
    // sees the path).
    await symlink(join(outside, "realdir"), dbPath, "junction");
    await expect(indexRepository({ cwd: repo, databasePath: dbPath })).rejects.toThrow(/symlink|junction|link/i);
    expect(await readdir(join(outside, "realdir"))).toEqual([]);

    // Dangling junction: target does not even exist.
    await rm(dbPath);
    await symlink(join(repo, ".patchdiet", "missing-target"), dbPath, "junction");
    await expect(indexRepository({ cwd: repo, databasePath: dbPath })).rejects.toThrow(/symlink|junction|link/i);
  });

  it("rejects junctioned intermediate path segments, even inside the same repo", async ({ skip }) => {
    if (!(await canCreateJunctions())) {
      skip("junction creation not permitted in this environment (privilege precondition)");
      return;
    }
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    // "otheruser" is another real directory INSIDE the repo, and "data" is a
    // junction pointing to it: same-repo target, still not run-owned.
    await mkdir(join(repo, "otheruser"), { recursive: true });
    await mkdir(join(repo, ".patchdiet"), { recursive: true });
    await symlink(join(repo, "otheruser"), join(repo, ".patchdiet", "data"), "junction");

    await expect(
      indexRepository({ cwd: repo, databasePath: join(repo, ".patchdiet", "data", "semantic-index.db") }),
    ).rejects.toThrow(/symlink|junction|link/i);
    // Nothing may have been written through the junction.
    expect(await readdir(join(repo, "otheruser"))).toEqual([]);
  });

  it("rejects existing database leaves with external hardlink aliases before opening", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    // An external hardlink alias exists on disk.
    await link(dbPath, join(repo, ".patchdiet", "alias.db"));

    await expect(indexRepository({ cwd: repo, databasePath: dbPath })).rejects.toThrow(/hardlink|nlink|link/i);
    await expect(indexRepository({ cwd: repo, databasePath: join(repo, ".patchdiet", "alias.db") })).rejects.toThrow(
      /hardlink|nlink|link/i,
    );
  });

  it("read-only queries create no sidecar files", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbDir = join(repo, ".patchdiet");
    const dbPath = join(dbDir, "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    const before = (await readdir(dbDir)).sort();
    await withReadonlyIndex(dbPath, (index) => {
      index.querySymbols({});
      index.searchRules("anything");
    });
    const after = (await readdir(dbDir)).sort();
    expect(after).toEqual(before);
  });
});

describe("KnowledgeIndex: deterministic query shapes", () => {
  it("returns identical JSON across two independent indexes of the same repo", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS, "src/m.py": SAMPLE_PY });
    const dbA = join(repo, ".patchdiet", "a.db");
    const dbB = join(repo, ".patchdiet", "b.db");
    await indexRepository({ cwd: repo, databasePath: dbA });
    await indexRepository({ cwd: repo, databasePath: dbB });

    await withReadonlyIndex(dbA, (indexA) => {
      return withReadonlyIndex(dbB, (indexB) => {
        expect(JSON.stringify(indexA.querySymbols({}))).toBe(JSON.stringify(indexB.querySymbols({})));
        expect(JSON.stringify(indexA.getFileGraph("src/m.py"))).toBe(JSON.stringify(indexB.getFileGraph("src/m.py")));
      });
    });
  });

  it("closes handles on error paths", async () => {
    const repo = await initRepo({ "src/a.ts": SAMPLE_TS });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    const index = openKnowledgeIndexReadonly(dbPath);
    expect(index).toBeInstanceOf(KnowledgeIndex);
    index.close();
    expect(() => index.querySymbols({})).toThrow();
  });
});

describe("indexRepository: byte-faithful source decoding", () => {
  it("indexes BOM-prefixed blobs without shifting symbol byte offsets", async () => {
    const bom = Buffer.from("\uFEFFexport function alpha() { return 1; }\n", "utf8");
    const repo = await initRepoWithBytes({ "src/bom.ts": bom });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    await withReadonlyIndex(dbPath, (index) => {
      const alpha = index.querySymbols({ name: "alpha" });
      expect(alpha).toHaveLength(1);
      // 3-byte BOM + "export " (7) = byte 10; span starts at the export
      // keyword, byte 3.
      expect(alpha[0].range.startByte).toBe(10);
      expect(alpha[0].span.startByte).toBe(3);
    });
  });

  it("records invalid-UTF-8 blobs as explicit incomplete entries, never replacement text", async () => {
    // "# " + 0xFF 0xFE + "\n": invalid comment bytes that must not become U+FFFD.
    const invalid = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a, 0x65, 0x78, 0x70, 0x6f, 0x72, 0x74]);
    const repo = await initRepoWithBytes({ "src/bad.js": invalid, "src/ok.ts": Buffer.from(SAMPLE_TS, "utf8") });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    const result = await indexRepository({ cwd: repo, databasePath: dbPath });

    expect(result.files.indexed).toBe(2);
    expect(result.diagnostics.some((d) => d.path === "src/bad.js" && d.complete === false)).toBe(true);

    await withReadonlyIndex(dbPath, (index) => {
      const graph = index.getFileGraph("src/bad.js");
      expect(graph.file.complete).toBe(false);
      expect(graph.file.diagnostics).toEqual([
        expect.objectContaining({ code: "invalid-encoding" }),
      ]);
      expect(graph.symbols).toEqual([]);
      // The valid file still indexes normally.
      expect(index.querySymbols({ name: "alpha" })).toHaveLength(1);
    });
  });
});

describe("indexRepository: pinned-blob rule discovery", () => {
  it("auto-discovers AGENTS.md and docs/rules/*.md from the pinned commit, ignoring dirty edits", async () => {
    const committed = "# Rules\nPreserve billing invariants and protect authentication.\n";
    const repo = await initRepo({
      "src/a.ts": SAMPLE_TS,
      "AGENTS.md": committed,
      "docs/rules/no-raw-secret.md": "---\nname: no-raw-secret\n---\nForbid raw secrets.\n",
    });
    // Dirty local edits must NOT leak into the index (blobs are pinned).
    await writeFile(join(repo, "AGENTS.md"), "# Forged dirty local rule\n", "utf8");
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");

    const result = await indexRepository({ cwd: repo, databasePath: dbPath });
    expect(result.rules.sources.sort()).toEqual(["AGENTS.md", "docs/rules/no-raw-secret.md"]);

    await withReadonlyIndex(dbPath, (index) => {
      const hits = index.searchRules("billing");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ sourcePath: "AGENTS.md", body: committed });
      expect(hits[0].contentSha).toBe(createHash("sha256").update(committed, "utf8").digest("hex"));
      // The dirty content was never indexed.
      expect(index.searchRules("Forged")).toEqual([]);
    });
  });
});

describe("indexRepository: cross-file graph and test relationships", () => {
  it("resolves an aliased cross-file call to the actual target symbol key", async () => {
    const repo = await initRepo({
      "src/main.ts": 'import { helper as wrapped } from "./helper";\nexport function main() { return wrapped(); }\n',
      "src/helper.ts": "export function helper() { return 1; }\n",
      "tests/main.test.ts": 'import { main } from "../src/main";\nmain();\n',
    });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    await withReadonlyIndex(dbPath, (index) => {
      const graph = index.getFileGraph("src/main.ts");
      const call = graph.edges.find((e) => e.kind === "call" && e.toName === "wrapped");
      expect(call).toBeDefined();
      expect(call!.resolved).toBe(true);
      expect(call!.resolution).toBe("import-alias");
      expect(call!.toPath).toBe("src/helper.ts");
      // The cross-file target identity must survive the alias.
      expect(call!.toSymbolKey).toBeTruthy();
      const helperSymbol = index.querySymbols({ name: "helper" })[0];
      expect(call!.toSymbolKey).toBe(helperSymbol.symbolKey);

      // Test mappings derive from the pinned import graph with explicit provenance.
      const mappings = index.getTestMappings({ path: "src/main.ts" });
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings[0]).toMatchObject({ testName: "tests/main.test.ts", filePath: "src/main.ts", provenance: "import-graph" });
    });
  });

  it("leaves dynamic or unresolved calls unresolved rather than guessing", async () => {
    const repo = await initRepo({
      "src/dyn.ts": "export function run(obj) { return obj.method(); }\n",
    });
    const dbPath = join(repo, ".patchdiet", "semantic-index.db");
    await indexRepository({ cwd: repo, databasePath: dbPath });

    await withReadonlyIndex(dbPath, (index) => {
      const graph = index.getFileGraph("src/dyn.ts");
      const methodCall = graph.edges.find((e) => e.kind === "call" && e.toName === "method");
      expect(methodCall).toBeDefined();
      // A member call on an unknown object has no resolvable symbol: honest
      // resolved=false, never a fabricated identity.
      expect(methodCall!.resolved).toBe(false);
      expect(methodCall!.toSymbolKey).toBeNull();
    });
  });
});
