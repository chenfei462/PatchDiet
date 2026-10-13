import { describe, expect, it } from "vitest";

import type { ShrinkReport } from "../../packages/core/src/types.js";
import {
  buildProDashboard,
  createProAuditEvent,
  evaluateProPolicy
} from "../../packages/core/src/pro.js";

const reportA: ShrinkReport = {
  mode: "verified",
  baseRef: "main",
  headRef: "agent/a",
  durationMs: 1200,
  input: {
    fileCount: 5,
    hunkCount: 8,
    addedLineCount: 90,
    removedLineCount: 10,
    changedLineCount: 100
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 35,
    removedLineCount: 5,
    changedLineCount: 40
  },
  testCommand: {
    command: "npm test",
    status: "passed",
    durationMs: 900,
    attempts: 1
  },
  candidates: [],
  removals: [
    {
      filePath: "docs/noise.md",
      hunkHeader: "@@ -0,0 +1,3 @@",
      category: "docs-only",
      riskLevel: "low",
      reason: "removed docs noise",
      confidence: "high-confidence removal"
    },
    {
      filePath: "src/debug.ts",
      hunkHeader: "@@ -1,3 +0,0 @@",
      category: "unknown",
      riskLevel: "medium",
      reason: "removed debug helper",
      confidence: "high-confidence removal"
    }
  ],
  kept: [],
  needsHumanReview: [],
  artifacts: []
};

const reportB: ShrinkReport = {
  ...reportA,
  mode: "preview",
  headRef: "agent/b",
  durationMs: 800,
  input: {
    fileCount: 3,
    hunkCount: 4,
    addedLineCount: 42,
    removedLineCount: 8,
    changedLineCount: 50
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 24,
    removedLineCount: 6,
    changedLineCount: 30
  },
  removals: [
    {
      filePath: "packages/app/generated.generated.ts",
      hunkHeader: "@@ -0,0 +1,2 @@",
      category: "generated-like",
      riskLevel: "low",
      reason: "removed generated noise",
      confidence: "high-confidence removal"
    }
  ]
};

describe("Pro readiness helpers", () => {
  it("builds local dashboard, badge, team metrics, integration summaries, and benchmark trend data", () => {
    const dashboard = buildProDashboard({
      org: "acme",
      repo: "acme/widget",
      reports: [
        { pullRequest: 101, agent: "Codex", report: reportA, createdAt: "2026-06-01T00:00:00.000Z" },
        { pullRequest: 102, agent: "Cursor", report: reportB, createdAt: "2026-06-02T00:00:00.000Z" }
      ],
      badgeBaseUrl: "https://status.patchdiet.example",
      integrations: {
        slackChannel: "#reviews",
        linearTeam: "ENG",
        jiraProject: "PD"
      }
    });

    expect(dashboard.team.org).toBe("acme");
    expect(dashboard.team.totalRuns).toBe(2);
    expect(dashboard.team.verifiedRuns).toBe(1);
    expect(dashboard.team.changedLineReductionPercent).toBe(53);
    expect(dashboard.team.estimatedReviewMinutesSaved).toBeGreaterThan(0);
    expect(dashboard.noisyPaths[0]).toEqual({
      path: "docs/noise.md",
      count: 1,
      changedLinesRemoved: 30
    });
    expect(dashboard.agents).toEqual([
      { agent: "Codex", runs: 1, averageReductionPercent: 60 },
      { agent: "Cursor", runs: 1, averageReductionPercent: 40 }
    ]);
    expect(dashboard.badge.url).toBe("https://status.patchdiet.example/badge/acme/widget.svg");
    expect(dashboard.integrations.slack?.text).toContain("#reviews");
    expect(dashboard.integrations.linear?.title).toContain("ENG");
    expect(dashboard.integrations.jira?.summary).toContain("PD");
    expect(dashboard.auditLog).toHaveLength(2);
    expect(dashboard.benchmarkTrend.points.map((point) => point.pullRequest)).toEqual([101, 102]);
  });

  it("builds stable dashboard audit events and encodes badge URL path segments", () => {
    const options = {
      org: "acme labs",
      repo: "acme labs/widget repo",
      reports: [
        { pullRequest: 101, agent: "Codex", report: reportA, createdAt: "2026-06-01T00:00:00.000Z" }
      ],
      badgeBaseUrl: "https://status.patchdiet.example"
    };

    const first = buildProDashboard(options);
    const second = buildProDashboard(options);

    expect(first.auditLog).toEqual(second.auditLog);
    expect(first.auditLog[0]?.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(first.badge.url).toBe("https://status.patchdiet.example/badge/acme%20labs/widget%20repo.svg");
  });

  it("evaluates explicit Pro policy controls without enabling source upload by default", () => {
    const policy = evaluateProPolicy({
      plan: "business",
      sso: {
        enabled: true,
        provider: "saml",
        metadataUrl: "https://idp.example/saml.xml"
      },
      retentionDays: 30,
      billing: {
        includedVerifiedRuns: 500,
        privateRepos: true,
        runnerMinuteLimit: 1000
      },
      selfHostedRunner: {
        enabled: true,
        label: "patchdiet-self-hosted"
      },
      remoteRunnerCache: {
        enabled: true,
        packageManagers: ["npm", "pnpm"],
        ttlMinutes: 60
      },
      llmRanking: {
        mode: "llm-assisted",
        allowSourceUpload: false,
        promptCacheTtlMinutes: 15
      }
    });

    expect(policy.ready).toBe(true);
    expect(policy.warnings).toEqual([]);
    expect(policy.llmRanking.enabled).toBe(true);
    expect(policy.llmRanking.allowsSourceUpload).toBe(false);
    expect(policy.remoteRunnerCache.key).toBe("npm,pnpm:60");
    expect(policy.billing.meteredBy).toEqual(["verified-runs", "private-repos", "runner-minutes"]);
  });

  it("creates audit events with stable actor, action, subject, and retention metadata", () => {
    const event = createProAuditEvent({
      actor: "octocat",
      action: "policy.update",
      subject: "acme/widget",
      retentionDays: 30,
      metadata: {
        field: "llmRanking.mode",
        from: "local-only",
        to: "llm-assisted"
      }
    });

    expect(event.id).toMatch(/^audit_/);
    expect(event.actor).toBe("octocat");
    expect(event.action).toBe("policy.update");
    expect(event.subject).toBe("acme/widget");
    expect(event.expiresAt).toBeTruthy();
    expect(event.metadata.field).toBe("llmRanking.mode");
  });
});
