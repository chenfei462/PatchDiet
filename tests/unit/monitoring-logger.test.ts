import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../../packages/monitoring/src/logger.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createLogger", () => {
  it("logs at info level by default", () => {
    const logger = createLogger({ level: "info" });
    expect(logger.level).toBe("info");
  });
});

describe("level filtering", () => {
  it("only logs messages at or above the configured level", () => {
    const tmpDir = join(tmpdir(), `monitoring-level-test-${Date.now()}`);
    tempDirs.push(tmpDir);
    mkdirSync(tmpDir, { recursive: true });

    const logger = createLogger({
      level: "warn",
      getTimestampMs: () => 0,
      auditTrail: true,
      auditTrailPath: join(tmpDir, "audit.jsonl"),
    });

    logger.trace("trace msg");
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    const entries = logger.getAuditTrail();
    expect(entries.length).toBe(2);
    expect(entries.some((e) => e.level === "warn")).toBe(true);
    expect(entries.some((e) => e.level === "error")).toBe(true);
    expect(entries.some((e) => e.level === "info")).toBe(false);
    expect(entries.some((e) => e.level === "debug")).toBe(false);
    expect(entries.some((e) => e.level === "trace")).toBe(false);
  });
});

describe("context injection", () => {
  it("injects context into log messages", () => {
    const logger = createLogger({ level: "info", getTimestampMs: () => 0 });
    logger.setContext("requestId", "abc-123");
    logger.info("processing request");
    logger.clearContext();
    logger.info("after context cleared");
  });

  it("supports withContext for scoped context", () => {
    const logger = createLogger({ level: "info", getTimestampMs: () => 0 });
    const result = logger.withContext("userId", "user-42", () => {
      logger.info("user action");
      return "done";
    });
    expect(result).toBe("done");
    logger.info("after scoped context");
  });
});

describe("audit trail", () => {
  it("records audit entries", async () => {
    const tmpDir = join(tmpdir(), `monitoring-audit-${Date.now()}`);
    tempDirs.push(tmpDir);
    mkdirSync(tmpDir, { recursive: true });

    const logger = createLogger({
      level: "info",
      auditTrail: true,
      auditTrailPath: join(tmpDir, "audit.jsonl"),
      getTimestampMs: () => 0,
    });

    logger.audit("CREATE", "resource-1", "success", { userId: "admin" });
    logger.audit("DELETE", "resource-2", "failure", { reason: "permission denied" });

    const trail = logger.getAuditTrail();
    expect(trail.length).toBe(2);
    expect(trail[0].message).toContain("AUDIT CREATE");
    expect(trail[0].metadata?.outcome).toBe("success");
    expect(trail[1].message).toContain("AUDIT DELETE");
    expect(trail[1].metadata?.outcome).toBe("failure");

    // Wait for async file write
    await new Promise((r) => setTimeout(r, 50));

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    const parsed = JSON.parse(lines[1]);
    expect(parsed.message).toContain("AUDIT DELETE");
  });

  it("caps audit trail at 1000 items", () => {
    const tmpDir = join(tmpdir(), `patchdiet-monitoring-cap-${Date.now()}`);
    tempDirs.push(tmpDir);
    mkdirSync(tmpDir, { recursive: true });

    const logger = createLogger({
      level: "info",
      auditTrail: true,
      auditTrailPath: join(tmpDir, "audit.jsonl"),
      getTimestampMs: () => 0,
    });

    for (let i = 0; i < 1005; i++) {
      logger.audit("OP", `item-${i}`, "success");
    }

    const trail = logger.getAuditTrail();
    expect(trail.length).toBeLessThanOrEqual(1000);
  });

  it("clears audit trail", () => {
    const tmpDir = join(tmpdir(), `monitoring-clear-${Date.now()}`);
    tempDirs.push(tmpDir);
    mkdirSync(tmpDir, { recursive: true });

    const logger = createLogger({
      level: "info",
      auditTrail: true,
      auditTrailPath: join(tmpDir, "audit.jsonl"),
      getTimestampMs: () => 0,
    });

    logger.audit("TEST", "resource", "success");
    expect(logger.getAuditTrail().length).toBe(1);

    logger.clearAuditTrail();
    expect(logger.getAuditTrail().length).toBe(0);
  });
});