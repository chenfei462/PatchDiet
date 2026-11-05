import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Pro readiness sample", () => {
  // The script rebuilds the monorepo and reruns every example benchmark, so it
  // needs minutes under full-suite load. Keep vitest's budget above the child
  // process's own 240s timeout so a hung child reports its real error.
  it(
    "generates dashboard, policy, audit, and benchmark trend artifacts",
    { timeout: 300000 },
    async () => {
      const outputDir = join(process.cwd(), ".patchdiet", "pro-readiness");
      rmSync(outputDir, { recursive: true, force: true });

      await execFileAsync("node", ["scripts/generate-pro-readiness.mjs"], {
        cwd: process.cwd(),
        timeout: 240000
      });

      const dashboardPath = join(outputDir, "dashboard.json");
      const policyPath = join(outputDir, "policy.json");
      const auditPath = join(outputDir, "audit-log.json");
      const trendPath = join(outputDir, "benchmark-trend.json");

      expect(existsSync(dashboardPath)).toBe(true);
      expect(existsSync(policyPath)).toBe(true);
      expect(existsSync(auditPath)).toBe(true);
      expect(existsSync(trendPath)).toBe(true);

      const dashboard = JSON.parse(readFileSync(dashboardPath, "utf8")) as {
        team?: { totalRuns?: number; changedLineReductionPercent?: number };
        badge?: { markdown?: string };
        integrations?: { slack?: { text?: string }; linear?: unknown; jira?: unknown };
      };
      const policy = JSON.parse(readFileSync(policyPath, "utf8")) as {
        ready?: boolean;
        llmRanking?: { allowsSourceUpload?: boolean };
        billing?: { meteredBy?: string[] };
        remoteRunnerCache?: { key?: string };
      };

      expect(dashboard.team?.totalRuns).toBeGreaterThan(0);
      expect(dashboard.team?.changedLineReductionPercent).toBeGreaterThanOrEqual(0);
      expect(dashboard.badge?.markdown).toContain("PatchDiet");
      expect(dashboard.integrations?.slack?.text).toContain("#reviews");
      expect(dashboard.integrations?.linear).toBeTruthy();
      expect(dashboard.integrations?.jira).toBeTruthy();
      expect(policy.ready).toBe(true);
      expect(policy.llmRanking?.allowsSourceUpload).toBe(false);
      expect(policy.billing?.meteredBy).toContain("verified-runs");
      expect(policy.remoteRunnerCache?.key).toContain("npm");
    }
  );
});
