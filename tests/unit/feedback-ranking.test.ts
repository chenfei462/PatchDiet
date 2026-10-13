import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedbackFile } from "../../packages/core/src/feedback.js";
import { reduceGroups } from "../../packages/core/src/reducer.js";

const hash = (letter: string) => letter.repeat(64);
const entry = (content: string, verdict: "accepted" | "rejected", ordinal = 0) => ({
  candidateOrdinal: ordinal,
  candidateSha256: hash("a"),
  contentSha256: content,
  path: "src/example.ts",
  verdict,
  reviewedAt: "2026-10-08T00:00:00.000Z",
});
function record(run: string, content: string, verdict: "accepted" | "rejected", repository = hash("f"), duplicates = false): FeedbackFile {
  return {
    schemaVersion: 2,
    runRef: {
      repositoryRootSha256: repository,
      baseCommitSha: "1".repeat(40),
      headCommitSha: "2".repeat(40),
      reportSha256: run,
      cleanupDiffSha256: hash("b"),
    },
    feedback: duplicates ? [entry(content, verdict), entry(content, verdict, 1)] : [entry(content, verdict)],
  };
}

describe("repository-local feedback ranking memory", () => {
  it("requires two independent report identities and counts at most once per run", async () => {
    const mod = await import("../../packages/core/src/feedback.js") as Record<string, unknown>;
    expect(mod.computeFeedbackPriorities).toBeTypeOf("function");
    const compute = mod.computeFeedbackPriorities as (files: FeedbackFile[], repository: string) => Record<string, number>;
    const key = hash("c");
    expect(compute([record(hash("1"), key, "accepted", hash("f"), true)], hash("f"))).toEqual({});
    expect(compute([record(hash("1"), key, "accepted"), record(hash("2"), key, "accepted")], hash("f"))).toEqual({ [key]: 2 });
  });

  it("excludes cross-repository records and any content with a rejected decision", async () => {
    const mod = await import("../../packages/core/src/feedback.js") as Record<string, unknown>;
    const compute = mod.computeFeedbackPriorities as (files: FeedbackFile[], repository: string) => Record<string, number>;
    const key = hash("c");
    expect(compute([record(hash("1"), key, "accepted"), record(hash("2"), key, "accepted", hash("e"))], hash("f"))).toEqual({});
    expect(compute([record(hash("1"), key, "accepted"), record(hash("2"), key, "accepted"), record(hash("3"), key, "rejected")], hash("f"))).toEqual({});
  });

  it("loads only bounded, repository-owned v2 records and fails closed on malformed data", async () => {
    const mod = await import("../../packages/core/src/feedback.js") as Record<string, unknown>;
    expect(mod.loadFeedbackPriorities).toBeTypeOf("function");
    const load = mod.loadFeedbackPriorities as (cwd: string) => { priorities: Record<string, number>; diagnostics: string[] };
    const root = mkdtempSync(join(tmpdir(), "patchdiet-ranking-unit-"));
    try {
      const store = join(root, ".patchdiet", "feedback");
      mkdirSync(store, { recursive: true });
      const canonical = realpathSync(root);
      const repo = createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex");
      const content = hash("c");
      const a = record(hash("1"), content, "accepted", repo);
      const b = record(hash("2"), content, "accepted", repo);
      writeFileSync(join(store, `${a.runRef.reportSha256}.json`), JSON.stringify(a));
      writeFileSync(join(store, `${b.runRef.reportSha256}.json`), JSON.stringify(b));
      expect(load(root).priorities).toEqual({ [content]: 2 });
      writeFileSync(join(store, `${hash("3")}.json`), "{bad json");
      const unsafe = load(root);
      expect(unsafe.priorities).toEqual({});
      expect(unsafe.diagnostics.join(" ")).toMatch(/invalid|malformed|feedback/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("changes only the trial order for already supplied reducer groups", async () => {
    const groups = [
      { id: "a", contentHash: hash("a"), memberIds: ["a"] },
      { id: "z", contentHash: hash("z"), memberIds: ["z"] },
    ];
    const context = { baseSha: "1".repeat(40), headSha: "2".repeat(40), requiredCommands: ["node check.cjs"], environment: hash("e"), toolVersion: "test" };
    const trials: string[][] = [];
    const evaluate = async (ids: string[]) => { trials.push(ids); return ids.length === 1 ? "PASS" as const : "FAIL" as const; };
    const result = await reduceGroups(groups, context, evaluate, { cache: false, priority: { z: 2 } });
    expect(trials[1]).toEqual(["z"]);
    expect(result.selectedIds.every((id) => groups.some((group) => group.id === id))).toBe(true);
  });
});
