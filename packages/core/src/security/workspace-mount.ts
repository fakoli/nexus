/**
 * Workspace mount access control.
 *
 * Defines which filesystem roots an agent may access and whether
 * write operations are permitted.
 */
import path from "node:path";
import fs from "node:fs";
import { createLogger } from "../logger.js";

const log = createLogger("core:security:workspace-mount");

export interface MountEntry {
  root: string;
  writable: boolean;
}

export type WorkspaceConfig = MountEntry[];

export interface AccessResult {
  allowed: boolean;
  reason?: string;
  mount?: MountEntry;
}

/**
 * Return the default workspace configuration: the current working
 * directory, writable.
 */
export function getDefaultMounts(): WorkspaceConfig {
  return [{ root: process.cwd(), writable: true }];
}

/**
 * Check whether `filePath` is accessible for `operation` given `mounts`.
 *
 * Read operations require the path to fall under any mount root.
 * Write operations additionally require the matching mount to be writable.
 */
/** Resolve a path that may not fully exist to its canonical prefix. */
function resolveNonExistent(filePath: string): string {
  const parts = path.normalize(filePath).split(path.sep);
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

export function checkMountAccess(
  filePath: string,
  operation: "read" | "write",
  mounts: WorkspaceConfig,
): AccessResult {
  if (!path.isAbsolute(filePath)) {
    return { allowed: false, reason: "Path must be absolute" };
  }

  if (mounts.length === 0) {
    log.warn({ filePath, operation }, "No mounts configured — denying");
    return { allowed: false, reason: "No workspace mounts configured" };
  }

  for (const mount of mounts) {
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync(mount.root);
    } catch {
      canonicalRoot = path.normalize(mount.root);
    }

    let canonicalFile: string;
    try {
      canonicalFile = fs.realpathSync(filePath);
    } catch {
      // File may not yet exist; walk up to nearest existing ancestor and
      // resolve from there so we match the canonical root prefix.
      canonicalFile = resolveNonExistent(filePath);
    }

    const rootWithSep = canonicalRoot.endsWith(path.sep)
      ? canonicalRoot
      : canonicalRoot + path.sep;

    const underMount =
      canonicalFile === canonicalRoot || canonicalFile.startsWith(rootWithSep);

    if (!underMount) continue;

    if (operation === "write" && !mount.writable) {
      log.warn({ filePath, mount: mount.root }, "Write denied — mount is read-only");
      return {
        allowed: false,
        reason: `Mount "${mount.root}" is read-only`,
        mount,
      };
    }

    log.debug({ filePath, operation, mount: mount.root }, "Mount access granted");
    return { allowed: true, mount };
  }

  log.warn({ filePath, operation }, "Path outside all workspace mounts");
  return {
    allowed: false,
    reason: `"${filePath}" is outside all configured workspace mounts`,
  };
}
