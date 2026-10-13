import { createSign } from "node:crypto";

function base64urlEncode(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function createGitHubAppJwt({ appId, privateKeyPem, now = new Date() }) {
  const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss: appId,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 600
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64urlEncode(signature)}`;
}

export async function getInstallationAccessToken({ appId, privateKeyPem, installationId, apiUrl, fetchImpl = fetch, now = new Date() }) {
  const apiBaseUrl = new URL(apiUrl);
  if (apiBaseUrl.protocol !== "https:" || apiBaseUrl.hostname !== "api.github.com" || apiBaseUrl.port || apiBaseUrl.username || apiBaseUrl.password || apiBaseUrl.pathname !== "/" || apiBaseUrl.search || apiBaseUrl.hash) {
    throw new Error("Must use a trusted GitHub API URL");
  }

  const jwt = createGitHubAppJwt({ appId, privateKeyPem, now });
  if (!Number.isSafeInteger(Number(installationId)) || Number(installationId) <= 0) {
    throw new Error("Invalid installation id");
  }
  const url = `${apiBaseUrl.origin}/app/installations/${installationId}/access_tokens`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to get installation token: ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.token !== "string" || !data.token) {
      throw new Error("Installation token response is missing a token");
    }
    return data.token;
  } finally {
    clearTimeout(timeout);
  }
}
