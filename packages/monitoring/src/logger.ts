import type { LogContext, Logger, LogLevel, LoggerOptions } from "./types.js";

// ── Internal state ─────────────────────────────────────────────────────

let instance: Logger | undefined;

const DEFAULT_LEVEL: LogLevel = "info";
const AUDIT_TRAIL_MAX_ITEMS = 1000;

export function createLogger(options: LoggerOptions = {}): Logger {
  const sinks: Array<"console" | "auditFile"> = options.auditTrail ? ["console", "auditFile"] : ["console"];
  const contextStack: LogContext[] = [];
  const auditTrail: Array<{ timestamp: number; level: LogLevel; message: string; metadata?: Record<string, unknown> }> = [];

  // Replaceable sink for testability. Defaults to the real implementations below.
  let auditWriter = auditTrailWriter;
  let auditTrailPath = options.auditTrailPath ?? ".patchdiet/audit.jsonl";

  function appendAudit(entry: (typeof auditTrail)[number]): void {
    if (!options.auditTrail) return;

    auditTrail.push(entry);
    if (auditTrail.length > AUDIT_TRAIL_MAX_ITEMS) {
      auditTrail.splice(0, auditTrail.length - AUDIT_TRAIL_MAX_ITEMS);
    }

    try {
      void auditWriter(auditTrailPath, entry);
    } catch {
      // Keep logging available even when the audit file is unwritable.
    }
  }

  function resolveTimestamp(): number {
    return options.getTimestampMs?.() ?? Date.now();
  }

  function buildBaseEntry(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ): { timestamp: number; level: LogLevel; message: string; metadata?: Record<string, unknown>; ctx: Record<string, string> } {
    const ctx = Object.fromEntries(contextStack.map((c) => [c.key, c.value]));
    return {
      timestamp: resolveTimestamp(),
      level,
      message,
      metadata,
      ctx
    };
  }

  function shouldLog(level: LogLevel): boolean {
    return logLevelIndex(level) >= logLevelIndex(options.level ?? DEFAULT_LEVEL);
  }

  function formatEntry(entry: ReturnType<typeof buildBaseEntry>): string {
    const { timestamp, level, message, metadata, ctx } = entry;
    const timestampIso = new Date(timestamp).toISOString();
    const ctxString = Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : "";
    const metaString = metadata ? ` ${JSON.stringify(metadata)}` : "";
    return `[${timestampIso}] [${level}] ${message}${ctxString}${metaString}`;
  }

  function write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry = buildBaseEntry(level, message, metadata);
    const formatted = formatEntry(entry);

    if (sinks.includes("console")) {
      if (level === "error") {
        console.error(formatted);
      } else if (level === "warn") {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }

    if (sinks.includes("auditFile")) {
      appendAudit({
        timestamp: entry.timestamp,
        level,
        message,
        metadata: metadata ?? {}
      });
    }
  }

  const logger: Logger = {
    level: options.level ?? DEFAULT_LEVEL,
    setContext(key: string, value: string): void {
      contextStack.push({ key, value });
    },
    clearContext(): void {
      contextStack.pop();
    },
    withContext<T>(key: string, value: string, fn: () => T): T {
      contextStack.push({ key, value });
      try {
        return fn();
      } finally {
        contextStack.pop();
      }
    },
    trace(message: string, metadata?: Record<string, unknown>): void {
      write("trace", message, metadata);
    },
    debug(message: string, metadata?: Record<string, unknown>): void {
      write("debug", message, metadata);
    },
    info(message: string, metadata?: Record<string, unknown>): void {
      write("info", message, metadata);
    },
    warn(message: string, metadata?: Record<string, unknown>): void {
      write("warn", message, metadata);
    },
    error(message: string, metadata?: Record<string, unknown>): void {
      write("error", message, metadata);
    },
    audit(action: string, resource: string, outcome: "success" | "failure", details?: Record<string, unknown>): void {
      write(
        "info",
        `AUDIT ${action} resource=${resource} outcome=${outcome}`,
        { ...details, action, resource, outcome }
      );
    },
    getAuditTrail(): ReadonlyArray<{ timestamp: number; level: LogLevel; message: string; metadata?: Record<string, unknown> }> {
      return auditTrail;
    },
    clearAuditTrail(): void {
      auditTrail.length = 0;
    },
    setAuditPath(path: string): void {
      auditTrailPath = path;
    },
    setAuditWriter(fn: typeof auditWriter): void {
      auditWriter = fn;
    },
    resetAuditWriter(): void {
      auditWriter = auditTrailWriter;
    }
  };

  return logger;
}

function logLevelIndex(level: LogLevel): number {
  switch (level) {
    case "trace":
      return 0;
    case "debug":
      return 1;
    case "info":
      return 2;
    case "warn":
      return 3;
    case "error":
      return 4;
    default:
      return 2;
  }
}

async function auditTrailWriter(path: string, entry: { timestamp: number; level: LogLevel; message: string; metadata?: Record<string, unknown> }): Promise<void> {
  const { writeFileSync } = await import("node:fs");
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry) + "\n", { flag: "a", encoding: "utf8" });
}

export const defaultLogger = createLogger();

export default defaultLogger;
