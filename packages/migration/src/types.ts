/**
 * Migration types for database migration support
 */

/**
 * Represents a database migration with up and down functions
 */
export interface Migration {
  /** Unique identifier for the migration (typically a timestamp) */
  id: string;
  /** Name/description of the migration */
  name: string;
  /** Function to apply the migration */
  up: () => Promise<void>;
  /** Function to revert the migration */
  down: () => Promise<void>;
  /** Timestamp when migration was created */
  createdAt: Date;
}

/**
 * Status of a migration
 */
export type MigrationStatus = "pending" | "applied" | "failed" | "rolledback";

/**
 * Record of an applied migration in the database
 */
export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: Date;
  status: MigrationStatus;
  durationMs?: number;
  error?: string;
}

/**
 * Migration operation types
 */
export type MigrationOperation =
  | "create_table"
  | "drop_table"
  | "alter_table"
  | "create_index"
  | "drop_index"
  | "insert"
  | "update"
  | "delete"
  | "custom";

/**
 * Database operation to be executed
 */
export interface DatabaseOperation {
  /** Operation type */
  operation: MigrationOperation;
  /** SQL or custom command to execute */
  command: string;
  /** Table name (if applicable) */
  table?: string;
  /** Parameters for parameterized queries */
  params?: unknown[];
}

/**
 * Data transformation function signature
 */
export type TransformFn<T = unknown> = (data: T) => T | Promise<T>;

/**
 * Data transformation pipeline step
 */
export interface TransformStep<T = unknown> {
  /** Name of the transformation step */
  name: string;
  /** Transformation function */
  fn: TransformFn<T>;
  /** Whether to continue on error */
  continueOnError?: boolean;
}

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /** Database connection string or configuration */
  database: string | DatabaseConfig;
  /** Directory containing migration files */
  migrationsDir: string;
  /** Name of the migrations tracking table */
  migrationsTable?: string;
  /** Whether to verify checksums */
  verifyChecksums?: boolean;
  /** Lock timeout in milliseconds */
  lockTimeoutMs?: number;
  /** Migration lock TTL in seconds */
  lockTtlSeconds?: number;
}

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  /** Database driver type */
  driver: "postgres" | "mysql" | "sqlite" | "custom";
  /** Connection parameters */
  connection: Record<string, unknown>;
  /** Optional pool configuration */
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
    acquireTimeoutMs?: number;
  };
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Migration ID */
  id: string;
  /** Migration name */
  name: string;
  /** Status of the migration */
  status: MigrationStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Migration batch result
 */
export interface MigrationBatchResult {
  /** Whether all migrations succeeded */
  success: boolean;
  /** List of migration results */
  migrations: MigrationResult[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Error message if any migration failed */
  error?: string;
  /** Migration that caused the failure */
  failedMigrationId?: string;
}

/**
 * Rollback target options
 */
export type RollbackTarget =
  | { type: "all" }
  | { type: "until"; migrationId: string }
  | { type: "count"; count: number };

/**
 * Schema transformation operation
 */
export interface SchemaTransform {
  /** Target table */
  table: string;
  /** Column to transform */
  column: string;
  /** Transformation function */
  transform: (value: unknown) => unknown;
  /** Where condition for selective transformation */
  where?: string;
}
