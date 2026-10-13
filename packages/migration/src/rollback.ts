import { MigrationRecord, RollbackTarget } from "./types.js";

/**
 * Rollback mechanisms for database migrations
 */

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;
  /** Number of migrations rolled back */
  rolledBackCount: number;
  /** List of rolled back migration IDs */
  rolledBackIds: string[];
  /** Error message if failed */
  error?: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Default rollback implementation
 */
export class RollbackEngine {
  private readonly appliedMigrations: MigrationRecord[];
  private readonly rollbackFn: (id: string) => Promise<void>;

  constructor(
    appliedMigrations: MigrationRecord[],
    rollbackFn: (id: string) => Promise<void>
  ) {
    // Newest first. Ties on `appliedAt` (same millisecond) are broken by the
    // original application order so that ordering stays deterministic and the
    // later-applied migration is always considered newer.
    this.appliedMigrations = appliedMigrations
      .map((migration, index) => ({ migration, index }))
      .sort(
        (a, b) =>
          b.migration.appliedAt.getTime() - a.migration.appliedAt.getTime() ||
          b.index - a.index
      )
      .map(({ migration }) => migration);
    this.rollbackFn = rollbackFn;
  }

  /**
   * Rollback migrations based on target
   */
  async rollback(target: RollbackTarget): Promise<RollbackResult> {
    const startedAt = Date.now();
    const rolledBackIds: string[] = [];

    try {
      const migrationsToRollback = this.getTargetMigrations(target);

      for (const migration of migrationsToRollback) {
        try {
          await this.rollbackFn(migration.id);
          rolledBackIds.push(migration.id);
        } catch (error) {
          return {
            success: false,
            rolledBackCount: rolledBackIds.length,
            rolledBackIds,
            error: `Rollback failed for migration ${migration.id}: ${error instanceof Error ? error.message : String(error)}`,
            durationMs: Date.now() - startedAt
          };
        }
      }

      return {
        success: true,
        rolledBackCount: rolledBackIds.length,
        rolledBackIds,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        rolledBackCount: rolledBackIds.length,
        rolledBackIds,
        error: `Rollback error: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startedAt
      };
    }
  }

  /**
   * Rollback a single migration by ID
   */
  async rollbackSingle(migrationId: string): Promise<RollbackResult> {
    const startedAt = Date.now();

    try {
      await this.rollbackFn(migrationId);
      return {
        success: true,
        rolledBackCount: 1,
        rolledBackIds: [migrationId],
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        rolledBackCount: 0,
        rolledBackIds: [],
        error: `Failed to rollback ${migrationId}: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startedAt
      };
    }
  }

  /**
   * Get migrations to rollback based on target
   */
  private getTargetMigrations(target: RollbackTarget): MigrationRecord[] {
    switch (target.type) {
      case "all":
        return [...this.appliedMigrations].reverse();

      case "until":
        const currentIndex = this.appliedMigrations.findIndex(
          (m) => m.id === target.migrationId
        );
        if (currentIndex === -1) {
          return [...this.appliedMigrations].reverse();
        }
        return this.appliedMigrations
          .slice(0, currentIndex)
          .reverse();

      case "count":
        return this.appliedMigrations.slice(0, target.count).reverse();

      default:
        return [];
    }
  }

  /**
   * Dry run to see what would be rolled back
   */
  dryRun(target: RollbackTarget): string[] {
    const migrations = this.getTargetMigrations(target);
    return migrations.map((m) => m.id);
  }
}

/**
 * Create a rollback engine from migration records and a rollback function
 */
export function createRollbackEngine(
  appliedMigrations: MigrationRecord[],
  rollbackFn: (id: string) => Promise<void>
): RollbackEngine {
  return new RollbackEngine(appliedMigrations, rollbackFn);
}
