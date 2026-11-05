import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

import { PreviewJobQueue, publicJob } from "./jobs.mjs";

const port = Number(process.env.PATCHDIET_APP_PORT ?? 3000);
const MAX_JOBS = 500;
const JOB_TTL_MS = 60 * 60 * 1000;

// Single job queue module: deduplication by delivery id, statuses, and pruning
// all live in jobs.mjs. The webhook handler only supplies the run closure.
const queue = new PreviewJobQueue({ maxJobs: MAX_JOBS, jobTtlMs: JOB_TTL_MS });

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseJsonBody(rawBody) {
  const text = rawBody.toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function webhookSecret() {
  return process.env.PATCHDIET_GITHUB_WEBHOOK_SECRET ?? "";
}

function signatureMatches(request, rawBody) {
  const secret = webhookSecret();
  if (!secret) {
    return false;
  }

  const header = request.headers["x-hub-signature-256"];
  const signature = Array.isArray(header) ? header[0] : header;
  if (!signature) {
    return false;
  }

  // The digest is computed over the exact bytes GitHub signed. Re-serialising the
  // parsed JSON changes key order and whitespace and would reject valid deliveries.
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const provided = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (provided.length !== wanted.length) {
    return false;
  }
  return timingSafeEqual(provided, wanted);
}

function deliveryIdFor(request, webhook) {
  const header = request.headers["x-github-delivery"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }
  return typeof webhook.deliveryId === "string" ? webhook.deliveryId.trim() : "";
}

function countPreviewStats(diff) {
  return {
    fileCount: diff.split(/\n(?:diff --git|\+\+\+ b\/)/u).filter(Boolean).length,
    hunkCount: (diff.match(/\n@@/gu) ?? []).length,
    changedLineCount: (diff.match(/^[+-](?!$)/gm) ?? []).length
  };
}

function enqueueJob(request, webhook) {
  const pullRequest = webhook.pull_request ?? {};
  const repository = webhook.repository ?? {};
  const installation = webhook.installation ?? {};
  const deliveryId = deliveryIdFor(request, webhook);
  // The sample diff is captured by the run closure instead of being stored on
  // the job, so it can never leak through the /jobs endpoints.
  const sampleDiff = String(webhook.patchdiet_sample_diff ?? "");

  // Redeliveries of the same webhook must not produce a second comment. The key
  // is held while the job is in flight and released once it settles.
  const { job } = queue.enqueue({
    deliveryId,
    owner: repository.owner?.login ?? "",
    repo: repository.name ?? "",
    pullNumber: pullRequest.number ?? null,
    headSha: pullRequest.head?.sha ?? "",
    installationId: installation.id ?? null,
    run: () => {
      const stats = countPreviewStats(sampleDiff);
      return { mode: "preview", ...stats, suggestions: 0 };
    }
  });
  queue.prune();

  return job;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, service: "patchdiet-github-app" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      sendJson(response, 200, { jobs: queue.list().map(publicJob) });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const job = queue.get(url.pathname.slice("/jobs/".length));
      if (!job) {
        sendJson(response, 404, { error: "Job not found" });
        return;
      }
      sendJson(response, 200, publicJob(job));
      return;
    }

    if (request.method === "POST" && url.pathname === "/github/webhook") {
      const rawBody = await readRawBody(request);

      if (!webhookSecret()) {
        // Fail closed outside local development: a deployment that forgot the
        // secret must not accept forgeable pull_request payloads.
        if (process.env.NODE_ENV === "production") {
          sendJson(response, 503, { error: "PATCHDIET_GITHUB_WEBHOOK_SECRET is required" });
          return;
        }
        console.warn("[patchdiet] PATCHDIET_GITHUB_WEBHOOK_SECRET is not set; accepting unsigned webhooks for local development only");
      } else if (!signatureMatches(request, rawBody)) {
        sendJson(response, 401, { error: "Invalid webhook signature" });
        return;
      }

      const webhook = parseJsonBody(rawBody);
      const job = enqueueJob(request, webhook);
      sendJson(response, 202, { jobId: job.id });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PatchDiet GitHub App listening on http://127.0.0.1:${port}`);
});
