import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { candidateSetKey, reduceGroups } from "../../packages/core/src/reducer.js";

const context = {
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  requiredCommands: ["node test.js"],
  environment: "node20-win32-x64",
  toolVersion: "0.2.0",
};

const groups = (ids: string[]) => ids.map((id) => ({
  id,
  contentHash: createHash("sha256").update(id).digest("hex"),
  memberIds: [id],
}));

describe("dependency-group reduction", () => {
  it("keeps one of two substituting changes when removing either alone passes", async () => {
    const tested: string[] = [];
    const result = await reduceGroups(groups(["A", "B"]), context, async (removed) => {
      tested.push(removed.join(""));
      return removed.length === 2 ? "FAIL" : "PASS";
    });

    expect(result.selectedIds).toHaveLength(1);
    expect(result.selectedIds[0]).toBe("A");
    expect(tested).toContain("AB");
    expect(tested).toContain("A");
    expect(tested).toContain("B");
  });

  it("finds a passing complement when all and single groups fail", async () => {
    const result = await reduceGroups(groups(["A", "B", "C"]), context, async (removed) => {
      return removed.join("") === "BC" ? "PASS" : "FAIL";
    });
    expect(result.selectedIds).toEqual(["B", "C"]);
    expect(result.attempts.some((attempt) => attempt.ids.join("") === "BC")).toBe(true);
  });

  it("does not promote an inconclusive combination to a removal", async () => {
    const result = await reduceGroups(groups(["A", "B"]), context, async (removed) => {
      if (removed.length === 2) return "INCONCLUSIVE";
      return removed[0] === "A" ? "PASS" : "INCONCLUSIVE";
    });
    expect(result.selectedIds).toEqual(["A"]);
    expect(result.inconclusive).toBe(true);
  });

  it("keys candidate sets independently of order and invalidates changed context", () => {
    const both = groups(["A", "B"]);
    const key = candidateSetKey(context, both);
    expect(candidateSetKey(context, [...both].reverse())).toBe(key);
    expect(candidateSetKey({ ...context, headSha: "c".repeat(40) }, both)).not.toBe(key);
    expect(candidateSetKey({ ...context, requiredCommands: ["node other.js"] }, both)).not.toBe(key);
    expect(candidateSetKey(context, [{ ...both[0]!, contentHash: "changed" }, both[1]!])).not.toBe(key);
  });

  it("caches repeated conclusive sets but retries inconclusive sets", async () => {
    const seen = new Map<string, number>();
    const result = await reduceGroups(groups(["A", "B", "C"]), context, async (removed) => {
      const key = removed.join("");
      seen.set(key, (seen.get(key) ?? 0) + 1);
      return key === "A" ? "PASS" : key === "BC" ? "INCONCLUSIVE" : "FAIL";
    });
    expect(result.selectedIds).toEqual(["A"]);
    expect(seen.get("A")).toBe(1);
    expect(result.attempts.some((attempt) => attempt.cached)).toBe(true);
  });
});
