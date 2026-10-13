import { describe, expect, it } from "vitest";
import { extractOptionalCloudIntent } from "../../packages/intent/src/index.js";

const sources = [{ id: "cli", kind: "cli" as const, text: "Fix login. Keep logout working." }];
const provider = { url: "https://intent.example.test/v1/extract", model: "intent-test", apiToken: "test-token" };
const valid = { schemaVersion: "patchdiet-cloud-intent/1", goal: "Fix login", statements: [
  { kind: "requirement", sourceId: "cli", startByte: 0, endByte: 9, text: "Fix login" },
  { kind: "must_preserve", sourceId: "cli", startByte: 11, endByte: 30, text: "Keep logout working" }
], contradictions: [[0, 1]] };

describe("optional cloud intent", () => {
  it("stays local by default and requires explicit upload consent", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error("must not upload"); };
    const off = await extractOptionalCloudIntent(sources, { fetchImpl });
    expect(off.status).toBe("off");
    expect(off.local.confidence).toBe("explicit");
    expect(calls).toBe(0);
    await expect(extractOptionalCloudIntent(sources, { provider, fetchImpl })).rejects.toThrow(/consent/);
    expect(calls).toBe(0);
  });

  it("checks provider origin, response shape, verbatim UTF-8 spans and contradictions", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(valid));
    };
    const result = await extractOptionalCloudIntent(sources, { provider, uploadConsent: true, fetchImpl });
    expect(result.status).toBe("advisory");
    expect(result.local.goal).toBe("Fix login.");
    expect(result.local.llmUsed).toBe(false);
    expect(result.advisory?.statements).toHaveLength(2);
    expect(result.advisory?.contradictions).toEqual([[0, 1]]);
    expect(calls[0]?.url).toBe(provider.url);
    expect(calls[0]?.init.redirect).toBe("error");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    expect(JSON.stringify(calls[0]?.init.body)).not.toContain("test-token");
    await expect(extractOptionalCloudIntent(sources, { provider: { ...provider, url: "http://intent.example.test/v1/extract" }, uploadConsent: true, fetchImpl })).rejects.toThrow(/HTTPS/);
    expect(calls).toHaveLength(1);
    const badSpan = { ...valid, statements: [{ ...valid.statements[0], text: "Delete all tests" }] };
    await expect(extractOptionalCloudIntent(sources, { provider, uploadConsent: true, fetchImpl: async () => new Response(JSON.stringify(badSpan)) })).resolves.toMatchObject({ status: "fallback", local: { confidence: "explicit" } });
    const badContradiction = { ...valid, contradictions: [[0, 7]] };
    await expect(extractOptionalCloudIntent(sources, { provider, uploadConsent: true, fetchImpl: async () => new Response(JSON.stringify(badContradiction)) })).resolves.toMatchObject({ status: "fallback" });
  });

  it("bounds uploaded sources and rejects extra model fields without deletion authority", async () => {
    let called = false;
    const oversize = await extractOptionalCloudIntent([{ id: "cli", kind: "cli", text: "x".repeat(20000) }], { provider, uploadConsent: true, fetchImpl: async () => { called = true; throw new Error("sent"); } });
    expect(oversize.status).toBe("fallback");
    expect(called).toBe(false);
    const injected = { ...valid, mayDelete: true };
    const result = await extractOptionalCloudIntent(sources, { provider, uploadConsent: true, fetchImpl: async () => new Response(JSON.stringify(injected)) });
    expect(result.status).toBe("fallback");
    expect(result.advisory).toBeUndefined();
  });
});
