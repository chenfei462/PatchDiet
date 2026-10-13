import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { PreviewJobQueue, publicJob } from "./jobs.mjs";
import { renderPreviewComment } from "./comment.mjs";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const EVENTS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function json(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length, "cache-control": "no-store" });
  response.end(bytes);
}

async function bodyBytes(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) fail(413, "Request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function signed(raw, secret, supplied) {
  if (!secret || typeof supplied !== "string" || !/^sha256=[a-f0-9]{64}$/u.test(supplied)) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parse(raw) {
  try {
    const value = JSON.parse(raw.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected JSON object");
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, "Malformed JSON");
  }
}

function identity(event, isPull = true) {
  const repository = event.repository;
  const installationId = event.installation?.id;
  const owner = repository?.owner?.login;
  const repo = repository?.name;
  const repositoryId = repository?.id;
  const pull = isPull ? event.pull_request : event;
  const pullNumber = isPull ? pull?.number : event.pullNumber;
  const headSha = isPull ? pull?.head?.sha : event.headSha;
  const baseSha = isPull ? pull?.base?.sha : event.baseSha;
  if (!NAME.test(owner ?? "") || !NAME.test(repo ?? "") || repository?.full_name !== `${owner}/${repo}` ||
      !Number.isSafeInteger(repositoryId) || repositoryId <= 0 || !Number.isSafeInteger(installationId) || installationId <= 0 ||
      !Number.isSafeInteger(pullNumber) || pullNumber <= 0 || !SHA.test(headSha ?? "") || !SHA.test(baseSha ?? "")) {
    fail(400, "Invalid repository, installation or pull request identity");
  }
  return { owner, repo, repositoryId, installationId, pullNumber, headSha, baseSha };
}

function equalIdentity(a, b) {
  return ["owner", "repo", "repositoryId", "installationId", "pullNumber", "headSha", "baseSha"].every((key) => a[key] === b[key]);
}

function receiptIdentity(receipt) {
  return {
    owner: receipt.owner, repo: receipt.repo, repositoryId: receipt.repositoryId,
    installationId: receipt.installationId, pullNumber: receipt.pullNumber,
    headSha: receipt.headSha, baseSha: receipt.baseSha
  };
}

function validateReceipt(receipt) {
  if (typeof receipt.jobId !== "string" || !DIGEST.test(receipt.reportSha256 ?? "") ||
      !DIGEST.test(receipt.cleanupDiffSha256 ?? "") || !receipt.verification ||
      receipt.verification.exactArtifact !== true || receipt.verification.finalOraclePassed !== true ||
      (receipt.cleanupCommitSha !== undefined && !SHA.test(receipt.cleanupCommitSha)) ||
      !Array.isArray(receipt.candidates) || receipt.candidates.length > 1 ||
      receipt.candidates.some((candidate) => !/^[A-Za-z0-9_-]{1,80}$/u.test(candidate?.id ?? "") || !DIGEST.test(candidate?.contentSha256 ?? "")) ||
      !Array.isArray(receipt.annotations) || receipt.annotations.length > 50 ||
      receipt.annotations.some((a) => typeof a?.path !== "string" || a.path.length > 255 || !/^[A-Za-z0-9_./-]+$/u.test(a.path) || a.path.startsWith("/") || a.path.split("/").some((part) => part === "." || part === ".." || !part) ||
        !Number.isSafeInteger(a.startLine) || a.startLine < 1 || !Number.isSafeInteger(a.endLine) || a.endLine < a.startLine ||
        typeof a.message !== "string" || !a.message || a.message.length > 500)) {
    fail(400, "Invalid verified runner receipt");
  }
}

function checkLivePull(pull, pinned) {
  if (pull?.head?.sha !== pinned.headSha || pull?.base?.sha !== pinned.baseSha || pull?.number !== pinned.pullNumber) {
    fail(409, "Pull request head or base changed");
  }
}

function countDiff(diff) {
  return {
    fileCount: (diff.match(/^diff --git /gm) ?? []).length,
    hunkCount: (diff.match(/^@@ /gm) ?? []).length,
    changedLineCount: (diff.match(/^[+-](?!\+\+|--)/gm) ?? []).length
  };
}

export function createGitHubAppHandler({ webhookSecret = "", runnerSecret = "", adminToken = "", allowUnsignedPreview = false,
  allowCleanupBranch = false, providerFactory = null, maxJobs = 500, jobTtlMs = 60 * 60 * 1000 } = {}) {
  const queue = new PreviewJobQueue({ maxJobs, jobTtlMs });
  const contexts = new Map();
  const verified = new Map();
  const feedback = [];
  const branches = new Set();
  const pruneState = () => {
    queue.prune();
    for (const id of contexts.keys()) {
      if (!queue.get(id)) { contexts.delete(id); verified.delete(id); }
    }
  };
  const provider = (id) => {
    if (!providerFactory) fail(503, "GitHub App credentials are not configured");
    return providerFactory({ installationId: id });
  };
  const authorized = (request) => adminToken && request.headers.authorization === `Bearer ${adminToken}`;

  async function handlePull(event, deliveryId) {
    if (!EVENTS.has(event.action)) return { status: 202, body: { ignored: true } };
    const pinned = identity(event);
    if (!deliveryId || deliveryId.length > 100) fail(400, "Missing or invalid GitHub delivery id");
    const sampleDiff = allowUnsignedPreview && !providerFactory && typeof event.patchdiet_sample_diff === "string" ? event.patchdiet_sample_diff : "";
    if (sampleDiff.length > 512 * 1024) fail(413, "Preview diff is too large");
    const result = queue.enqueue({ deliveryId, ...pinned, run: async () => {
      if (!providerFactory) {
        return { mode: "local-preview", ...countDiff(sampleDiff), suggestions: 0 };
      }
      const api = await provider(pinned.installationId);
      const { data: current } = await api.request(`/repos/${pinned.owner}/${pinned.repo}/pulls/${pinned.pullNumber}`);
      checkLivePull(current, pinned);
      const diff = await api.getPullRequestDiff(pinned);
      if (Buffer.byteLength(diff) > 1024 * 1024) fail(413, "GitHub diff is too large");
      const stats = countDiff(diff);
      const check = await api.createCheckRun({ owner: pinned.owner, repo: pinned.repo, name: "PatchDiet preview", headSha: pinned.headSha,
        status: "completed", conclusion: "neutral", summary: "Diff preview only; no cleanup was verified.", externalId: job.id });
      contexts.get(job.id).previewCheckId = check.id;
      await api.upsertPullRequestComment({ owner: pinned.owner, repo: pinned.repo, pullNumber: pinned.pullNumber,
        body: renderPreviewComment({ input: stats, output: stats, disclaimer: "Preview only; no cleanup was verified" }) });
      return { mode: "connected-preview", ...stats, suggestions: 0 };
    } });
    const { job } = result;
    if (!result.duplicate) contexts.set(job.id, { ...pinned, deliveryId });
    return { status: 202, body: { jobId: job.id, duplicate: result.duplicate } };
  }

  async function handleReceipt(receipt, raw) {
    if (!runnerSecret) fail(503, "Runner receipt signing is not configured");
    validateReceipt(receipt);
    const pinned = contexts.get(receipt.jobId);
    const job = queue.get(receipt.jobId);
    if (!pinned || !job || job.status !== "completed" || job.result?.mode !== "connected-preview" || !equalIdentity(pinned, receiptIdentity(receipt))) {
      fail(409, "Runner receipt does not match a completed pinned PR job");
    }
    const hash = createHash("sha256").update(raw).digest("hex");
    const previous = verified.get(job.id);
    if (previous) {
      if (previous.receiptHash !== hash) fail(409, "Conflicting runner receipt");
      return { verified: true, duplicate: true, jobId: job.id };
    }
    const api = await provider(pinned.installationId);
    const { data: current } = await api.request(`/repos/${pinned.owner}/${pinned.repo}/pulls/${pinned.pullNumber}`);
    checkLivePull(current, pinned);
    const actionLookup = new Map();
    const actions = receipt.candidates.flatMap((candidate) => {
      const suffix = createHash("sha256").update(candidate.id).digest("hex").slice(0, 12);
      const accept = `accept-${suffix}`;
      const reject = `reject-${suffix}`;
      actionLookup.set(accept, { candidateId: candidate.id, verdict: "accepted" });
      actionLookup.set(reject, { candidateId: candidate.id, verdict: "rejected" });
      return [
        { label: "Accept candidate", description: "Record human acceptance", identifier: accept },
        { label: "Reject candidate", description: "Record human rejection", identifier: reject }
      ];
    });
    if (allowCleanupBranch && receipt.cleanupCommitSha) actions.push({ label: "Create cleanup", description: "Create from verified runner commit", identifier: "cleanup-branch" });
    const check = await api.createCheckRun({ owner: pinned.owner, repo: pinned.repo, name: "PatchDiet verified", headSha: pinned.headSha,
      status: "completed", conclusion: "success", summary: `Trusted runner verified report ${receipt.reportSha256} and cleanup patch ${receipt.cleanupDiffSha256}.`,
      externalId: job.id, annotations: receipt.annotations, actions });
    verified.set(job.id, { receiptHash: hash, receipt, checkId: check.id, actionLookup });
    return { verified: true, jobId: job.id };
  }

  async function handleAction(event, deliveryId) {
    if (event.action !== "requested_action") return { status: 202, body: { ignored: true } };
    if (!deliveryId || deliveryId.length > 100) fail(400, "Missing or invalid GitHub delivery id");
    const jobId = event.check_run?.external_id;
    const record = verified.get(jobId);
    const pinned = contexts.get(jobId);
    if (!record || !pinned || event.check_run?.id !== record.checkId || event.check_run?.head_sha !== pinned.headSha ||
        event.repository?.id !== pinned.repositoryId || event.repository?.full_name !== `${pinned.owner}/${pinned.repo}` || event.installation?.id !== pinned.installationId) {
      fail(409, "Requested action does not match verified check and installation");
    }
    const identifier = event.requested_action?.identifier;
    const feedbackAction = record.actionLookup.get(identifier);
    const candidateId = feedbackAction?.candidateId ?? null;
    const verdict = feedbackAction?.verdict ?? null;
    if (!(candidateId && record.receipt.candidates.some((c) => c.id === candidateId)) &&
        !(identifier === "cleanup-branch" && allowCleanupBranch && record.receipt.cleanupCommitSha)) fail(400, "Unsupported requested action");
    const result = queue.enqueue({ ...pinned, deliveryId: `action:${deliveryId}`, run: async () => {
      const api = await provider(pinned.installationId);
      const { data: current } = await api.request(`/repos/${pinned.owner}/${pinned.repo}/pulls/${pinned.pullNumber}`);
      checkLivePull(current, pinned);
      if (candidateId) {
        const candidate = record.receipt.candidates.find((c) => c.id === candidateId);
        const prior = feedback.find((item) => item.jobId === jobId && item.candidateId === candidateId);
        if (prior && prior.verdict !== verdict) fail(409, "Conflicting candidate feedback");
        if (!prior) feedback.push({ jobId, ...pinned, candidateId, contentSha256: candidate.contentSha256, verdict, reportSha256: record.receipt.reportSha256 });
        if (feedback.length > 500) feedback.shift();
        return { mode: "feedback-intent", candidateId, verdict };
      }
      const commitSha = record.receipt.cleanupCommitSha;
      const { data: commit } = await api.request(`/repos/${pinned.owner}/${pinned.repo}/git/commits/${commitSha}`);
      if (commit?.sha !== commitSha || commit?.parents?.length !== 1 || commit.parents[0]?.sha !== pinned.headSha) fail(409, "Cleanup commit is not directly based on pinned PR head");
      const branch = `patchdiet/pr-${pinned.pullNumber}-${pinned.headSha.slice(0, 12)}`;
      if (!branches.has(jobId)) {
        await api.createBranchRef({ owner: pinned.owner, repo: pinned.repo, branch, sha: commitSha });
        branches.add(jobId);
      }
      return { mode: "cleanup-branch", branch };
    } });
    return { status: 202, body: { jobId: result.job.id, duplicate: result.duplicate } };
  }

  const handler = async (request, response) => {
    try {
      pruneState();
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, { ok: true, service: "patchdiet-github-app", mode: providerFactory ? "connected-preview" : "local-preview" }); return;
      }
      if (request.method === "GET" && (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/") || url.pathname === "/runner/actions")) {
        if (!authorized(request) && !(allowUnsignedPreview && !providerFactory && !adminToken)) fail(401, "Unauthorized");
        if (url.pathname === "/runner/actions") { json(response, 200, { feedback }); return; }
        if (url.pathname === "/jobs") { json(response, 200, { jobs: queue.list().map(publicJob) }); return; }
        const job = queue.get(decodeURIComponent(url.pathname.slice(6)));
        if (!job) fail(404, "Job not found");
        json(response, 200, publicJob(job)); return;
      }
      if (request.method === "POST" && (url.pathname === "/github/webhook" || url.pathname === "/runner/receipts")) {
        const raw = await bodyBytes(request);
        const runner = url.pathname === "/runner/receipts";
        if (!runner && !signed(raw, webhookSecret, request.headers["x-hub-signature-256"]) && !(allowUnsignedPreview && !providerFactory && !webhookSecret)) fail(401, "Invalid webhook signature");
        if (runner && !signed(raw, runnerSecret, request.headers["x-patchdiet-runner-signature-256"])) fail(401, "Invalid runner signature");
        const event = parse(raw);
        if (runner) { json(response, 200, await handleReceipt(event, raw)); return; }
        const deliveryId = request.headers["x-github-delivery"];
        const kind = request.headers["x-github-event"];
        const result = kind === "pull_request" ? await handlePull(event, deliveryId) : kind === "check_run" ? await handleAction(event, deliveryId) : { status: 202, body: { ignored: true } };
        json(response, result.status, result.body); return;
      }
      fail(404, "Not found");
    } catch (error) {
      json(response, error.status ?? 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
  handler.queue = queue;
  return handler;
}
