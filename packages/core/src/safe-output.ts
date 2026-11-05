import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function realRootOf(ownerRoot: string): string {
  return realpathSync(ownerRoot);
}

/**
 * P0-3 F1/F2: run-ownership guard anchored to the CANONICAL owner root.
 *
 * Walks EVERY segment from the canonical root down to the target path and
 * rejects ANY intermediate symlink or junction — even when the target itself
 * resolves inside the repository: canonical containment alone is not run
 * ownership, because a junctioned ancestor redirects `git worktree remove`,
 * recursive deletes and writes to wherever it points, including another user
 * directory inside the same repository. Also verifies the deepest existing
 * ancestor resolves inside the canonical root. Any inspection error other
 * than ENOENT fails closed.
 */
export function assertRunOwnedPath(ownerRoot: string, targetPath: string, label: string): void {
  const realRoot = realRootOf(ownerRoot);
  const rel = relative(realRoot, targetPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `ERROR: ${label} '${targetPath}' is not inside the canonical owner root '${realRoot}'.`
    );
  }

  // Segment-by-segment down-walk: a junction at ANY intermediate level fails
  // this walk, no matter where it points.
  let current = realRoot;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isEnoent(error)) {
        return; // Nothing below an absent segment exists yet.
      }
      throw new Error(
        `ERROR: ${label} '${targetPath}': could not inspect '${current}' (${(error as Error).message}); failing closed.`
      );
    }
    if (stats.isSymbolicLink()) {
      throw new Error(
        `ERROR: refusing to use ${label} '${targetPath}': '${current}' is a symlink or junction. ` +
        "PatchDiet never writes, deletes or removes through links."
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
            `ERROR: ${label} '${targetPath}': containment could not be proven against root '${realRoot}'.`
          );
        }
        probe = parent;
        continue;
      }
      throw new Error(
        `ERROR: ${label} '${targetPath}': could not resolve '${probe}' (${(error as Error).message}); failing closed.`
      );
    }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new Error(
        `ERROR: ${label} '${targetPath}' resolves outside '${realRoot}' (via '${probe}'); ` +
        "refusing to write or clean through it."
      );
    }
    return;
  }
}

/**
 * P0-3 F1: refuses symlink/junction output directories (dangling ones
 * included — this must lstat, not existsSync) and anything resolving outside
 * the expected root, before writing or recursively cleaning through them.
 */
export function assertRealDirectoryInside(root: string, child: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(child);
  } catch (error) {
    if (isEnoent(error)) {
      return; // Absent — nothing to refuse yet.
    }
    throw new Error(
      `ERROR: ${label} '${child}': could not inspect it (${(error as Error).message}); failing closed.`
    );
  }
  if (stats.isSymbolicLink()) {
    throw new Error(
      `ERROR: refusing to use ${label} '${child}': it is a symlink or junction (possibly dangling). ` +
      "PatchDiet only writes output into a real directory inside the repository."
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`ERROR: ${label} '${child}' exists but is not a directory.`);
  }
  const realRoot = realpathSync(root);
  const realChild = realpathSync(child);
  if (realChild !== realRoot && !realChild.startsWith(realRoot + sep)) {
    throw new Error(
      `ERROR: ${label} '${child}' resolves outside '${realRoot}'; refusing to write or clean through it.`
    );
  }
}

/**
 * P0-3 F1: containment-safe atomic output write. Containment is proven
 * against the canonical repository root BEFORE any directory is created (a
 * refusal must never leave a directory behind outside the root). The bytes
 * land in an exclusive (wx) run-owned temp file and are renamed over the
 * target path after re-validating the parent chain, so a pre-existing
 * hardlink (or any other link) to the path can never be truncated: rename
 * replaces the directory entry and leaves the old inode, and whatever it is
 * linked to, untouched. A symlink (or dangling symlink) at the target path is
 * refused outright — PatchDiet never writes through links.
 */
