import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Run-ownership guard for the semantic index, mirroring the independently
 * reviewed containment logic in packages/core/src/safe-output.ts
 * (assertRunOwnedPath). It is mirrored — not imported by package name — so
 * the knowledge package stays self-contained under the compiled dist layout.
 *
 * Walks EVERY segment from the canonical owner root down to the target path
 * and rejects ANY intermediate symlink or junction — even when the target
 * resolves inside the repository: canonical containment alone is not run
 * ownership, because a junctioned ancestor redirects writes and deletes to
 * wherever it points, including another user directory inside the same repo.
 */
export function assertOwnedPath(ownerRoot: string, targetPath: string, label: string): string {
  const realRoot = realpathSync(ownerRoot);
  const rel = relative(realRoot, targetPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `ERROR: ${label} '${targetPath}' is not inside the canonical owner root '${realRoot}'.`,
    );
  }

  let current = realRoot;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isEnoent(error)) {
        return realRoot; // Nothing below an absent segment exists yet.
      }
      throw new Error(
        `ERROR: ${label} '${targetPath}': could not inspect '${current}' (${(error as Error).message}); failing closed.`,
      );
    }
    if (stats.isSymbolicLink()) {
      throw new Error(
        `ERROR: refusing to use ${label} '${targetPath}': '${current}' is a symlink or junction. ` +
          "PatchDiet never writes, deletes or opens databases through links.",
      );
    }
  }

  // Final containment: the deepest existing ancestor must resolve inside the
  // canonical root (defense against non-canonical paths reaching here).
  let probe = targetPath;
  for (;;) {
    let real: string;
    try {
      real = realpathSync(probe);
    } catch (error) {
      if (isEnoent(error)) {
        const parent = dirname(probe);
        if (parent === probe) {
          throw new Error(
            `ERROR: ${label} '${targetPath}': containment could not be proven against root '${realRoot}'.`,
          );
        }
        probe = parent;
        continue;
      }
      throw new Error(
        `ERROR: ${label} '${targetPath}': could not resolve '${probe}' (${(error as Error).message}); failing closed.`,
      );
    }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new Error(
        `ERROR: ${label} '${targetPath}' resolves outside '${realRoot}' (via '${probe}'); refusing to write through it.`,
      );
    }
    return realRoot;
  }
}

/**
 * SQLite-specific leaf gate, applied BEFORE opening the database. Unlike
 * atomic static report replacement, SQLite writes IN PLACE, so an existing
 * database leaf must be:
 * - not a symlink/junction (dangling ones included — lstat, never existsSync),
 * - a regular file,
 * - with nlink === 1 (an external hardlink alias means another live path
 *   shares these bytes and must not be mutated through this one).
 * The checks are read-only: no journal mode is touched and no sidecar file is
 * created for unknown or future-schema databases.
 */
export function assertSafeDatabaseLeaf(databasePath: string, label: string): void {
  let lstats;
  try {
    lstats = lstatSync(databasePath);
  } catch (error) {
    if (isEnoent(error)) {
      return; // Fresh database; parent containment was already verified.
    }
    throw new Error(
      `ERROR: ${label} '${databasePath}': could not inspect leaf (${(error as Error).message}); failing closed.`,
    );
  }
  if (lstats.isSymbolicLink()) {
    throw new Error(
      `ERROR: refusing to use ${label} '${databasePath}': the leaf is a symlink or junction ` +
        "(dangling links included). PatchDiet never writes through links.",
    );
  }
  if (!lstats.isFile()) {
    throw new Error(`ERROR: refusing to use ${label} '${databasePath}': the leaf is not a regular file.`);
  }
  const stats = statSync(databasePath);
  if (stats.nlink > 1) {
    throw new Error(
      `ERROR: refusing to open ${label} '${databasePath}': it has ${stats.nlink} hard links ` +
        "(external alias present); SQLite writes in place and must not mutate shared bytes.",
    );
  }
}

/**
 * Create every missing directory segment between ownerRoot and dir, re-checking
 * each freshly created segment (mkdirSync is atomic per segment; the lstat
 * re-check rejects pre-existing links and races fail closed).
 */
export function mkdirOwned(ownerRoot: string, dir: string, label: string): void {
  assertOwnedPath(ownerRoot, dir, label);
  const realRoot = realpathSync(ownerRoot);
  const rel = relative(realRoot, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`ERROR: ${label} '${dir}' is not inside '${realRoot}'.`);
  }
  let current = realRoot;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isEnoent(error)) {
        mkdirSync(current, { recursive: false });
        continue;
      }
      throw new Error(
        `ERROR: ${label} '${dir}': could not inspect '${current}' (${(error as Error).message}); failing closed.`,
      );
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `ERROR: refusing to create ${label} '${dir}': '${current}' already exists and is not an owned directory.`,
      );
    }
  }
}
