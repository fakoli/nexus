/**
 * OCI Distribution Spec v2 client — manifest/blob pull & push, image-ref parsing.
 * Auth and token management live in oci-auth.ts.
 */
import { createHash } from "node:crypto";
import {
  OciAuthError, fetchToken, isBlockedHostname,
  resolveAuth, resolveCredentialForRegistry,
} from "./oci-auth.js";
import type { TokenCacheEntry } from "./oci-auth.js";
import { OciManifestSchema, OciImageIndexSchema, ParsedImageRefSchema, MEDIA_TYPES } from "./oci-types.js";
import type { OciDescriptor, OciManifest, ParsedImageRef } from "./oci-types.js";
import { MemoryBlobCache } from "./cache.js";
import type { RegistryAuth } from "./types.js";

export { OciAuthError, TOKEN_REFRESH_THRESHOLD_MS } from "./oci-auth.js";
export type { TokenCacheEntry } from "./oci-auth.js";

export interface BlobCache {
  get(digest: string): Promise<Uint8Array | undefined>;
  set(digest: string, data: Uint8Array): Promise<void>;
  has(digest: string): Promise<boolean>;
  delete(digest: string): Promise<void>;
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
export class OciSsrfBlockedError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciSsrfBlockedError"; }
}

export interface OciClientOptions {
  auth?: Record<string, RegistryAuth>;
  blobCache?: BlobCache;
  platform?: { architecture: string; os: string };
  /** If provided, only registries in this list are allowed. */
  registryAllowlist?: string[];
}

export function parseImageRef(raw: string): ParsedImageRef {
  if (!raw || raw.trim().length === 0) throw new InvalidImageRefError("Image reference must not be empty");
  let rest = raw.trim();
  let registry = "registry-1.docker.io";
  let reference = "latest";

  let digestPart: string | undefined;
  const atIdx = rest.lastIndexOf("@");
  if (atIdx !== -1) { digestPart = rest.slice(atIdx + 1); rest = rest.slice(0, atIdx); reference = digestPart; }

  if (!digestPart) {
    const colonIdx = rest.lastIndexOf(":");
    if (colonIdx !== -1) {
      const candidate = rest.slice(colonIdx + 1);
      if (!candidate.includes("/")) { rest = rest.slice(0, colonIdx); reference = candidate; }
    }
  }

  const slashIdx = rest.indexOf("/");
  if (slashIdx !== -1) {
    const first = rest.slice(0, slashIdx);
    if (first.includes(".") || first.includes(":") || first === "localhost") {
      registry = first; rest = rest.slice(slashIdx + 1);
    }
  }

  let repository = rest;
  if (registry === "registry-1.docker.io" && !repository.includes("/")) repository = `library/${repository}`;

  const result = ParsedImageRefSchema.safeParse({ registry, repository, reference, original: raw });
  if (!result.success) throw new InvalidImageRefError(`Invalid image reference '${raw}': ${result.error.message}`);
  return result.data;
}

export class OciClient {
  private readonly optAuth: Record<string, RegistryAuth>;
  private readonly cache: BlobCache & { getManifest?: (...args: string[]) => string | undefined; setManifest?: (...args: string[]) => void };
  private readonly platform: { architecture: string; os: string };
  private readonly tokenCache = new Map<string, TokenCacheEntry>();
  private readonly allowlist: string[] | undefined;

  constructor(options: OciClientOptions = {}) {
    this.optAuth = options.auth ?? {};
    this.cache = options.blobCache ?? new MemoryBlobCache();
    this.allowlist = options.registryAllowlist;
    this.platform = options.platform ?? {
      architecture: process.arch === "x64" ? "amd64" : process.arch,
      os: process.platform === "win32" ? "windows" : process.platform,
    };
  }

  private checkRegistry(registry: string): void {
    const hostname = registry.split(":")[0];
    if (this.allowlist) {
      if (!this.allowlist.includes(registry) && !this.allowlist.includes(hostname)) {
        throw new OciSsrfBlockedError(`Registry '${registry}' is not in the configured allowlist`);
      }
      return;
    }
    if (isBlockedHostname(hostname)) {
      throw new OciSsrfBlockedError(`Registry '${registry}' resolves to a private/internal address and is blocked`);
    }
  }

  async resolveAuth(registry: string): Promise<RegistryAuth> {
    return resolveAuth(registry, this.optAuth);
  }

  private async authHeaders(registry: string, repository: string, scope = "pull"): Promise<Record<string, string>> {
    const token = await fetchToken(registry, repository, scope, this.tokenCache, this.optAuth);
    if (token) return { Authorization: `Bearer ${token}` };
    const auth = await resolveAuth(registry, this.optAuth);
    const cred = resolveCredentialForRegistry(auth, registry);
    if (cred) {
      return { Authorization: `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}` };
    }
    return {};
  }

