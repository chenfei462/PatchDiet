import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import {
  fetchPublicPullRequestDiff,
  resolveDemoRequestPath,
  resolveDemoStaticFile
} from "./demo-server-lib.mjs";

const root = resolve(process.cwd());
const demoRoot = join(root, "demo");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PatchDiet demo: http://127.0.0.1:${port}/demo/`);
  console.log(`Serving ${demoRoot}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/pr") {
    await handlePullRequestApi(url, response);
    return;
  }

  const requestedPath = resolveDemoRequestPath(url.pathname);
  const asset = resolveDemoStaticFile(root, requestedPath);
  if (!asset) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stream = createReadStream(asset.filePath);
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Internal server error");
  });
  response.writeHead(200, { "content-type": asset.contentType });
  stream.pipe(response);
}

async function handlePullRequestApi(url, response) {
  const pullRequestUrl = url.searchParams.get("url");
  if (!pullRequestUrl) {
    sendJson(response, 400, { error: "Missing url query parameter" });
    return;
  }

  try {
    const result = await fetchPublicPullRequestDiff(pullRequestUrl);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}
