export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogContext {
  key: string;
  value: string;
}

export interface AuditEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  auditTrail?: boolean;
  auditTrailPath?: string;
  getTimestampMs?: () => number;
}

export interface Logger {
  readonly level: LogLevel;
  setContext(key: string, value: string): void;
  clearContext(): void;
  withContext<T>(key: string, value: string, fn: () => T): T;
  trace(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  audit(action: string, resource: string, outcome: "success" | "failure", details?: Record<string, unknown>): void;
  getAuditTrail(): ReadonlyArray<AuditEntry>;
  clearAuditTrail(): void;
  setAuditPath(path: string): void;
  setAuditWriter(fn: (path: string, entry: AuditEntry) => Promise<void>): void;
  resetAuditWriter(): void;
}