  async pullManifest(ref: ParsedImageRef): Promise<OciManifest> {
    const { registry, repository, reference } = ref;
    this.checkRegistry(registry);
    const auth = await this.authHeaders(registry, repository);
    const accept = [MEDIA_TYPES.OCI_MANIFEST, MEDIA_TYPES.OCI_INDEX, MEDIA_TYPES.DOCKER_MANIFEST_V2, MEDIA_TYPES.DOCKER_MANIFEST_LIST].join(", ");
    const res = await fetch(`https://${registry}/v2/${repository}/manifests/${reference}`, { headers: { ...auth, Accept: accept }, redirect: "follow" });
    if (res.status === 401) throw new OciAuthError(`Unauthorized pulling manifest ${ref.original}`);
    if (res.status === 404) throw new OciManifestNotFoundError(`Manifest not found: ${ref.original}`);
    if (!res.ok) throw new Error(`Manifest fetch failed (${res.status}): ${ref.original}`);
    const contentType = res.headers.get("content-type") ?? "";
    const rawJson = JSON.parse(await res.text()) as Record<string, unknown>;
    if (contentType.includes("image.index") || contentType.includes("manifest.list") ||
        rawJson["mediaType"] === MEDIA_TYPES.OCI_INDEX || rawJson["mediaType"] === MEDIA_TYPES.DOCKER_MANIFEST_LIST) {
      const idxResult = OciImageIndexSchema.safeParse(rawJson);
      if (!idxResult.success) throw new Error(`Invalid OCI image index: ${idxResult.error.message}`);
      const entry = idxResult.data.manifests.find(
        (m) => m.platform?.architecture === this.platform.architecture && m.platform?.os === this.platform.os,
      ) ?? idxResult.data.manifests[0];
      return this.pullManifest({ ...ref, reference: entry.digest });
    }
    const parsed = OciManifestSchema.safeParse(rawJson);
    if (!parsed.success) throw new Error(`Invalid OCI manifest: ${parsed.error.message}`);
    return parsed.data;
  }

  async pullBlob(registry: string, repository: string, descriptor: OciDescriptor): Promise<Uint8Array> {
    const { digest } = descriptor;
    this.checkRegistry(registry);
    const cached = await this.cache.get(digest);
    if (cached) return cached;
    const auth = await this.authHeaders(registry, repository);
    const res = await fetch(`https://${registry}/v2/${repository}/blobs/${digest}`, { headers: auth, redirect: "follow" });
    if (res.status === 401) throw new OciAuthError(`Unauthorized pulling blob ${digest}`);
    if (res.status === 404) throw new OciBlobNotFoundError(`Blob not found: ${digest}`);
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status}): ${digest}`);
    const data = new Uint8Array(await res.arrayBuffer());
    const [algo, expected] = digest.split(":");
    if (algo === "sha256") {
      const computed = createHash("sha256").update(data).digest("hex");
      if (computed !== expected) throw new OciDigestMismatchError(`Digest mismatch for ${digest}: got sha256:${computed}`);
    } else if (algo === "sha512") {
      const computed = createHash("sha512").update(data).digest("hex");
      if (computed !== expected) throw new OciDigestMismatchError(`Digest mismatch for ${digest}: got sha512:${computed}`);
    } else {
      throw new OciDigestMismatchError(`Unsupported digest algorithm '${algo}' for ${digest}`);
    }
    await this.cache.set(digest, data);
    return data;
  }

  async pushBlob(registry: string, repository: string, data: Uint8Array): Promise<OciDescriptor> {
    this.checkRegistry(registry);
    const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
    const auth = await this.authHeaders(registry, repository, "push");
    const initRes = await fetch(`https://${registry}/v2/${repository}/blobs/uploads/`, { method: "POST", headers: auth });
    if (!initRes.ok) throw new Error(`Blob upload init failed (${initRes.status})`);
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload location returned");
    const putUrl = new URL(uploadUrl.startsWith("http") ? uploadUrl : `https://${registry}${uploadUrl}`);
    putUrl.searchParams.set("digest", digest);
    const bodyBuf: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const putRes = await fetch(putUrl.toString(), {
      method: "PUT", headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: new Blob([bodyBuf], { type: "application/octet-stream" }),
    });
    if (!putRes.ok) throw new Error(`Blob upload PUT failed (${putRes.status})`);
    return { mediaType: "application/octet-stream", digest, size: data.byteLength };
  }

  async pushManifest(registry: string, repository: string, reference: string, manifest: OciManifest): Promise<string> {
    this.checkRegistry(registry);
    const auth = await this.authHeaders(registry, repository, "push");
    const body = JSON.stringify(manifest);
    const res = await fetch(`https://${registry}/v2/${repository}/manifests/${reference}`, {
      method: "PUT", headers: { ...auth, "Content-Type": MEDIA_TYPES.OCI_MANIFEST }, body,
    });
    if (!res.ok) throw new Error(`Manifest push failed (${res.status})`);
    return res.headers.get("docker-content-digest") ?? `sha256:${createHash("sha256").update(body).digest("hex")}`;
  }

  async listTags(registry: string, repository: string): Promise<string[]> {
    this.checkRegistry(registry);
    const auth = await this.authHeaders(registry, repository);
    const tags: string[] = [];
    let nextUrl: string | null = `https://${registry}/v2/${repository}/tags/list`;
    while (nextUrl) {
      const res: Response = await fetch(nextUrl, { headers: auth });
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

export { DiskBlobCache } from "./cache.js";
