import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRollbackEngine, RollbackResult } from "./rollback.js";
import { DataTransformer, transformBatch, transformStep } from "./transform.js";
import {
  DatabaseConfig,
  Migration,
  MigrationBatchResult,
  MigrationConfig,
  MigrationOperation,
  MigrationRecord,
  MigrationResult,
  MigrationStatus,
  RollbackTarget,
  SchemaTransform
} from "./types.js";

/**
 * Database Migrator with support for migrations, data transformation, and rollback mechanisms
 */
export class DatabaseMigrator {
  private readonly config: Required<MigrationConfig>;
  private readonly migrations: Map<string, Migration> = new Map();
  private readonly appliedMigrations: Map<string, MigrationRecord> = new Map();
  private readonly migrationHistory: MigrationRecord[] = [];
  private isLocked = false;
  private lockTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: MigrationConfig) {
    this.config = {
      database: config.database,
      migrationsDir: config.migrationsDir,
      migrationsTable: config.migrationsTable ?? "migration_history",
      verifyChecksums: config.verifyChecksums ?? true,
      lockTimeoutMs: config.lockTimeoutMs ?? 30000,
      lockTtlSeconds: config.lockTtlSeconds ?? 300
    };
  }

  /**
   * Register a new migration
   */
  register(migration: Migration): this {
    if (this.migrations.has(migration.id)) {
      throw new Error(`Migration ${migration.id} is already registered`);
    }
    this.migrations.set(migration.id, migration);
    return this;
  }

  /**
   * Load migrations from directory
   */
  async loadMigrationsFromDir(dirPath: string): Promise<Migration[]> {
    const migrations: Migration[] = [];

    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      return migrations;
    }

    const files = readdirSync(dirPath).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));

    for (const file of files.sort()) {
      const id = file.replace(/\.(js|mjs)$/, "");
      const module = await import(join(dirPath, file));
      const migration = module.default || module.migration;

      if (migration && this.isValidMigration(migration)) {
        migration.id = id;
        migration.createdAt = new Date();
        this.register(migration);
        migrations.push(migration);
      }
    }

    return migrations;
  }

  /**
   * Check if migration is already applied
   */
  isApplied(migrationId: string): boolean {
    return this.appliedMigrations.has(migrationId);
  }

  /**
   * Get all pending migrations
   */
  getPendingMigrations(): Migration[] {
    return Array.from(this.migrations.values()).filter(
      (m) => !this.appliedMigrations.has(m.id)
    );
  }

  /**
   * Get all applied migrations
   */
  getAppliedMigrations(): MigrationRecord[] {
    return Array.from(this.appliedMigrations.values()).sort((a, b) =>
      a.appliedAt.getTime() - b.appliedAt.getTime()
    );
  }

  /**
   * Run pending migrations
   */
  async migrate(options: { upTo?: string; dryRun?: boolean } = {}): Promise<MigrationBatchResult> {
    if (this.isLocked) {
      return {
        success: false,
        migrations: [],
        totalDurationMs: 0,
        error: "Database is locked, please wait or unlock manually"
      };
    }

    const startedAt = Date.now();
    const results: MigrationResult[] = [];

    if (!options.dryRun) {
      this.acquireLock();
    }

    try {
      const pending = this.getPendingMigrations();

      if (pending.length === 0) {
        return {
          success: true,
          migrations: [],
          totalDurationMs: 0
        };
      }

      for (const migration of pending) {
        if (options.upTo && migration.id > options.upTo) {
          break;
        }

        const result = await this.runSingleMigration(migration, options.dryRun ?? false);
        results.push(result);

        if (result.status === "failed" && !options.dryRun) {
          return {
            success: false,
            migrations: results,
            totalDurationMs: Date.now() - startedAt,
            error: result.error,
            failedMigrationId: result.id
          };
        }
      }

      return {
        success: true,
        migrations: results,
        totalDurationMs: Date.now() - startedAt
      };
    } finally {
      if (!options.dryRun) {
        this.releaseLock();
      }
    }
  }

  /**
   * Rollback migrations
   */
  async rollback(target: RollbackTarget = { type: "all" }): Promise<RollbackResult> {
    const engine = createRollbackEngine(
      this.getAppliedMigrations(),
      async (id) => {
        const record = this.appliedMigrations.get(id);
        const migration = this.migrations.get(id);

        if (record && migration) {
          await migration.down();
          this.appliedMigrations.delete(id);
          this.migrationHistory.push({
            ...record,
            status: "rolledback" as MigrationStatus
          });
        }
      }
    );

    return engine.rollback(target);
  }

  /**
   * Rollback a single migration
   */
  async rollbackSingle(migrationId: string): Promise<RollbackResult> {
    const engine = createRollbackEngine(
      this.getAppliedMigrations(),
      async (id) => {
        const record = this.appliedMigrations.get(id);
        const migration = this.migrations.get(id);

        if (record && migration) {
          await migration.down();
          this.appliedMigrations.delete(id);
          this.migrationHistory.push({
            ...record,
            status: "rolledback" as MigrationStatus
          });
        }
      }
    );

    return engine.rollbackSingle(migrationId);
  }

  /**
   * Dry run to see what would be migrated/rolled back
   */
  dryRunMigrate(options: { upTo?: string } = {}): Migration[] {
    const pending = this.getPendingMigrations();
    const upTo = options.upTo;
    if (upTo) {
      return pending.filter((m) => m.id <= upTo);
    }
    return pending;
  }

  /**
   * Dry run to see what would be rolled back
   */
  dryRunRollback(target: RollbackTarget = { type: "all" }): string[] {
    const engine = createRollbackEngine(
      this.getAppliedMigrations(),
      async () => {}
    );
    return engine.dryRun(target);
  }

  /**
   * Get migration status
   */
  getStatus(): {
    pending: number;
    applied: number;
    failed: number;
    locked: boolean;
  } {
    return {
      pending: this.getPendingMigrations().length,
      applied: this.appliedMigrations.size,
      failed: this.migrationHistory.filter((m) => m.status === "failed").length,
      locked: this.isLocked
    };
  }

  /**
   * Create a data transformer for migration-specific transformations
   */
  createTransformer(): DataTransformer {
    return new DataTransformer();
  }

  /**
   * Transform data using registered transformers
   */
  async transformData<T>(data: T, transformer: DataTransformer): Promise<T> {
    return transformer.transform(data);
  }

  /**
   * Batch transform data
   */
  async batchTransformData<T>(
    records: T[],
    stepFn: (records: T[]) => Promise<T[]>,
    options: { batchSize?: number } = {}
  ): Promise<{ results: T[]; errors: string[] }> {
    const batches = await transformBatch(
      records,
      transformStep<T[]>("batchTransformData", stepFn),
      {
        batchSize: options.batchSize,
        parallel: 4
      }
    );

    return {
      results: batches.results.map((r) => r.transformed),
      errors: batches.errors
    };
  }

  /**
   * Acquire migration lock
   */
  private acquireLock(): void {
    if (this.isLocked) {
      throw new Error("Database migration lock is already held");
    }
    this.isLocked = true;
    this.lockTimeoutId = setTimeout(() => {
      this.releaseLock();
    }, this.config.lockTimeoutMs);
  }

  /**
   * Release migration lock
   */
  private releaseLock(): void {
    this.isLocked = false;
    if (this.lockTimeoutId) {
      clearTimeout(this.lockTimeoutId);
      this.lockTimeoutId = null;
    }
  }

  /**
   * Run a single migration
   */
  private async runSingleMigration(
    migration: Migration,
    dryRun: boolean
  ): Promise<MigrationResult> {
    const startedAt = Date.now();

    if (dryRun) {
      return {
        id: migration.id,
        name: migration.name,
        status: "pending" as MigrationStatus,
        durationMs: 0
      };
    }

    try {
      await migration.up();

      const record: MigrationRecord = {
        id: migration.id,
        name: migration.name,
        appliedAt: new Date(),
        status: "applied" as MigrationStatus,
        durationMs: Date.now() - startedAt
      };

      this.appliedMigrations.set(migration.id, record);
      this.migrationHistory.push(record);

      return {
        id: migration.id,
        name: migration.name,
        status: "applied",
        durationMs: record.durationMs!
      };
    } catch (error) {
      const record: MigrationRecord = {
        id: migration.id,
        name: migration.name,
        appliedAt: new Date(),
        status: "failed" as MigrationStatus,
        error: error instanceof Error ? error.message : String(error)
      };

      this.migrationHistory.push(record);

      return {
        id: migration.id,
        name: migration.name,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: record.error
      };
    }
  }

  /**
   * Validate migration object
   */
  private isValidMigration(obj: unknown): obj is Migration {
    if (!obj || typeof obj !== "object") return false;
    const m = obj as Partial<Migration>;
    return (
      typeof m.id === "string" &&
      typeof m.name === "string" &&
      typeof m.up === "function" &&
      typeof m.down === "function"
    );
  }

  /**
   * Create schema operation
   */
  static createSchemaOperation(
    operation: MigrationOperation,
    command: string,
    table?: string,
    params?: unknown[]
  ): { operation: MigrationOperation; command: string; table?: string; params?: unknown[] } {
    return { operation, command, table, params };
  }

  /**
   * Generate migration ID
   */
  static generateMigrationId(prefix: string = "migration"): string {
    const timestamp = Date.now();
    const uuid = randomUUID().slice(0, 8);
    return `${prefix}_${timestamp}_${uuid}`;
  }
}

/**
 * Factory function to create a migrator
 */
export function createMigrator(config: MigrationConfig): DatabaseMigrator {
  return new DatabaseMigrator(config);
}

/**
 * Helper to create a simple in-memory migration for testing
 */
export function createInMemoryMigration(
  id: string,
  name: string,
  up: () => Promise<void>,
  down: () => Promise<void>
): Migration {
  return { id, name, up, down, createdAt: new Date() };
}
