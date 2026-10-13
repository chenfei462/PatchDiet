import { z } from "zod";
import { normalizeIntent } from "./normalize.js";
import type { IntentSourceDocument, NormalizedIntent } from "./types.js";

const MAX_UPLOAD_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const Statement = z.strictObject({
  kind: z.enum(["requirement", "constraint", "must_preserve", "acceptance_criterion"]),
  sourceId: z.string().min(1).max(200),
  startByte: z.number().int().min(0),
  endByte: z.number().int().min(1),
  text: z.string().min(1).max(2000)
});
const ResponseSchema = z.strictObject({
  schemaVersion: z.literal("patchdiet-cloud-intent/1"),
  goal: z.string().max(2000),
  statements: z.array(Statement).max(50),
  contradictions: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(25)
});

export interface CloudProviderConfig {
  url: string;
  model: string;
  apiToken: string;
}

export interface CloudIntentOptions {
  provider?: CloudProviderConfig;
  uploadConsent?: boolean;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export type CloudIntentResult = {
  status: "off" | "advisory" | "fallback";
  local: NormalizedIntent;
  advisory?: z.infer<typeof ResponseSchema>;
  diagnostic?: string;
};

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty provider response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("provider response exceeds 64 KiB");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function validateProvider(provider: CloudProviderConfig): void {
  let parsed: URL;
  try { parsed = new URL(provider.url); } catch { throw new Error("Cloud intent provider requires an HTTPS URL"); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Cloud intent provider requires an HTTPS URL without embedded credentials");
  }
  if (!provider.model || provider.model.length > 100 || !provider.apiToken || provider.apiToken.length > 4096) {
    throw new Error("Cloud intent provider requires a model and API token");
  }
}

function sourceText(source: IntentSourceDocument): string {
  if (source.text !== undefined) return source.text;
  if (source.title !== undefined || source.body !== undefined) return [source.title ?? "", source.body ?? ""].filter(Boolean).join("\n");
  return "";
}

function validateAdvisory(raw: unknown, documents: Array<{ id: string; text: string }>): z.infer<typeof ResponseSchema> {
  const advisory = ResponseSchema.parse(raw);
  const sourceById = new Map(documents.map((source) => [source.id, source.text]));
  if (sourceById.size !== documents.length) throw new Error("duplicate intent source id");
  for (const statement of advisory.statements) {
    const source = sourceById.get(statement.sourceId);
    if (source === undefined || statement.endByte <= statement.startByte) throw new Error("unsourced cloud intent statement");
    const bytes = new TextEncoder().encode(source);
    if (statement.endByte > bytes.length || statement.text !== new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(statement.startByte, statement.endByte))) {
      throw new Error("cloud intent statement does not match its source span");
    }
  }
  for (const [left, right] of advisory.contradictions) {
    if (left === right || left >= advisory.statements.length || right >= advisory.statements.length) {
      throw new Error("cloud intent contradiction refers to an invalid statement");
    }
  }
  return advisory;
}

/** Cloud extraction is advisory. It never mutates the deterministic local intent. */
export async function extractOptionalCloudIntent(sources: IntentSourceDocument[], options: CloudIntentOptions = {}): Promise<CloudIntentResult> {
  const local = normalizeIntent(sources);
  if (!options.provider) return { status: "off", local };
  validateProvider(options.provider);
  if (options.uploadConsent !== true) throw new Error("Explicit upload consent is required for cloud intent extraction");
  const documents = sources.map((source) => ({ id: source.id, kind: source.kind, text: sourceText(source) }));
  const body = JSON.stringify({ schemaVersion: "patchdiet-cloud-intent-request/1", model: options.provider.model, sources: documents });
  if (Buffer.byteLength(body) > MAX_UPLOAD_BYTES) return { status: "fallback", local, diagnostic: "source upload exceeds 16 KiB" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.provider.url, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${options.provider.apiToken}`, "content-type": "application/json", accept: "application/json" },
      body
    });
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    return { status: "advisory", local, advisory: validateAdvisory(JSON.parse(await readBounded(response)), documents) };
  } catch (error) {
    return { status: "fallback", local, diagnostic: error instanceof Error ? error.message : "provider error" };
  } finally {
    clearTimeout(timeout);
  }
}
