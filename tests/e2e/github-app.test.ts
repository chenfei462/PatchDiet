import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

describe("GitHub App runtime", () => {
  it("creates a GitHub App JWT and exchanges it for an installation token", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { createGitHubAppJwt, getInstallationAccessToken } = await import("../../packages/github-app/src/auth.mjs");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const publicKey = createPublicKey(privateKey);

    const jwt = createGitHubAppJwt({
      appId: "12345",
      privateKeyPem,
      now: new Date("2026-05-24T00:00:00Z")
    });
    const [encodedHeader, encodedPayload, encodedSignature] = jwt.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader!, "base64url").toString("utf8")) as { alg: string; typ: string };
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8")) as {
      iss: string;
      iat: number;
      exp: number;
    };

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("12345");
    expect(payload.exp - payload.iat).toBe(600);
    expect(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature!, "base64url"))).toBe(true);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const token = await getInstallationAccessToken({
      appId: "12345",
      privateKeyPem,
      installationId: 987,
      apiUrl: "https://api.github.com",
      now: new Date("2026-05-24T00:00:00Z"),
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
      }
    });

    expect(token).toBe("installation-token");
    expect(calls[0]?.url).toBe("https://api.github.com/app/installations/987/access_tokens");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
  });

  it("rejects untrusted installation token API URLs before sending the app JWT", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { getInstallationAccessToken } = await import("../../packages/github-app/src/auth.mjs");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    await expect(
      getInstallationAccessToken({
        appId: "12345",
        privateKeyPem,
        installationId: 987,
        apiUrl: "https://tokens.example.test",
        fetchImpl: async () => {
          throw new Error("fetch should not be called");
        }
      })
    ).rejects.toThrow(/trusted GitHub API URL/);
  });

  it("rejects plaintext GitHub API token exchange and redirects", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { getInstallationAccessToken } = await import("../../packages/github-app/src/auth.mjs");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    let sent = 0;
    await expect(getInstallationAccessToken({
      appId: "123", privateKeyPem, installationId: 7, apiUrl: "http://api.github.com",
      fetchImpl: async () => { sent += 1; return new Response("{}"); }
    })).rejects.toThrow(/trusted GitHub API URL|HTTPS/);
    expect(sent).toBe(0);
    await getInstallationAccessToken({
      appId: "123", privateKeyPem, installationId: 7, apiUrl: "https://api.github.com",
      fetchImpl: async (_url: string, init: RequestInit) => {
        expect(init.redirect).toBe("error");
        return new Response(JSON.stringify({ token: "safe" }), { status: 201 });
      }
    });
  });

  it("never sends installation credentials to an external URL or redirect", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { GitHubProvider } = await import("../../packages/github-app/src/github-provider.mjs");
    let sent = 0;
    const provider = new GitHubProvider({ token: "secret", apiUrl: "https://api.github.test", fetchImpl: async (_url: string, init: RequestInit) => {
      sent += 1;
      expect(init.redirect).toBe("error");
      return new Response(JSON.stringify({ ok: true }));
    } });
    await expect(provider.request("https://attacker.example/steal")).rejects.toThrow(/origin|URL|path/);
    await expect(provider.request("//attacker.example/steal")).rejects.toThrow(/origin|URL|path/);
    expect(sent).toBe(0);
    await provider.request("/repos/o/r");
    expect(sent).toBe(1);
  });

  it("fetches a real PR diff media type and upserts the PatchDiet comment", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { GitHubProvider } = await import("../../packages/github-app/src/github-provider.mjs");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new GitHubProvider({
      token: "installation-token",
      apiUrl: "https://api.github.test",
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (String(url).endsWith("/pulls/42")) {
          return new Response("diff --git a/README.md b/README.md\n", { status: 200 });
        }
        if (String(url).endsWith("/issues/42/comments?per_page=100") && !init.method) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (String(url).endsWith("/issues/42/comments") && init.method === "POST") {
          return new Response(JSON.stringify({ id: 123 }), { status: 201 });
        }
        throw new Error(`unexpected fetch ${url}`);
      }
    });

    const diff = await provider.getPullRequestDiff({ owner: "openai", repo: "patchdiet", pullNumber: 42 });
    await provider.upsertPullRequestComment({
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      body: "<!-- patchdiet-comment -->\n## PatchDiet"
    });

    expect(diff).toContain("diff --git");
    expect((calls[0]?.init.headers as Record<string, string>).accept).toBe("application/vnd.github.diff");
    expect(calls.some((call) => call.init.method === "POST")).toBe(true);
  });

  it("paginates comments and only updates bot-authored PatchDiet comments", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { GitHubProvider } = await import("../../packages/github-app/src/github-provider.mjs");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new GitHubProvider({
      token: "installation-token",
      apiUrl: "https://api.github.test",
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const textUrl = String(url);
        if (textUrl.endsWith("/issues/42/comments?per_page=100")) {
          return new Response(
            JSON.stringify([
              {
                id: 1,
                body: "<!-- patchdiet-comment -->\nnot the app",
                user: { type: "User" }
              }
            ]),
            {
              status: 200,
              headers: {
                link: '<https://api.github.test/repos/openai/patchdiet/issues/42/comments?per_page=100&page=2>; rel="next"'
              }
            }
          );
        }
        if (textUrl.endsWith("page=2")) {
          return new Response(
            JSON.stringify([
              {
                id: 2,
                body: "<!-- patchdiet-comment -->\nold",
                user: { type: "Bot" }
              }
            ]),
            { status: 200 }
          );
        }
        if (textUrl.endsWith("/issues/comments/2") && init.method === "PATCH") {
          return new Response(JSON.stringify({ id: 2 }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      }
    });

    await provider.upsertPullRequestComment({
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      body: "<!-- patchdiet-comment -->\n## PatchDiet"
    });

    expect(calls.some((call) => String(call.url).endsWith("page=2"))).toBe(true);
    expect(calls.some((call) => String(call.url).endsWith("/issues/comments/2") && call.init.method === "PATCH")).toBe(true);
    expect(calls.some((call) => String(call.url).endsWith("/issues/comments/1") && call.init.method === "PATCH")).toBe(false);
  });

  it("creates a neutral preview check run when the provider supports checks", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { GitHubProvider } = await import("../../packages/github-app/src/github-provider.mjs");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new GitHubProvider({
      token: "installation-token",
      apiUrl: "https://api.github.test",
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 456 }), { status: 201 });
      }
    });

    await provider.createCheckRun({
      owner: "openai",
      repo: "patchdiet",
      name: "PatchDiet preview",
      headSha: "abc123",
      status: "completed",
      conclusion: "neutral",
      summary: "preview only"
    });

    expect(calls[0]?.url).toBe("https://api.github.test/repos/openai/patchdiet/check-runs");
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      name: string;
      head_sha: string;
      conclusion: string;
      output: { summary: string };
    };
    expect(body.name).toBe("PatchDiet preview");
    expect(body.head_sha).toBe("abc123");
    expect(body.conclusion).toBe("neutral");
    expect(body.output.summary).toContain("preview");
  });

  it("deduplicates preview jobs by webhook delivery id", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { PreviewJobQueue } = await import("../../packages/github-app/src/jobs.mjs");
    const queue = new PreviewJobQueue({ now: () => new Date("2026-05-25T00:00:00Z") });

    const first = queue.enqueue({
      deliveryId: "delivery-1",
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      installationId: 1,
      run: async () => ({ mode: "preview", suggestions: 1 })
    });
    const second = queue.enqueue({
      deliveryId: "delivery-1",
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      installationId: 1,
      run: async () => ({ mode: "preview", suggestions: 2 })
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.get(first.job.id)?.status).toBe("completed");
    expect(queue.get(first.job.id)?.result).toEqual({ mode: "preview", suggestions: 1 });
  });

  it("keeps delivery dedupe keys after a job finishes until it is pruned", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { PreviewJobQueue } = await import("../../packages/github-app/src/jobs.mjs");
    const queue = new PreviewJobQueue({ now: () => new Date("2026-05-25T00:00:00Z") });

    const first = queue.enqueue({
      deliveryId: "delivery-2",
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      installationId: 1,
      run: async () => ({ mode: "preview", suggestions: 1 })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = queue.enqueue({
      deliveryId: "delivery-2",
      owner: "openai",
      repo: "patchdiet",
      pullNumber: 42,
      installationId: 1,
      run: async () => ({ mode: "preview", suggestions: 2 })
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it("lists preview jobs in numeric id order", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { PreviewJobQueue } = await import("../../packages/github-app/src/jobs.mjs");
    const queue = new PreviewJobQueue({ now: () => new Date("2026-05-25T00:00:00Z") });

    for (let index = 0; index < 10; index += 1) {
      queue.enqueue({
        owner: "openai",
        repo: "patchdiet",
        pullNumber: index + 1,
        installationId: 1,
        run: async () => ({ mode: "preview", suggestions: index })
      });
    }

    expect(queue.list().map((job: { id: string }) => job.id)).toEqual([
      "preview-1",
      "preview-2",
      "preview-3",
      "preview-4",
      "preview-5",
      "preview-6",
      "preview-7",
      "preview-8",
      "preview-9",
      "preview-10"
    ]);
  });

  it("escapes preview comment table cells", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { renderPreviewComment } = await import("../../packages/github-app/src/comment.mjs");

    const comment = renderPreviewComment({
      input: { fileCount: 1, hunkCount: 1, changedLineCount: 1 },
      output: { fileCount: 1, hunkCount: 1, changedLineCount: 1 },
      metrics: { savedReviewTimePercent: 10, suggestedDeletionHunks: 1 },
      suggestions: [
        {
          filePath: "docs/a|b.md\nfake-row",
          category: "docs|only",
          reason: "line1\nline2 | more"
        }
      ],
      disclaimer: "preview"
    });

    expect(comment).toContain("docs/a\\|b.md fake-row");
    expect(comment).toContain("docs\\|only");
    expect(comment).toContain("line1 line2 \\| more");
  });
});
