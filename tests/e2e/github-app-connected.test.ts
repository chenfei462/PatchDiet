import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

const head = "a".repeat(40);
const base = "b".repeat(40);
const cleanup = "c".repeat(40);
const digest = "d".repeat(64);
const repo = { id: 77, owner: { login: "octocat" }, name: "demo", full_name: "octocat/demo" };
const pr = { number: 6, head: { sha: head }, base: { sha: base } };
const opened = { action: "opened", repository: repo, installation: { id: 9 }, pull_request: pr };

function signed(body: string, secret: string, header = "x-hub-signature-256") {
  return { [header]: `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` };
}

describe("connected GitHub App flow", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => { await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); servers.length = 0; });

  it("pins a signed PR, consumes a signed runner receipt, and gates feedback and branch actions", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { createGitHubAppHandler } = await import("../../packages/github-app/src/runtime.mjs");
    const apiCalls: Array<{ path: string; method: string; body: unknown }> = [];
    let liveHead = head;
    const api = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString();
      apiCalls.push({ path: request.url ?? "", method: request.method ?? "", body: raw ? JSON.parse(raw) : null });
      response.setHeader("content-type", "application/json");
      if (request.url === "/repos/octocat/demo/pulls/6" && request.headers.accept === "application/vnd.github.diff") response.end("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n");
      else if (request.url === "/repos/octocat/demo/pulls/6") response.end(JSON.stringify({ ...pr, head: { sha: liveHead }, base: { sha: base } }));
      else if (request.url === `/repos/octocat/demo/git/commits/${cleanup}`) response.end(JSON.stringify({ sha: cleanup, parents: [{ sha: head }] }));
      else if (request.url?.includes("/comments?")) response.end("[]");
      else response.end(JSON.stringify({ id: 123 }));
    });
    servers.push(api);
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const forwardedFetch = (url: string, init: RequestInit) => fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}${new URL(url).search}`, init);
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { GitHubProvider } = await import("../../packages/github-app/src/github-provider.mjs");
    const handler = createGitHubAppHandler({ webhookSecret: "webhook-secret", runnerSecret: "runner-secret", adminToken: "admin-secret", allowCleanupBranch: true,
      providerFactory: ({ installationId }: { installationId: number }) => { expect(installationId).toBe(9); return new GitHubProvider({ token: "installation-token", apiUrl: "https://api.github.test", fetchImpl: forwardedFetch }); } });
    const app = createServer(handler);
    servers.push(app);
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const appAddress = app.address();
    if (!appAddress || typeof appAddress === "string") throw new Error("no app port");
    const origin = `http://127.0.0.1:${appAddress.port}`;
    const post = async (path: string, payload: unknown, headers: Record<string, string>) => {
      const body = JSON.stringify(payload);
      const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    };
    const eventBody = JSON.stringify(opened);
    expect((await post("/github/webhook", opened, { "x-github-event": "pull_request", "x-github-delivery": "delivery-1", ...signed(eventBody, "wrong") })).status).toBe(401);
    const accepted = await post("/github/webhook", opened, { "x-github-event": "pull_request", "x-github-delivery": "delivery-1", ...signed(eventBody, "webhook-secret") });
    expect(accepted.status).toBe(202);
    const duplicate = await post("/github/webhook", opened, { "x-github-event": "pull_request", "x-github-delivery": "delivery-1", ...signed(eventBody, "webhook-secret") });
    expect(duplicate.data.jobId).toBe(accepted.data.jobId);
    expect((await fetch(`${origin}/jobs/${accepted.data.jobId}`)).status).toBe(401);
    for (let i = 0; i < 30; i++) {
      const status = await (await fetch(`${origin}/jobs/${accepted.data.jobId}`, { headers: { authorization: "Bearer admin-secret" } })).json() as { status: string };
      if (status.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(apiCalls.some((call) => call.path.endsWith("/check-runs"))).toBe(true);
    expect(apiCalls.some((call) => call.path.endsWith("/comments"))).toBe(true);
    expect(apiCalls.some((call) => call.path.endsWith("/git/refs"))).toBe(false);
    const receipt = { jobId: accepted.data.jobId, owner: "octocat", repo: "demo", repositoryId: 77, installationId: 9, pullNumber: 6, baseSha: base, headSha: head,
      reportSha256: digest, cleanupDiffSha256: digest, cleanupCommitSha: cleanup, verification: { exactArtifact: true, finalOraclePassed: true },
      annotations: [{ path: "src/a.ts", startLine: 1, endLine: 1, message: "Review this candidate" }], candidates: [{ id: "candidate-1", contentSha256: digest }] };
    const receiptBody = JSON.stringify(receipt);
    expect((await post("/runner/receipts", receipt, signed(receiptBody, "wrong", "x-patchdiet-runner-signature-256"))).status).toBe(401);
    expect((await post("/runner/receipts", { ...receipt, installationId: 10 }, signed(JSON.stringify({ ...receipt, installationId: 10 }), "runner-secret", "x-patchdiet-runner-signature-256"))).status).toBe(409);
    liveHead = "f".repeat(40);
    expect((await post("/runner/receipts", receipt, signed(receiptBody, "runner-secret", "x-patchdiet-runner-signature-256"))).status).toBe(409);
    liveHead = head;
    const forgedVerification = { ...receipt, verification: { exactArtifact: true, finalOraclePassed: false } };
    expect((await post("/runner/receipts", forgedVerification, signed(JSON.stringify(forgedVerification), "runner-secret", "x-patchdiet-runner-signature-256"))).status).toBe(400);
    const verified = await post("/runner/receipts", receipt, signed(receiptBody, "runner-secret", "x-patchdiet-runner-signature-256"));
    expect(verified.status).toBe(200);
    const retriedReceipt = await post("/runner/receipts", receipt, signed(receiptBody, "runner-secret", "x-patchdiet-runner-signature-256"));
    expect(retriedReceipt.data.duplicate).toBe(true);
    const conflictingReceipt = { ...receipt, reportSha256: "e".repeat(64) };
    expect((await post("/runner/receipts", conflictingReceipt, signed(JSON.stringify(conflictingReceipt), "runner-secret", "x-patchdiet-runner-signature-256"))).status).toBe(409);
    expect(apiCalls.filter((call) => call.path.endsWith("/check-runs")).length).toBe(2);
    const check = apiCalls.filter((call) => call.path.endsWith("/check-runs")).at(-1)?.body as { conclusion: string; output: { annotations: Array<{ start_line: number; annotation_level: string }> }; actions: Array<{ identifier: string; label: string; description: string }> };
    expect(check.conclusion).toBe("success");
    expect(check.output.annotations).toHaveLength(1);
    expect(check.output.annotations[0]).toMatchObject({ start_line: 1, annotation_level: "notice" });
    expect(check.actions).toHaveLength(3);
    expect(check.actions.every((item) => item.identifier.length <= 20 && item.label.length <= 20 && item.description.length <= 40)).toBe(true);
    const action = { action: "requested_action", repository: repo, installation: { id: 9 }, requested_action: { identifier: check.actions[0]?.identifier }, check_run: { id: 123, external_id: accepted.data.jobId, head_sha: head } };
    const actionBody = JSON.stringify(action);
    const actionHeaders = { "x-github-event": "check_run", "x-github-delivery": "action-1", ...signed(actionBody, "webhook-secret") };
    expect((await post("/github/webhook", action, actionHeaders)).status).toBe(202);
    expect((await post("/github/webhook", action, actionHeaders)).data.duplicate).toBe(true);
    for (let i = 0; i < 30; i++) {
      const actions = await (await fetch(`${origin}/runner/actions`, { headers: { authorization: "Bearer admin-secret" } })).json() as { feedback: unknown[] };
      if (actions.feedback.length === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const actions = await (await fetch(`${origin}/runner/actions`, { headers: { authorization: "Bearer admin-secret" } })).json() as { feedback: Array<{ verdict: string; candidateId: string }> };
    expect(actions.feedback).toMatchObject([{ verdict: "accepted", candidateId: "candidate-1" }]);
    const branch = { ...action, requested_action: { identifier: "cleanup-branch" } };
    const branchResponse = await post("/github/webhook", branch, { "x-github-event": "check_run", "x-github-delivery": "action-2", ...signed(JSON.stringify(branch), "webhook-secret") });
    expect(branchResponse.status).toBe(202);
    let branchJob: { status: string; error?: string } = { status: "in_flight" };
    for (let i = 0; i < 40; i++) {
      branchJob = await (await fetch(`${origin}/jobs/${branchResponse.data.jobId}`, { headers: { authorization: "Bearer admin-secret" } })).json() as typeof branchJob;
      if (branchJob.status !== "in_flight") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(branchJob).toMatchObject({ status: "completed" });
    expect(apiCalls.some((call) => call.path.endsWith("/git/refs") && call.method === "POST")).toBe(true);
  });
});
