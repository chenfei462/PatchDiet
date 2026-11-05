// Main migrator class
export { DatabaseMigrator, createMigrator, createInMemoryMigration } from "./migrator.js";

// Types
export {
  Migration,
  MigrationStatus,
  MigrationRecord,
  MigrationOperation,
  DatabaseOperation,
  TransformFn,
  TransformStep,
  MigrationConfig,
  DatabaseConfig,
  MigrationResult,
  MigrationBatchResult,
  RollbackTarget,
  SchemaTransform
} from "./types.js";

// Rollback mechanisms
export { RollbackEngine, createRollbackEngine } from "./rollback.js";

// Data transformation
export {
  DataTransformer,
  SchemaTransformer,
  transformStep,
  applyTransformPipeline,
  transformBatch,
  transformKeys,
  transformValues,
  renameKeys,
  wouldTransform,
  TransformContext,
  TransformResult
} from "./transform.js";
