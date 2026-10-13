import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createGitHubAppHandler } from "./runtime.mjs";
import { getInstallationAccessToken } from "./auth.mjs";
import { GitHubProvider } from "./github-provider.mjs";

const port = Number(process.env.PATCHDIET_APP_PORT ?? 3000);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PATCHDIET_APP_PORT");

const appId = process.env.PATCHDIET_GITHUB_APP_ID;
const keyPath = process.env.PATCHDIET_GITHUB_PRIVATE_KEY_PATH;
const webhookSecret = process.env.PATCHDIET_GITHUB_WEBHOOK_SECRET ?? "";
const runnerSecret = process.env.PATCHDIET_RUNNER_RECEIPT_SECRET ?? "";
const adminToken = process.env.PATCHDIET_APP_ADMIN_TOKEN ?? "";
const connected = Boolean(appId || keyPath);
if (connected && (!appId || !keyPath || !webhookSecret || !adminToken)) {
  throw new Error("Connected mode requires App id, private key, webhook secret and admin token");
}
const privateKeyPem = connected ? await readFile(keyPath, "utf8") : null;
const allowUnsignedPreview = !connected && process.env.PATCHDIET_ALLOW_UNSIGNED_PREVIEW === "1" && process.env.NODE_ENV !== "production";
if (!connected && !allowUnsignedPreview && !webhookSecret) {
  throw new Error("Set PATCHDIET_GITHUB_WEBHOOK_SECRET or explicitly enable local unsigned preview");
}

const providerFactory = connected ? async ({ installationId }) => {
  const token = await getInstallationAccessToken({ appId, privateKeyPem, installationId, apiUrl: "https://api.github.com" });
  return new GitHubProvider({ token, apiUrl: "https://api.github.com" });
} : null;

const handler = createGitHubAppHandler({ webhookSecret, runnerSecret, adminToken, allowUnsignedPreview,
  allowCleanupBranch: process.env.PATCHDIET_ENABLE_CLEANUP_BRANCH === "1", providerFactory });
const server = createServer(handler);
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
server.listen(port, "127.0.0.1", () => {
  console.log(`PatchDiet GitHub App (${connected ? "connected-preview" : "local-preview"}) listening on http://127.0.0.1:${port}`);
});
