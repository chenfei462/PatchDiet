import { TransformStep, SchemaTransform } from "./types.js";

/**
 * Data transformation utilities for migrations
 */

/**
 * Transform context passed to transformation functions
 */
export interface TransformContext<T = unknown> {
  /** Original data */
  original: T;
  /** Transformed data so far */
  result: T;
  /** Migration ID */
  migrationId: string;
  /** Batch index (for large datasets) */
  batchIndex?: number;
  /** Total batch count */
  totalBatches?: number;
}

/**
 * Transformation result with metadata
 */
export interface TransformResult<T = unknown> {
  /** Original data */
  original: T;
  /** Transformed data */
  transformed: T;
  /** Whether transformation was applied */
  changed: boolean;
  /** Reason if not changed */
  reason?: string;
}

/**
 * Create a transformation step
 */
export function transformStep<T>(
  name: string,
  fn: (data: T) => T | Promise<T>,
  continueOnError: boolean = false
): TransformStep<T> {
  return {
    name,
    fn: async (data: T): Promise<T> => await fn(data),
    continueOnError
  };
}

/**
 * Apply an array of transformation steps to data
 */
export async function applyTransformPipeline<T>(
  data: T,
  steps: TransformStep<T>[]
): Promise<{ result: T; appliedSteps: string[]; errors: string[] }> {
  let result = data;
  const appliedSteps: string[] = [];
  const errors: string[] = [];

  for (const step of steps) {
    try {
      result = await step.fn(result);
      appliedSteps.push(step.name);
    } catch (error) {
      const errorMsg = `Step "${step.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      if (!step.continueOnError) {
        throw new Error(errorMsg);
      }
    }
  }

  return { result, appliedSteps, errors };
}

/**
 * Apply transformations to batch of records
 */
export async function transformBatch<T>(
  records: T[],
  step: TransformStep<T[]>,
  options: { batchSize?: number; parallel?: number } = {}
): Promise<{
  results: TransformResult<T>[];
  totalProcessed: number;
  errors: string[];
}> {
  const batchSize = options.batchSize ?? 1000;
  const parallel = options.parallel ?? 4;
  const results: TransformResult<T>[] = [];
  const errors: string[] = [];
  let totalProcessed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    try {
      const transformedBatch = await step.fn(batch);
      results.push(...transformedBatch.map((item, idx) => ({
        original: item,
        transformed: transformedBatch[idx],
        changed: JSON.stringify(item) !== JSON.stringify(transformedBatch[idx])
      })));
      totalProcessed += batch.length;
    } catch (error) {
      const errorMsg = `Batch ${Math.floor(i / batchSize)} failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
    }
  }

  return { results, totalProcessed: totalProcessed, errors };
}

/**
 * Schema transformation for database migrations
 */
export class SchemaTransformer {
  private transforms: SchemaTransform[] = [];

  /**
   * Add a column transformation
   */
  addColumnTransform(
    table: string,
    column: string,
    transform: (value: unknown) => unknown
  ): this {
    this.transforms.push({ table, column, transform });
    return this;
  }

  /**
   * Add a conditional transformation
   */
  addConditionalTransform<T>(
    table: string,
    column: string,
    transform: (value: T) => T,
    where: string
  ): this {
    this.transforms.push({
      table,
      column,
      // Stored as a function over `unknown`; callers narrow back to `T`. The
      // original reference is kept so `generateSQL` can render its source.
      transform: transform as (value: unknown) => unknown,
      where
    });
    return this;
  }

  /**
   * Generate SQL for all transformations
   */
  generateSQL(): string {
    return this.transforms
      .map((t) =>
        t.where
          ? `UPDATE ${t.table} SET ${t.column} = ${this.generateExpr(t.column, t.transform)} WHERE ${t.where};`
          : `UPDATE ${t.table} SET ${t.column} = ${this.generateExpr(t.column, t.transform)};`
      )
      .join("\n");
  }

  /**
   * Generate a transformation expression
   */
  private generateExpr(column: string, transform: (value: unknown) => unknown): string {
    return `(${transform.toString()})(${column})`;
  }

  /**
   * Clear all transformations
   */
  clear(): void {
    this.transforms = [];
  }

  /**
   * Get count of registered transformations
   */
  get count(): number {
    return this.transforms.length;
  }
}

/**
 * Check if transformation would change data
 */
export function wouldTransform<T>(
  data: T,
  transform: (value: T) => T | Promise<T>
): Promise<boolean> {
  return Promise.resolve(transform(data)).then(
    (result: T) => JSON.stringify(data) !== JSON.stringify(result)
  );
}

/**
 * Create a data migration transformer
 */
export class DataTransformer {
  private readonly transforms: Array<(data: unknown) => unknown | Promise<unknown>>;

  constructor() {
    this.transforms = [];
  }

  /**
   * Add a transformation function
   */
  add(transform: (data: unknown) => unknown | Promise<unknown>): this {
    this.transforms.push(transform);
    return this;
  }

  /**
   * Transform data through all registered steps
   */
  async transform<T>(data: T): Promise<T> {
    let result: unknown = data;
    for (const fn of this.transforms) {
      result = await fn(result);
    }
    return result as T;
  }

  /**
   * Create a transformer with validation
   */
  static withValidation<T>(
    transform: (data: T) => T | Promise<T>,
    validator: (data: T) => boolean | Promise<boolean>
  ): DataTransformer {
    const dt = new DataTransformer();
    dt.add((data: unknown) => transform(data as T));
    dt.add(async (data: unknown) => {
      const value = data as T;
      if (!(await validator(value))) {
        throw new Error("Validation failed after transformation");
      }
      return value;
    });
    return dt;
  }
}

/**
 * Utility: Transform object keys
 */
export function transformKeys<T extends Record<string, unknown>>(
  obj: T,
  keyMapper: (key: string) => string
): T {
  const result = Object.keys(obj).reduce<Record<string, unknown>>((acc, key) => {
    acc[keyMapper(key)] = obj[key];
    return acc;
  }, {});
  return result as T;
}

/**
 * Utility: Transform object values
 */
export function transformValues<T extends Record<string, unknown>>(
  obj: T,
  valueMapper: (value: unknown, key: string) => unknown
): T {
  const result = Object.keys(obj).reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = valueMapper(obj[key], key);
    return acc;
  }, {});
  return result as T;
}

/**
 * Utility: Rename object keys
 */
export function renameKeys<T extends Record<string, unknown>>(
  obj: T,
  renames: Record<string, string>
): T {
  return transformKeys(obj, (key) => renames[key] ?? key);
}