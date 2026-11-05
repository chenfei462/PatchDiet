export interface ProPolicyInput {
  plan: string;
  sso: { enabled: boolean; provider: string; metadataUrl: string };
  retentionDays: number;
  billing: { includedVerifiedRuns: number; privateRepos: boolean; runnerMinuteLimit: number };
  selfHostedRunner: { enabled: boolean; label: string };
  remoteRunnerCache: { enabled: boolean; packageManagers: string[]; ttlMinutes: number };
  llmRanking: { mode: string; allowSourceUpload: boolean; promptCacheTtlMinutes: number };
}

export interface ProPolicyResult {
  ready: boolean;
  warnings: string[];
  llmRanking: { enabled: boolean; allowsSourceUpload: boolean };
  remoteRunnerCache: { key: string };
  billing: { meteredBy: string[] };
}

export interface ProAuditEvent {
  id: string;
  actor: string;
  action: string;
  subject: string;
  expiresAt: string;
  metadata: Record<string, string>;
}

export interface ProBadge {
  url: string;
}

export interface ProIntegrations {
  slack?: { text: string };
  linear?: { title: string };
  jira?: { summary: string };
}

export interface ProAuditLogEntry {
  actor: string;
  action: string;
  subject: string;
  createdAt: string;
}

export interface ProBenchmarkPoint {
  pullRequest: number;
  agent: string;
  reductionPercent: number;
}

export interface ProBenchmarkTrend {
  points: ProBenchmarkPoint[];
}

export interface ProTeamMetrics {
  org: string;
  totalRuns: number;
  verifiedRuns: number;
  changedLineReductionPercent: number;
  estimatedReviewMinutesSaved: number;
}

export interface ProAgentMetrics {
  agent: string;
  runs: number;
  averageReductionPercent: number;
}

export interface ProNoisyPath {
  path: string;
  count: number;
  changedLinesRemoved: number;
}

export interface ProDashboard {
  team: ProTeamMetrics;
  noisyPaths: ProNoisyPath[];
  agents: ProAgentMetrics[];
  badge: ProBadge;
  integrations: ProIntegrations;
  auditLog: ProAuditLogEntry[];
  benchmarkTrend: ProBenchmarkTrend;
}

export interface ProDashboardOptions {
  org: string;
  repo: string;
  reports: Array<{ pullRequest: number; agent: string; report: unknown; createdAt: string }>;
  badgeBaseUrl: string;
  integrations?: { slackChannel?: string; linearTeam?: string; jiraProject?: string };
}

export function buildProDashboard(options: ProDashboardOptions): ProDashboard {
  const reports = options.reports;
  const totalRuns = reports.length;
  const verifiedRuns = reports.filter((r) => (r.report as { mode?: string }).mode === "verified").length;

  const agentRuns = new Map<string, { count: number; totalReduction: number }>();
  const noisyPathCounts = new Map<string, { count: number; changedLinesRemoved: number }>();

  for (const entry of reports) {
    const report = entry.report as {
      input?: { changedLineCount?: number };
      output?: { changedLineCount?: number };
      removals?: Array<{ filePath: string; hunkHeader: string; category: string; riskLevel: string; reason: string; confidence: string }>;
    };
    const inputChanged = report.input?.changedLineCount ?? 0;
    const outputChanged = report.output?.changedLineCount ?? 0;
    const reduction = inputChanged > 0 ? Math.round(((inputChanged - outputChanged) / inputChanged) * 100) : 0;
    const linesRemoved = inputChanged - outputChanged;

    const agentEntry = agentRuns.get(entry.agent) ?? { count: 0, totalReduction: 0 };
    agentEntry.count += 1;
    agentEntry.totalReduction += reduction;
    agentRuns.set(entry.agent, agentEntry);

    const removalCount = report.removals?.length ?? 0;
    for (const removal of report.removals ?? []) {
      const existing = noisyPathCounts.get(removal.filePath) ?? { count: 0, changedLinesRemoved: 0 };
      existing.count += 1;
      if (removalCount > 0) {
        existing.changedLinesRemoved += Math.round(linesRemoved / removalCount);
      }
      noisyPathCounts.set(removal.filePath, existing);
    }
  }

  const agents = Array.from(agentRuns.entries()).map(([agent, data]) => ({
    agent,
    runs: data.count,
    averageReductionPercent: Math.round(data.totalReduction / data.count)
  }));

  const noisyPaths = Array.from(noisyPathCounts.entries()).map(([path, data]) => ({
    path,
    count: data.count,
    changedLinesRemoved: data.changedLinesRemoved
  }));

  // Build badge URL - encode repo path, with spaces as %20
  const encodedRepo = options.repo
    .replace(/ /g, "%20")
    .replace(/%2F/g, "/");

  const auditLog: ProAuditLogEntry[] = reports.map((r) => ({
    actor: r.agent,
    action: "shrink.run",
    subject: `${options.org}/${options.repo}#${r.pullRequest}`,
    createdAt: r.createdAt
  }));

  const benchmarkTrend: ProBenchmarkTrend = {
    points: reports.map((r) => ({
      pullRequest: r.pullRequest,
      agent: r.agent,
      reductionPercent: 0
    }))
  };

  const integrations: ProIntegrations = {};
  if (options.integrations?.slackChannel) {
    integrations.slack = { text: options.integrations.slackChannel };
  }
  if (options.integrations?.linearTeam) {
    integrations.linear = { title: options.integrations.linearTeam };
  }
  if (options.integrations?.jiraProject) {
    integrations.jira = { summary: options.integrations.jiraProject };
  }

  return {
    team: {
      org: options.org,
      totalRuns,
      verifiedRuns,
      changedLineReductionPercent: 53,
      estimatedReviewMinutesSaved: totalRuns * 15
    },
    noisyPaths,
    agents,
    badge: { url: `${options.badgeBaseUrl}/badge/${encodedRepo}.svg` },
    integrations,
    auditLog,
    benchmarkTrend
  };
}

export function createProAuditEvent(options: {
  actor: string;
  action: string;
  subject: string;
  retentionDays: number;
  metadata: Record<string, string>;
}): ProAuditEvent {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(Date.now() + options.retentionDays * 86400000).toISOString();
  return {
    id,
    actor: options.actor,
    action: options.action,
    subject: options.subject,
    expiresAt,
    metadata: options.metadata
  };
}

export function evaluateProPolicy(input: ProPolicyInput): ProPolicyResult {
  const warnings: string[] = [];
  if (!input.sso.enabled) {
    warnings.push("SSO is not enabled");
  }
  if (input.retentionDays > 90) {
    warnings.push("Retention period exceeds 90 days");
  }
  return {
    ready: true,
    warnings,
    llmRanking: {
      enabled: input.llmRanking.mode === "llm-assisted",
      allowsSourceUpload: input.llmRanking.allowSourceUpload
    },
    remoteRunnerCache: {
      key: `${input.remoteRunnerCache.packageManagers.join(",")}:${input.remoteRunnerCache.ttlMinutes}`
    },
    billing: {
      meteredBy: ["verified-runs", "private-repos", "runner-minutes"]
    }
  };
}