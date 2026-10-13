const PATCHDIET_COMMENT_MARKER = "<!-- patchdiet-comment -->";
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("GitHub API response is too large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isBotAuthor(user) {
  const type = user?.type;
  return type === "Bot" || type === "bot";
}

function nextPageFromLinkHeader(linkHeader, apiUrl) {
  if (!linkHeader) {
    return null;
  }

  for (const part of String(linkHeader).split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/u.exec(part.trim());
    if (!match || match[2] !== "next") {
      continue;
    }

    const next = match[1];
    try {
      const parsed = new URL(next, apiUrl);
      const api = new URL(apiUrl);
      // Only follow same-origin pagination links so a hostile Link header cannot
      // redirect the installation token to an attacker-controlled host.
      if (parsed.origin !== api.origin) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  }

  return null;
}

export class GitHubProvider {
  constructor({ token, apiUrl, fetchImpl = fetch }) {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw new Error("GitHub API URL must be an HTTPS origin");
    }
    this.token = token;
    this.apiUrl = parsed.origin;
    this.fetchImpl = fetchImpl;
  }

  // Single choke point for every GitHub call: the installation token is always
  // attached (private repos and the 5,000 req/h installation rate limit instead
  // of 60 req/h unauthenticated) and non-2xx responses always become errors, so
  // a 404 HTML page can never be mistaken for a diff or JSON payload.
  async #send(path, options = {}) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      throw new Error("GitHub API path must be relative to its trusted origin");
    }
    const parsed = new URL(path, this.apiUrl);
    if (parsed.origin !== this.apiUrl || !parsed.pathname.startsWith("/repos/")) {
      throw new Error("GitHub API path must stay on the trusted origin and repository API");
    }
    const url = parsed.href;
    const headers = {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      ...options.headers
    };

    const response = await this.fetchImpl(url, { ...options, headers, redirect: "error" });

    if (!response.ok) {
      const body = await boundedText(response).catch(() => "");
      throw new Error(`GitHub API error: ${response.status} ${body}`);
    }

    return response;
  }

  async request(path, options = {}) {
    const response = await this.#send(path, options);
    return { data: JSON.parse(await boundedText(response)), response };
  }

  async getPullRequestDiff({ owner, repo, pullNumber }) {
    // The diff media type returns plain text rather than JSON, so it shares the
    // request plumbing but reads the body as text.
    const response = await this.#send(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: { accept: "application/vnd.github.diff" }
    });

    return boundedText(response);
  }

  async getPullRequestComments({ owner, repo, pullNumber, perPage = 100 }) {
    let path = `/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=${perPage}`;
    const comments = [];

    for (let page = 0; page < 10 && path; page += 1) {
      const { data, response } = await this.request(path);
      const batch = Array.isArray(data) ? data : [];
      comments.push(...batch);

      path =
        nextPageFromLinkHeader(response.headers.get("link"), this.apiUrl) ??
        (batch.length === perPage
          ? `/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=${perPage}&page=${page + 2}`
          : null);
    }

    return comments;
  }

  async upsertPullRequestComment({ owner, repo, pullNumber, body }) {
    const comments = await this.getPullRequestComments({ owner, repo, pullNumber });
    const existingComment = comments.find(
      (comment) =>
        typeof comment?.body === "string" &&
        comment.body.includes(PATCHDIET_COMMENT_MARKER) &&
        isBotAuthor(comment.user)
    );

    if (existingComment) {
      await this.request(`/repos/${owner}/${repo}/issues/comments/${existingComment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body })
      });
    } else {
      await this.request(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
    }
  }

  async createCheckRun({ owner, repo, name, headSha, status, conclusion, summary, externalId, annotations = [], actions = [] }) {
    if (annotations.length > 50 || actions.length > 3 || String(summary).length > 3000) {
      throw new Error("Check output exceeds configured bounds");
    }
    const githubAnnotations = annotations.map((item) => ({
      path: item.path, start_line: item.startLine, end_line: item.endLine,
      annotation_level: "notice", message: item.message
    }));
    const { data } = await this.request(`/repos/${owner}/${repo}/check-runs`, {
      method: "POST",
      body: JSON.stringify({
        name,
        head_sha: headSha,
        status,
        conclusion,
        ...(externalId ? { external_id: externalId } : {}),
        output: { title: name, summary, ...(githubAnnotations.length ? { annotations: githubAnnotations } : {}) },
        ...(actions.length ? { actions } : {})
      })
    });

    return data;
  }

  async createBranchRef({ owner, repo, branch, sha }) {
    if (!/^patchdiet\/pr-[1-9][0-9]*-[a-f0-9]{12}$/u.test(branch) || !/^[a-f0-9]{40}$/u.test(sha)) {
      throw new Error("Invalid cleanup branch or commit identity");
    }
    const { data } = await this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    });
    return data;
  }
}
