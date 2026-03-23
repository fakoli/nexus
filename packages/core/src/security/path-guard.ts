/**
 * Path guard — canonical path resolution and symlink-escape detection.
 *
 * Prevents directory traversal and symlink escape attacks on filesystem tools.
 * All public functions are pure (no side effects beyond fs.realpathSync).
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../logger.js";

const log = createLogger("core:security:path-guard");

/**
 * Resolve `requestedPath` to its canonical form and verify it falls under
 * at least one of `allowedRoots`.
 *
 * Returns the canonical path if safe, or null if:
 *   - the path is not absolute
 *   - after resolution it escapes all allowed roots
 *   - realpathSync throws (e.g. intermediate component doesn't exist)
 */
export function resolveSafePath(
  requestedPath: string,
  allowedRoots: string[],
): string | null {
  if (!path.isAbsolute(requestedPath)) {
    log.warn({ requestedPath }, "Rejected relative path");
    return null;
  }

  if (allowedRoots.length === 0) {
    log.warn({ requestedPath }, "No allowed roots configured — denying");
    return null;
  }

  let canonical: string;
  try {
    canonical = fs.realpathSync(requestedPath);
  } catch {
    // File may not exist yet (write_file scenario).
    // Resolve the nearest existing ancestor and normalise from there.
    canonical = resolveNonExistent(requestedPath);
  }

  for (const root of allowedRoots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync(root);
    } catch {
      canonicalRoot = path.normalize(root);
    }

    // Ensure root ends with separator for prefix check
    const rootWithSep = canonicalRoot.endsWith(path.sep)
      ? canonicalRoot
      : canonicalRoot + path.sep;

    if (canonical === canonicalRoot || canonical.startsWith(rootWithSep)) {
      log.debug({ requestedPath, canonical, root: canonicalRoot }, "Path allowed");
      return canonical;
    }
  }

  log.warn({ requestedPath, canonical, allowedRoots }, "Path escapes allowed roots");
  return null;
}

/**
 * Detect whether `filePath` is a symlink whose resolved target escapes `root`.
 *
 * Returns true (unsafe) if:
 *   - the path is a symlink AND its real target is outside root
 *   - realpathSync throws unexpectedly
 */
export function detectSymlinkEscape(filePath: string, root: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    // Path doesn't exist — no symlink to check
    return false;
  }

  if (!stat.isSymbolicLink()) return false;

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(filePath);
  } catch {
    // Can't resolve target — treat as unsafe
    log.warn({ filePath }, "Symlink target unresolvable — treating as escape");
    return true;
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(root);
  } catch {
    canonicalRoot = path.normalize(root);
  }

  const rootWithSep = canonicalRoot.endsWith(path.sep)
    ? canonicalRoot
    : canonicalRoot + path.sep;

  const escapes = realTarget !== canonicalRoot && !realTarget.startsWith(rootWithSep);
  if (escapes) {
    log.warn({ filePath, realTarget, root: canonicalRoot }, "Symlink escapes root");
  }
  return escapes;
}

/**
 * Resolve a path that may not fully exist by walking up to the nearest
 * existing ancestor and then normalising the remainder.
 */
function resolveNonExistent(filePath: string): string {
  const parts = path.normalize(filePath).split(path.sep);
  // Walk from full path upward until we find a segment that exists
  for (let i = parts.length; i > 0; i--) {
    const partial = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = fs.realpathSync(partial);
      const remaining = parts.slice(i).join(path.sep);
      return remaining ? path.join(real, remaining) : real;
    } catch {
      // keep walking up
    }
  }
  return path.normalize(filePath);
}
