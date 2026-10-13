import { describe, expect, it, vi } from "vitest";
import { createInMemoryMigration, DatabaseMigrator } from "../src/index.js";

describe("DatabaseMigrator", () => {
  describe("register", () => {
    it("should register a migration", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      const migration = createInMemoryMigration(
        "001_test",
        "Test migration",
        async () => {},
        async () => {}
      );

      migrator.register(migration);
      expect(migrator.getPendingMigrations()).toHaveLength(1);
    });

    it("should throw when registering duplicate migration", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      const migration = createInMemoryMigration(
        "001_test",
        "Test migration",
        async () => {},
        async () => {}
      );

      migrator.register(migration);
      expect(() => migrator.register(migration)).toThrow("already registered");
    });
  });

  describe("isApplied", () => {
    it("should return false for unregistered migration", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      expect(migrator.isApplied("nonexistent")).toBe(false);
    });
  });

  describe("migrate", () => {
    it("should run pending migrations", async () => {
      const up = vi.fn();
      const down = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(
        createInMemoryMigration("001_test", "Test migration", up, down)
      );

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(result.migrations).toHaveLength(1);
      expect(result.migrations[0].status).toBe("applied");
      expect(up).toHaveBeenCalled();
      expect(down).not.toHaveBeenCalled();
    });

    it("should return success when no pending migrations", async () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(result.migrations).toHaveLength(0);
    });

    it("should stop on first failure", async () => {
      const upFirst = vi.fn().mockResolvedValue(undefined);
      const upSecond = vi.fn().mockRejectedValue(new Error("Migration failed"));
      const down = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_first", "First", upFirst, down));
      migrator.register(createInMemoryMigration("002_second", "Second", upSecond, down));

      const result = await migrator.migrate();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Migration failed");
      expect(result.failedMigrationId).toBe("002_second");
      expect(upFirst).toHaveBeenCalled();
      expect(upSecond).toHaveBeenCalled();
    });

    it("should support dry run", async () => {
      const up = vi.fn();
      const down = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_test", "Test", up, down));

      const result = await migrator.migrate({ dryRun: true });

      expect(result.success).toBe(true);
      expect(up).not.toHaveBeenCalled();
      expect(down).not.toHaveBeenCalled();
      expect(result.migrations[0].status).toBe("pending");
    });

    it("should support upTo option", async () => {
      const up1 = vi.fn();
      const up2 = vi.fn();
      const down = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_first", "First", up1, down));
      migrator.register(createInMemoryMigration("002_second", "Second", up2, down));

      await migrator.migrate({ upTo: "001_first" });

      expect(up1).toHaveBeenCalled();
      expect(up2).not.toHaveBeenCalled();
    });
  });

  describe("rollback", () => {
    it("should rollback applied migrations", async () => {
      const up = vi.fn();
      const down = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_test", "Test", up, down));
      await migrator.migrate();

      const result = await migrator.rollback({ type: "all" });

      expect(result.success).toBe(true);
      expect(result.rolledBackCount).toBe(1);
      expect(down).toHaveBeenCalled();
    });

    it("should rollback to specific migration", async () => {
      const up1 = vi.fn();
      const up2 = vi.fn();
      const down1 = vi.fn();
      const down2 = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_first", "First", up1, down1));
      migrator.register(createInMemoryMigration("002_second", "Second", up2, down2));
      await migrator.migrate();

      // Rollback to first migration
      const result = await migrator.rollback({ type: "until", migrationId: "001_first" });

      expect(result.success).toBe(true);
      expect(result.rolledBackCount).toBe(1);
      expect(down2).toHaveBeenCalled();
      expect(down1).not.toHaveBeenCalled();
    });

    it("should rollback specific count", async () => {
      const up1 = vi.fn();
      const up2 = vi.fn();
      const up3 = vi.fn();
      const down1 = vi.fn();
      const down2 = vi.fn();
      const down3 = vi.fn();

      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_first", "First", up1, down1));
      migrator.register(createInMemoryMigration("002_second", "Second", up2, down2));
      migrator.register(createInMemoryMigration("003_third", "Third", up3, down3));
      await migrator.migrate();

      // Rollback last 2 migrations
      const result = await migrator.rollback({ type: "count", count: 2 });

      expect(result.success).toBe(true);
      expect(result.rolledBackCount).toBe(2);
    });
  });

  describe("dryRun", () => {
    it("should list pending migrations", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_test", "Test", async () => {}, async () => {}));

      const pending = migrator.dryRunMigrate();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("001_test");
    });

    it("should filter pending migrations with upTo", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      migrator.register(createInMemoryMigration("001_first", "First", async () => {}, async () => {}));
      migrator.register(createInMemoryMigration("002_second", "Second", async () => {}, async () => {}));

      const pending = migrator.dryRunMigrate({ upTo: "001_first" });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("001_first");
    });
  });

  describe("getStatus", () => {
    it("should return migration status", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      const status = migrator.getStatus();
      expect(status.pending).toBe(0);
      expect(status.applied).toBe(0);
      expect(status.locked).toBe(false);
    });
  });

  describe("createTransformer", () => {
    it("should create a data transformer", () => {
      const migrator = new DatabaseMigrator({
        database: "test://test",
        migrationsDir: "/tmp/migrations"
      });

      const transformer = migrator.createTransformer();
      expect(transformer).toBeDefined();
    });
  });

  describe("generateMigrationId", () => {
    it("should generate migration IDs with prefix", () => {
      const id = DatabaseMigrator.generateMigrationId("user");
      expect(id).toMatch(/^user_\d+_[a-f0-9]{8}$/);
    });
  });
});
