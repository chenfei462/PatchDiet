import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("demo server backend", () => {
  it("resolves default and Classic demo index routes without rewriting assets", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { resolveDemoRequestPath } = await import("../../scripts/demo-server-lib.mjs");

    expect(resolveDemoRequestPath("/")).toBe("/demo/index.html");
    expect(resolveDemoRequestPath("/demo/")).toBe("/demo/index.html");
    expect(resolveDemoRequestPath("/demo/classic/")).toBe("/demo/classic/index.html");
    expect(resolveDemoRequestPath("/demo/classic/workspace.html")).toBe("/demo/classic/workspace.html");
    expect(resolveDemoRequestPath("/demo/classic/styles.css")).toBe("/demo/classic/styles.css");
  });

  it("parses public GitHub PR URLs and fetches diff media type", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { fetchPublicPullRequestDiff, parseGitHubPullRequestUrl } = await import("../../scripts/demo-server-lib.mjs");

    expect(parseGitHubPullRequestUrl("https://github.com/openai/codex/pull/123")).toEqual({
      owner: "openai",
      repo: "codex",
      pullNumber: 123
    });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await fetchPublicPullRequestDiff("https://github.com/openai/codex/pull/123", {
      apiUrl: "https://api.github.test",
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("diff --git a/README.md b/README.md\n", { status: 200 });
      }
    });

    expect(result.diff).toContain("diff --git");
    expect(result.projectName).toBe("openai/codex#123");
    expect(calls[0]?.url).toBe("https://api.github.test/repos/openai/codex/pulls/123");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect((calls[0]?.init.headers as Record<string, string>).accept).toBe("application/vnd.github.diff");
  });

  it("rejects public PR diffs that exceed the configured size limit", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { fetchPublicPullRequestDiff } = await import("../../scripts/demo-server-lib.mjs");

    await expect(
      fetchPublicPullRequestDiff("https://github.com/openai/codex/pull/123", {
        apiUrl: "https://api.github.test",
        maxDiffBytes: 5,
        fetchImpl: async () => new Response("123456", { status: 200 })
      })
    ).rejects.toThrow(/diff is too large/);
  });

  it("rejects non-GitHub pull request URLs", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { parseGitHubPullRequestUrl } = await import("../../scripts/demo-server-lib.mjs");

    expect(() => parseGitHubPullRequestUrl("https://example.com/not-a-pr")).toThrow(/GitHub pull request URL/);
  });

  it("serves product proof media without exposing repository files", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { resolveDemoStaticFile } = await import("../../scripts/demo-server-lib.mjs");

    const proof = resolveDemoStaticFile(process.cwd(), "/docs/assets/launch-gif/browser-frames/frame-03-candidates-card.png");
    expect(proof?.filePath).toMatch(/docs[\\/]assets[\\/]launch-gif/);
    expect(proof?.contentType).toBe("image/png");
    expect(resolveDemoStaticFile(process.cwd(), "/README.md")).toBeUndefined();
    expect(resolveDemoStaticFile(process.cwd(), "/docs/../README.md")).toBeUndefined();
    const workspace = resolveDemoStaticFile(process.cwd(), "/demo/workspace.html");
    expect(workspace?.contentType).toBe("text/html; charset=utf-8");
  });

  it("serves self-hosted WOFF2 fonts with the browser font content type", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { resolveDemoStaticFile } = await import("../../scripts/demo-server-lib.mjs");
    const root = mkdtempSync(join(tmpdir(), "patchdiet-demo-server-"));

    try {
      const demoDirectory = join(root, "demo");
      mkdirSync(demoDirectory);
      writeFileSync(join(demoDirectory, "font.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32]));

      const font = resolveDemoStaticFile(root, "/demo/font.woff2");
      expect(font?.contentType).toBe("font/woff2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
