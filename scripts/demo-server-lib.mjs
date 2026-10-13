import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export function parseGitHubPullRequestUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Expected a GitHub pull request URL");
  }

  if (url.hostname !== "github.com") {
    throw new Error("Expected a GitHub pull request URL");
  }

  const [owner, repo, pullSegment, pullNumberText] = url.pathname.split("/").filter(Boolean);
  const pullNumber = Number.parseInt(pullNumberText ?? "", 10);
  if (!owner || !repo || pullSegment !== "pull" || !Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("Expected a GitHub pull request URL like https://github.com/owner/repo/pull/123");
  }

  return { owner, repo, pullNumber };
}

export function resolveDemoRequestPath(pathname) {
  // Return undefined for invalid or empty pathnames
  if (!pathname || typeof pathname !== "string") {
    return undefined;
  }
  if (pathname === "/" || pathname === "/demo/") {
    return "/demo/index.html";
  }
  if (pathname === "/demo/classic/") {
    return "/demo/classic/index.html";
  }

  return pathname;
}

export function resolveDemoStaticFile(rootDirectory, urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  const root = resolve(rootDirectory);
  const filePath = resolve(root, `.${normalize(decodedPath)}`);
  const allowedRoots = [
    join(root, "demo"),
    join(root, "docs", "assets"),
    join(root, "examples")
  ];
  if (!allowedRoots.some((allowedRoot) => isInsidePath(allowedRoot, filePath))) {
    return undefined;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return undefined;
  }

  return { filePath, contentType: contentTypeForPath(filePath) };
}

// Public repository allowlist for the demo's PR diff fetcher. Keep the default
// limited to repositories the demo documentation actually advertises; everything
// else is rejected before any outbound request is made. Operators can widen the
// allowlist without a code change through PATCHDIET_DEMO_ALLOWED_REPOS.
const ALLOWED_REPOS_ENV_VAR = "PATCHDIET_DEMO_ALLOWED_REPOS";

const DEFAULT_ALLOWED_REPOS = new Set([
  "openai/codex",
  // Documented demo PR: docs/demo.md "Public PR URL Fetch" and the recorded launch flow.
  "octocat/hello-world"
]);

function parseAllowlistEnvValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const entries = value
    .split(/[\s,;]+/u)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[^/\s]+\/[^/\s]+$/u.test(entry));

  // An empty or unparseable value must not silently deny every repository
  // (that regressed the whole /api/pr endpoint once); fall back to the defaults.
  return entries.length > 0 ? new Set(entries) : null;
}

export function getDemoAllowedRepos() {
  return parseAllowlistEnvValue(process.env[ALLOWED_REPOS_ENV_VAR]) ?? DEFAULT_ALLOWED_REPOS;
}

function assertRepositoryAllowed(owner, repo) {
  // GitHub owner/repo names are case-insensitive.
  const repoKey = `${owner}/${repo}`.toLowerCase();
  if (!getDemoAllowedRepos().has(repoKey)) {
    throw new Error(
      `Repository ${owner}/${repo} is not in the demo allowlist. The demo only fetches diffs for pre-approved public repositories; set ${ALLOWED_REPOS_ENV_VAR} to a comma-separated list of "owner/repo" values to allow more.`
    );
  }
}

export async function fetchPublicPullRequestDiff(
  pullRequestUrl,
  {
    apiUrl = "https://api.github.com",
    fetchImpl = fetch,
    timeoutMs = 15000,
    maxDiffBytes = 2 * 1024 * 1024
  } = {}
) {
  const parsed = parseGitHubPullRequestUrl(pullRequestUrl);

  assertRepositoryAllowed(parsed.owner, parsed.repo);

  const headers = {
    accept: "application/vnd.github.diff",
    "user-agent": "patchdiet-demo"
  };

  const encodedOwner = encodeURIComponent(parsed.owner);
  const encodedRepo = encodeURIComponent(parsed.repo);
  const response = await fetchImpl(
    `${apiUrl.replace(/\/$/, "")}/repos/${encodedOwner}/${encodedRepo}/pulls/${parsed.pullNumber}`,
    { headers, signal: AbortSignal.timeout(timeoutMs) }
  );

  if (!response.ok) {
    throw new Error(`Could not fetch public PR diff: ${response.status} ${response.statusText}`);
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxDiffBytes) {
    throw new Error(`Public PR diff is too large (${contentLength} bytes)`);
  }

  return {
    ...parsed,
    projectName: `${parsed.owner}/${parsed.repo}#${parsed.pullNumber}`,
    diff: await readResponseTextWithLimit(response, maxDiffBytes)
  };
}

async function readResponseTextWithLimit(response, maxBytes) {
  const stream = response.body;

  if (!stream || typeof stream.getReader !== "function") {
    // No streaming body available; buffer and enforce the limit afterwards.
    const text = await response.text();
    const byteLength = Buffer.byteLength(text, "utf8");
    if (byteLength > maxBytes) {
      throw new Error(`Public PR diff is too large (${byteLength} bytes)`);
    }
    return text;
  }

  const reader = stream.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        // Stop reading before the oversized body is ever fully buffered.
        throw new Error(`Public PR diff is too large (limit is ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  // Decoding the concatenated bytes at once keeps multi-byte UTF-8 characters
  // intact across chunk boundaries.
  return Buffer.concat(chunks).toString("utf8");
}

function isInsidePath(parent, child) {
  const result = relative(parent, child);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

function contentTypeForPath(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".diff":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".woff2":
      return "font/woff2";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