export function writeOutputFileAtomic(
  root: string,
  targetPath: string,
  content: string,
  encoding: "utf8" | "latin1" = "utf8"
): void {
  const parent = dirname(targetPath);
  const label = `output directory for '${basename(targetPath)}'`;
  // Prove the deepest EXISTING ancestor is contained BEFORE creating anything.
  assertRunOwnedPath(root, parent, label);
  let parentStats;
  try {
    parentStats = lstatSync(parent);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new Error(
        `ERROR: ${label} '${parent}': could not inspect it (${(error as Error).message}); failing closed.`
      );
    }
  }
  if (parentStats === undefined) {
    mkdirSync(parent, { recursive: true });
  } else if (!parentStats.isDirectory()) {
    throw new Error(`ERROR: ${label} '${parent}' exists but is not a directory.`);
  }
  // Re-validate the full chain now that it exists (protects against anything
  // appearing between the check and the creation).
  assertRunOwnedPath(root, parent, label);

  let targetStats;
  try {
    targetStats = lstatSync(targetPath);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new Error(
        `ERROR: could not inspect output path '${targetPath}' (${(error as Error).message}); failing closed.`
      );
    }
  }
  if (targetStats?.isSymbolicLink()) {
    throw new Error(
      `ERROR: refusing to write output '${targetPath}': it is a symlink or junction. ` +
      "PatchDiet never writes through links."
    );
  }

  const tempPath = join(parent, `.${basename(targetPath)}.patchdiet-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, content, { encoding, flag: "wx" });
    // Re-validate the parent chain immediately before the rename.
    assertRunOwnedPath(root, parent, label);
    // Rename does not follow symlinks and does not write through hardlinks:
    // the previous inode keeps its bytes wherever else it is linked.
    renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // The original error matters more than temp cleanup.
    }
    throw error;
  }
}

/**
 * P0-3 F2: refuses to delete through any path whose run ownership inside
 * `ownerRoot` cannot be proven — including when an intermediate ancestor is a
 * symlink/junction (the leaf may LOOK like a normal directory through a
 * redirected ancestor, so leaf-only symbolic detection is not enough). Any
 * inspection error other than ENOENT fails closed.
 */
function assertDeletableInsideRoot(ownerRoot: string, targetPath: string): void {
  let stats;
  try {
    stats = lstatSync(targetPath);
  } catch (error) {
    if (isEnoent(error)) {
      return; // Already gone.
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return; // The caller removes the link itself, never its target.
  }
  // The leaf is a real file/directory: the ENTIRE segment chain from the
  // canonical owner root down to the leaf must be link-free and contained.
  assertRunOwnedPath(ownerRoot, targetPath, "run-owned cleanup path");
}

/** Async variant used by run-end cleanup. */
export async function removeOwnedPath(path: string, ownerRoot: string): Promise<void> {
  let stats;
  try {
    stats = await fsp.lstat(path);
  } catch (error) {
    if (isEnoent(error)) {
      return; // Already gone.
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    // Remove the link itself; the target it points at is never touched.
    try {
      await fsp.rm(path, { force: true });
    } catch {
      // Best effort at run end.
    }
    return;
  }
  assertDeletableInsideRoot(ownerRoot, path);
  try {
    await fsp.rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Best effort at run end: leftovers are harmless and never user content.
  }
}

/**
 * Synchronous variant for signal handlers and per-worktree fallbacks, which
 * cannot await. Same containment contract as `removeOwnedPath`.
 */
export function removeOwnedPathSync(path: string, ownerRoot: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) {
      return; // Already gone.
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best effort.
    }
    return;
  }
  assertDeletableInsideRoot(ownerRoot, path);
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Best effort.
  }
}

/**
 * P0-3 F2: non-recursive removal of a shared directory this run created.
 * Succeeds only when the directory is empty — concurrent or user content in
 * it survives untouched. Never follows a link placed at the path.
 */
export async function rmdirIfEmpty(path: string): Promise<void> {
  let stats;
  try {
    stats = await fsp.lstat(path);
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return; // Never remove a shared link or non-directory.
  }
  try {
    await fsp.rmdir(path);
  } catch {
    // Non-empty or already gone — the content is not ours to remove.
  }
}
