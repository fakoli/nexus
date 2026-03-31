/**
 * Content-addressable blob cache for the @nexus/container package.
 *
 * Two implementations:
 * - DiskBlobCache: stores blobs at ~/.nexus/cache/blobs/sha256/<hash>
 * - MemoryBlobCache: in-memory Map, discarded on process exit
 *
 * Both satisfy the BlobCache interface from oci-client.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@nexus/core";
import type { BlobCache } from "./oci-client.js";

const log = createLogger("container:cache");

// ── Path safety helpers ───────────────────────────────────────────────────────

/**
 * Sanitise a path component: replace any character that is not an alphanumeric,
 * hyphen, underscore, or dot with an underscore.  This prevents directory
 * traversal when registry/repo strings are used as directory names.
 */
function safePathComponent(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Assert that `resolved` starts with `base` (both path.resolve'd).
 * Throws if the resulting path escapes the base directory.
 */
function assertUnderBase(base: string, resolved: string): void {
  const normalBase = path.resolve(base) + path.sep;
  const normalResolved = path.resolve(resolved);
  if (!normalResolved.startsWith(normalBase) && normalResolved !== path.resolve(base)) {
    throw new Error(`Path traversal detected: '${resolved}' escapes cache root '${base}'`);
  }
}

// ── Disk-backed implementation ────────────────────────────────────────────────

export class DiskBlobCache implements BlobCache {
  private readonly blobDir: string;
  private readonly manifestDir: string;

  constructor(cacheRoot: string) {
    this.blobDir = path.join(cacheRoot, "blobs", "sha256");
    this.manifestDir = path.join(cacheRoot, "manifests");
    fs.mkdirSync(this.blobDir, { recursive: true });
    fs.mkdirSync(this.manifestDir, { recursive: true });
  }

  private blobPath(digest: string): string {
    // digest format: "sha256:<hex>" — use just the hex part as filename
    const hash = digest.replace(/^[^:]+:/, "");
    if (!/^[0-9a-f]+$/.test(hash)) {
      throw new Error(`Invalid digest hash: ${hash}`);
    }
    return path.join(this.blobDir, hash);
  }

  async get(digest: string): Promise<Uint8Array | undefined> {
    const filePath = this.blobPath(digest);
    try {
      const data = fs.readFileSync(filePath);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch {
      return undefined;
    }
  }

  async set(digest: string, data: Uint8Array): Promise<void> {
    const filePath = this.blobPath(digest);
    fs.writeFileSync(filePath, data);
    log.debug({ digest, bytes: data.length }, "Cached blob to disk");
  }

  async has(digest: string): Promise<boolean> {
    return fs.existsSync(this.blobPath(digest));
  }

  async delete(digest: string): Promise<void> {
    try {
      fs.unlinkSync(this.blobPath(digest));
    } catch {
      // no-op if not present
    }
  }

  /** Store a manifest JSON string keyed by registry/repo/ref. */
  setManifest(registry: string, repo: string, ref: string, data: string): void {
    const safeRegistry = safePathComponent(registry);
    const safeRepo = safePathComponent(repo);
    const safeRef = safePathComponent(ref);

    const dir = path.join(this.manifestDir, safeRegistry, safeRepo);
    assertUnderBase(this.manifestDir, dir);

    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${safeRef}.json`);
    assertUnderBase(this.manifestDir, filePath);

    fs.writeFileSync(filePath, data, "utf-8");
  }

  /** Retrieve a cached manifest JSON string, or undefined on miss. */
  getManifest(registry: string, repo: string, ref: string): string | undefined {
    const safeRegistry = safePathComponent(registry);
    const safeRepo = safePathComponent(repo);
    const safeRef = safePathComponent(ref);

    const filePath = path.join(this.manifestDir, safeRegistry, safeRepo, `${safeRef}.json`);
    try {
      assertUnderBase(this.manifestDir, filePath);
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return undefined;
    }
  }
}

// ── In-memory implementation ──────────────────────────────────────────────────

export class MemoryBlobCache implements BlobCache {
  private readonly store = new Map<string, Uint8Array>();

  async get(digest: string): Promise<Uint8Array | undefined> {
    return this.store.get(digest);
  }

  async set(digest: string, data: Uint8Array): Promise<void> {
    this.store.set(digest, data);
  }

  async has(digest: string): Promise<boolean> {
    return this.store.has(digest);
  }

  async delete(digest: string): Promise<void> {
    this.store.delete(digest);
  }
}
