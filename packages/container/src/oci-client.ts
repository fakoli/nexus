/**
 * OCI Distribution Spec v2 client — real implementation.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createLogger } from "@nexus/core";
import type { RegistryAuth } from "./types.js";
import { OciManifestSchema, OciImageIndexSchema, ParsedImageRefSchema, MEDIA_TYPES } from "./oci-types.js";
import type { OciDescriptor, OciManifest, ParsedImageRef } from "./oci-types.js";
import { MemoryBlobCache, DiskBlobCache } from "./cache.js";

const log = createLogger("container:oci-client");

export interface BlobCache {
  get(digest: string): Promise<Uint8Array | undefined>;
  set(digest: string, data: Uint8Array): Promise<void>;
  has(digest: string): Promise<boolean>;
  delete(digest: string): Promise<void>;
}

export interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

export const TOKEN_REFRESH_THRESHOLD_MS = 30_000;

export interface OciClientOptions {
  auth?: Record<string, RegistryAuth>;
  blobCache?: BlobCache;
  platform?: { architecture: string; os: string };
}

// ── Error types ──────────────────────────────────────────────────────────────

export class OciAuthError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciAuthError"; }
}
export class OciManifestNotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciManifestNotFoundError"; }
}
export class OciDigestMismatchError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciDigestMismatchError"; }
}
export class OciBlobNotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciBlobNotFoundError"; }
}
export class InvalidImageRefError extends Error {
  constructor(msg: string) { super(msg); this.name = "InvalidImageRefError"; }
}

// ── parseImageRef ────────────────────────────────────────────────────────────

export function parseImageRef(raw: string): ParsedImageRef {
  if (!raw || raw.trim().length === 0) {
    throw new InvalidImageRefError("Image reference must not be empty");
  }

  let rest = raw.trim();
  let registry = "registry-1.docker.io";
  let reference = "latest";

  // Split off digest (@sha256:...)
  let digestPart: string | undefined;
  const atIdx = rest.lastIndexOf("@");
  if (atIdx !== -1) {
    digestPart = rest.slice(atIdx + 1);
    rest = rest.slice(0, atIdx);
    reference = digestPart;
  }

  // Split off tag (:tag) — only after digest check to avoid matching port
  let tagPart: string | undefined;
  if (!digestPart) {
    const colonIdx = rest.lastIndexOf(":");
    if (colonIdx !== -1) {
      const candidate = rest.slice(colonIdx + 1);
      // A colon before a slash means it's part of a registry:port, not a tag
      if (!candidate.includes("/")) {
        tagPart = candidate;
        rest = rest.slice(0, colonIdx);
        reference = tagPart;
      }
    }
  }

  // Determine registry vs repository
  // If the first component contains a dot or colon or is "localhost", it's a registry
  const slashIdx = rest.indexOf("/");
  if (slashIdx !== -1) {
    const firstComponent = rest.slice(0, slashIdx);
    if (
      firstComponent.includes(".") ||
      firstComponent.includes(":") ||
      firstComponent === "localhost"
    ) {
      registry = firstComponent;
      rest = rest.slice(slashIdx + 1);
    }
  }

  // Docker Hub short names: "ubuntu" → "library/ubuntu"
  let repository = rest;
  if (registry === "registry-1.docker.io" && !repository.includes("/")) {
    repository = `library/${repository}`;
  }

  const result = ParsedImageRefSchema.safeParse({ registry, repository, reference, original: raw });
  if (!result.success) {
    throw new InvalidImageRefError(`Invalid image reference '${raw}': ${result.error.message}`);
  }
  return result.data;
}

// ── OciClient ────────────────────────────────────────────────────────────────

export class OciClient {
  private readonly optAuth: Record<string, RegistryAuth>;
  private readonly cache: BlobCache & { getManifest?: (...args: string[]) => string | undefined; setManifest?: (...args: string[]) => void };
  private readonly platform: { architecture: string; os: string };
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(options: OciClientOptions = {}) {
    this.optAuth = options.auth ?? {};
    this.cache = options.blobCache ?? new MemoryBlobCache();
    this.platform = options.platform ?? {
      architecture: process.arch === "x64" ? "amd64" : process.arch,
      os: process.platform === "win32" ? "windows" : process.platform,
    };
  }

  // ── Auth resolution ────────────────────────────────────────────────

  async resolveAuth(registry: string): Promise<RegistryAuth> {
    // 1. Constructor-provided auth map
    const explicit = this.optAuth[registry];
    if (explicit) return explicit;

    // 2. ~/.docker/config.json
    const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");
    try {
      const raw = fs.readFileSync(dockerConfigPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;

      // credHelpers: registry → helper name
      const credHelpers = config["credHelpers"] as Record<string, string> | undefined;
      if (credHelpers?.[registry]) {
        return { kind: "credential-helper", helperName: credHelpers[registry] };
      }

      // auths: registry → { auth: base64(user:pass) }
      const auths = config["auths"] as Record<string, Record<string, string>> | undefined;
      const entry = auths?.[registry];
      if (entry?.auth) {
        const decoded = Buffer.from(entry.auth, "base64").toString("utf-8");
        const colonIdx = decoded.indexOf(":");
        if (colonIdx !== -1) {
          return {
            kind: "basic",
            username: decoded.slice(0, colonIdx),
            password: decoded.slice(colonIdx + 1),
          };
        }
      }
    } catch {
      // docker config not present — fall through to anonymous
    }

    return { kind: "anonymous" };
  }

  private async resolveCredential(auth: RegistryAuth): Promise<{ username: string; password: string } | null> {
    if (auth.kind === "basic") {
      return { username: auth.username, password: auth.password };
    }
    if (auth.kind === "credential-helper") {
      try {
        const output = execFileSync(`docker-credential-${auth.helperName}`, ["get"], {
          input: auth.helperName,
          encoding: "utf-8",
        });
        const parsed = JSON.parse(output) as { Username?: string; Secret?: string };
        if (parsed.Username && parsed.Secret) {
          return { username: parsed.Username, password: parsed.Secret };
        }
      } catch {
        log.warn({ helper: auth.helperName }, "Credential helper failed");
      }
    }
    return null;
  }

  // ── Token management ────────────────────────────────────────────────

  private async getToken(registry: string, repository: string, scope: string): Promise<string | null> {
    const cacheKey = `${registry}/${repository}/${scope}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) {
      return cached.token;
    }

    // Make an unauthenticated request to get the auth challenge
    const probeUrl = `https://${registry}/v2/`;
    let wwwAuth: string | null = null;
    try {
      const probeRes = await fetch(probeUrl, { method: "GET" });
      if (probeRes.status === 401) {
        wwwAuth = probeRes.headers.get("www-authenticate");
      } else if (probeRes.ok) {
        return null; // no auth needed
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new OciAuthError(`Failed to probe registry ${registry}: ${msg}`);
    }

    if (!wwwAuth) return null;

    // Parse the Bearer challenge
    const realmMatch = /realm="([^"]+)"/.exec(wwwAuth);
    const serviceMatch = /service="([^"]+)"/.exec(wwwAuth);
    if (!realmMatch) return null;

    const realm = realmMatch[1];
    const service = serviceMatch ? serviceMatch[1] : registry;
    const tokenUrl = new URL(realm);
    tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set("scope", `repository:${repository}:${scope}`);

    const auth = await this.resolveAuth(registry);
    const headers: Record<string, string> = { Accept: "application/json" };
    const cred = await this.resolveCredential(auth);
    if (cred) {
      headers["Authorization"] = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}`;
    }

    const tokenRes = await fetch(tokenUrl.toString(), { headers });
    if (!tokenRes.ok) {
      throw new OciAuthError(`Token fetch failed (${tokenRes.status}) for ${registry}/${repository}`);
    }

    const body = await tokenRes.json() as Record<string, unknown>;
    const token = (body["token"] ?? body["access_token"]) as string;
    const expiresIn = typeof body["expires_in"] === "number" ? body["expires_in"] : 60;
    const expiresAt = Date.now() + expiresIn * 1000;

    this.tokenCache.set(cacheKey, { token, expiresAt });
    return token;
  }

  private async authHeaders(registry: string, repository: string, scope = "pull"): Promise<Record<string, string>> {
    const token = await this.getToken(registry, repository, scope);
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  }

  // ── Manifest pull ────────────────────────────────────────────────────

  async pullManifest(ref: ParsedImageRef): Promise<OciManifest> {
    const { registry, repository, reference } = ref;
    const auth = await this.authHeaders(registry, repository);
    const accept = [
      MEDIA_TYPES.OCI_MANIFEST,
      MEDIA_TYPES.OCI_INDEX,
      MEDIA_TYPES.DOCKER_MANIFEST_V2,
      MEDIA_TYPES.DOCKER_MANIFEST_LIST,
    ].join(", ");

    const url = `https://${registry}/v2/${repository}/manifests/${reference}`;
    const res = await fetch(url, {
      headers: { ...auth, Accept: accept },
      redirect: "follow",
    });

    if (res.status === 401) throw new OciAuthError(`Unauthorized pulling manifest ${ref.original}`);
    if (res.status === 404) throw new OciManifestNotFoundError(`Manifest not found: ${ref.original}`);
    if (!res.ok) throw new Error(`Manifest fetch failed (${res.status}): ${ref.original}`);

    const contentType = res.headers.get("content-type") ?? "";
    const rawText = await res.text();
    const rawJson = JSON.parse(rawText) as Record<string, unknown>;

    // Image index — resolve to platform-specific manifest
    if (
      contentType.includes("image.index") ||
      contentType.includes("manifest.list") ||
      rawJson["mediaType"] === MEDIA_TYPES.OCI_INDEX ||
      rawJson["mediaType"] === MEDIA_TYPES.DOCKER_MANIFEST_LIST
    ) {
      const idxResult = OciImageIndexSchema.safeParse(rawJson);
      if (!idxResult.success) {
        throw new Error(`Invalid OCI image index: ${idxResult.error.message}`);
      }
      const entry = idxResult.data.manifests.find(
        (m) =>
          m.platform?.architecture === this.platform.architecture &&
          m.platform?.os === this.platform.os,
      ) ?? idxResult.data.manifests[0];

      return this.pullManifest({ ...ref, reference: entry.digest });
    }

    const parsed = OciManifestSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new Error(`Invalid OCI manifest: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  // ── Blob pull ─────────────────────────────────────────────────────────

  async pullBlob(registry: string, repository: string, descriptor: OciDescriptor): Promise<Uint8Array> {
    const { digest } = descriptor;

    const cached = await this.cache.get(digest);
    if (cached) return cached;

    const auth = await this.authHeaders(registry, repository);
    const url = `https://${registry}/v2/${repository}/blobs/${digest}`;
    const res = await fetch(url, { headers: auth, redirect: "follow" });

    if (res.status === 401) throw new OciAuthError(`Unauthorized pulling blob ${digest}`);
    if (res.status === 404) throw new OciBlobNotFoundError(`Blob not found: ${digest}`);
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status}): ${digest}`);

    const buffer = await res.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Verify digest
    const [algo, expected] = digest.split(":");
    if (algo === "sha256") {
      const computed = createHash("sha256").update(data).digest("hex");
      if (computed !== expected) {
        throw new OciDigestMismatchError(`Digest mismatch for ${digest}: got sha256:${computed}`);
      }
    }

    await this.cache.set(digest, data);
    return data;
  }

  // ── Blob push ────────────────────────────────────────────────────────

  async pushBlob(registry: string, repository: string, data: Uint8Array): Promise<OciDescriptor> {
    const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
    const auth = await this.authHeaders(registry, repository, "push");

    const initRes = await fetch(`https://${registry}/v2/${repository}/blobs/uploads/`, {
      method: "POST",
      headers: auth,
    });
    if (!initRes.ok) throw new Error(`Blob upload init failed (${initRes.status})`);

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload location returned");

    const putUrl = new URL(uploadUrl.startsWith("http") ? uploadUrl : `https://${registry}${uploadUrl}`);
    putUrl.searchParams.set("digest", digest);

    // Use ArrayBuffer directly — Bun/Node fetch BodyInit accepts ArrayBuffer
    const bodyBuf: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const putRes = await fetch(putUrl.toString(), {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: new Blob([bodyBuf], { type: "application/octet-stream" }),
    });
    if (!putRes.ok) throw new Error(`Blob upload PUT failed (${putRes.status})`);

    return { mediaType: "application/octet-stream", digest, size: data.byteLength };
  }

  // ── Manifest push ─────────────────────────────────────────────────────

  async pushManifest(registry: string, repository: string, reference: string, manifest: OciManifest): Promise<string> {
    const auth = await this.authHeaders(registry, repository, "push");
    const body = JSON.stringify(manifest);

    const res = await fetch(`https://${registry}/v2/${repository}/manifests/${reference}`, {
      method: "PUT",
      headers: {
        ...auth,
        "Content-Type": MEDIA_TYPES.OCI_MANIFEST,
      },
      body,
    });
    if (!res.ok) throw new Error(`Manifest push failed (${res.status})`);

    const cd = res.headers.get("docker-content-digest");
    return cd ?? `sha256:${createHash("sha256").update(body).digest("hex")}`;
  }

  // ── Tag listing ───────────────────────────────────────────────────────

  async listTags(registry: string, repository: string): Promise<string[]> {
    const auth = await this.authHeaders(registry, repository);
    const tags: string[] = [];
    let nextUrl: string | null = `https://${registry}/v2/${repository}/tags/list`;

    while (nextUrl) {
      const currentUrl: string = nextUrl;
      const res: Response = await fetch(currentUrl, { headers: auth });
      if (!res.ok) throw new Error(`Tag list failed (${res.status})`);
      const body = await res.json() as { tags?: string[] };
      tags.push(...(body.tags ?? []));
      const link: string | null = res.headers.get("link");
      nextUrl = link ? extractNextUrl(link, registry) : null;
    }

    return tags;
  }
}

function extractNextUrl(link: string, registry: string): string | null {
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  if (!match) return null;
  const rel = match[1];
  return rel.startsWith("http") ? rel : `https://${registry}${rel}`;
}

// Re-export DiskBlobCache for external use
export { DiskBlobCache } from "./cache.js";
