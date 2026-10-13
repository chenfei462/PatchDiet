import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const benchmarkRoot = join(root, ".patchdiet", "example-benchmarks");
const outputDir = join(root, ".patchdiet", "pro-readiness");
const examples = [
  { name: "ts-bloated-pr", pullRequest: 101, agent: "Codex" },
  { name: "python-agent-refactor", pullRequest: 102, agent: "Claude Code" },
  { name: "monorepo-scope-creep", pullRequest: 103, agent: "Cursor" }
];

runNpm(["run", "build"], root);
runNpm(["run", "bench:examples"], root);

const {
  buildProDashboard,
  createProAuditEvent,
  evaluateProPolicy
} = await import(`../dist/packages/core/src/pro.js?cache=${Date.now()}`);

const reports = examples.map((example, index) => ({
  pullRequest: example.pullRequest,
  agent: example.agent,
  createdAt: new Date(Date.UTC(2026, 5, index + 1)).toISOString(),
  report: JSON.parse(readFileSync(join(benchmarkRoot, example.name, "run.json"), "utf8"))
}));

const dashboard = buildProDashboard({
  org: "patchdiet-labs",
  repo: "patchdiet-labs/example",
  reports,
  badgeBaseUrl: "https://status.patchdiet.example",
  integrations: {
    slackChannel: "#reviews",
    linearTeam: "ENG",
    jiraProject: "PD"
  }
});

// The dashboard exposes the hosted badge URL; publish README-ready markdown for
// the same badge so downstream docs can paste it without re-deriving the URL.
dashboard.badge.markdown = renderBadgeMarkdown(dashboard.badge.url, dashboard.team.changedLineReductionPercent);

const policyInput = {
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
};

const policy = evaluateProPolicy(policyInput);

const auditLog = [
  ...dashboard.auditLog,
  createProAuditEvent({
    actor: "system",
    action: "policy.evaluated",
    subject: "patchdiet-labs/example",
    retentionDays: policyInput.retentionDays,
    metadata: {
      plan: policyInput.plan,
      ready: String(policy.ready),
      llmMode: policyInput.llmRanking.mode
    }
  })
];

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "dashboard.json"), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
writeFileSync(join(outputDir, "policy.json"), `${JSON.stringify(policy, null, 2)}\n`, "utf8");
writeFileSync(join(outputDir, "audit-log.json"), `${JSON.stringify(auditLog, null, 2)}\n`, "utf8");
writeFileSync(join(outputDir, "benchmark-trend.json"), `${JSON.stringify(dashboard.benchmarkTrend, null, 2)}\n`, "utf8");

console.log(`PatchDiet Pro readiness artifacts written to ${outputDir}`);

function renderBadgeMarkdown(url, reductionPercent) {
  const label = Number.isFinite(reductionPercent) ? `PatchDiet -${reductionPercent}%` : "PatchDiet";
  return `![${label}](${url.replaceAll("(", "%28").replaceAll(")", "%29")})`;
}

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
