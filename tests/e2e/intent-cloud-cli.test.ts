import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("intent-extract CLI consent", () => {
  it("is local by default and refuses a configured provider without upload consent", () => {
    const root = mkdtempSync(join(tmpdir(), "patchdiet-intent-cli-"));
    try {
      writeFileSync(join(root, "sources.json"), JSON.stringify([{ id: "cli", kind: "cli", text: "Fix login" }]));
      const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
      const env = { ...process.env, PATCHDIET_TARGET_CWD: root, PATCHDIET_INTENT_API_TOKEN: "test-token" };
      const local = spawnSync(process.execPath, [cli, "intent-extract", "--sources", "sources.json"], { env, encoding: "utf8" });
      expect(local.status).toBe(0);
      expect(JSON.parse(local.stdout)).toMatchObject({ status: "off", local: { goal: "Fix login" } });
      const missingConsent = spawnSync(process.execPath, [cli, "intent-extract", "--sources", "sources.json", "--provider-url", "https://intent.example.test/v1/extract", "--model", "intent-test"], { env, encoding: "utf8" });
      expect(missingConsent.status).not.toBe(0);
      expect(missingConsent.stderr).toMatch(/consent/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
