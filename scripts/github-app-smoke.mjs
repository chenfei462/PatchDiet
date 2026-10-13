import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

runNpm(["run", "build"], process.cwd());

const port = await findFreePort();
const env = {
  ...process.env,
  PATCHDIET_APP_PORT: String(port),
  PATCHDIET_ALLOW_UNSIGNED_PREVIEW: "1"
};

const child = spawn(process.execPath, ["packages/github-app/src/server.mjs"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

const logs = [];
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => logs.push(chunk));
child.stderr.on("data", (chunk) => logs.push(chunk));

try {
  await waitForHealthz(port);
  const health = await fetchJson(`http://127.0.0.1:${port}/healthz`);
  if (!health.ok || health.service !== "patchdiet-github-app") {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
  }

  const webhookBody = JSON.stringify({
    action: "opened",
    repository: {
      owner: { login: "octocat" },
      id: 77,
      name: "Hello-World",
      full_name: "octocat/Hello-World"
    },
    pull_request: {
      number: 6,
      head: { sha: "a".repeat(40) },
      base: { sha: "b".repeat(40) }
    },
    installation: { id: 1 },
    patchdiet_sample_diff: [
      "diff --git a/README.md b/README.md",
      "index 1111111..2222222 100644",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " Hello World!",
      "+Unrelated docs update"
    ].join("\n")
  });
  const webhookSecret = env.PATCHDIET_GITHUB_WEBHOOK_SECRET;

  const webhookResponse = await fetch(`http://127.0.0.1:${port}/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "smoke-delivery-1",
      ...(webhookSecret
        ? { "x-hub-signature-256": `sha256=${createHmac("sha256", webhookSecret).update(webhookBody).digest("hex")}` }
        : {})
    },
    body: webhookBody
  });

  if (!webhookResponse.ok) {
    throw new Error(`Webhook smoke failed with ${webhookResponse.status}`);
  }

  const webhookJson = await webhookResponse.json();
  const jobId = webhookJson.jobId;
  if (!jobId) {
    throw new Error(`Missing jobId in webhook response: ${JSON.stringify(webhookJson)}`);
  }

  await waitForJobCompletion(port, jobId);
  console.log("PatchDiet GitHub App smoke passed");
} finally {
  await stopChild(child);
}

async function waitForHealthz(portNumber) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await delay(250);
  }
  throw new Error(`GitHub App smoke server did not become healthy on port ${portNumber}`);
}

async function waitForJobCompletion(portNumber, jobId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const job = await fetchJson(`http://127.0.0.1:${portNumber}/jobs/${jobId}`);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(`GitHub App smoke job failed: ${JSON.stringify(job)}`);
    }
    await delay(250);
  }
  throw new Error(`GitHub App smoke job ${jobId} did not complete in time`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return await response.json();
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Unable to determine free port")));
      }
    });
  });
}

function stopChild(childProcess) {
  return new Promise((resolve) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve(undefined);
      return;
    }

    childProcess.once("exit", () => resolve(undefined));
    childProcess.kill();
  });
}

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
