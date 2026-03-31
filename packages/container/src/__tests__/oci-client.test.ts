/**
 * OCI client tests — mock fetch, test auth flow, manifest parsing, digest verification, cache.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseImageRef, OciClient, OciAuthError, OciManifestNotFoundError, OciDigestMismatchError, InvalidImageRefError } from "../oci-client.js";
import { MemoryBlobCache } from "../cache.js";
import type { BlobCache } from "../oci-client.js";
import { createHash } from "node:crypto";

// ── parseImageRef tests ────────────────────────────────────────────────────

describe("parseImageRef", () => {
  it("parses a bare image name", () => {
    const ref = parseImageRef("ubuntu");
    expect(ref.registry).toBe("registry-1.docker.io");
    expect(ref.repository).toBe("library/ubuntu");
    expect(ref.reference).toBe("latest");
    expect(ref.original).toBe("ubuntu");
  });

  it("parses image with tag", () => {
    const ref = parseImageRef("ubuntu:22.04");
    expect(ref.registry).toBe("registry-1.docker.io");
    expect(ref.repository).toBe("library/ubuntu");
    expect(ref.reference).toBe("22.04");
  });

  it("parses ghcr.io reference with org/repo", () => {
    const ref = parseImageRef("ghcr.io/org/plugin:1.2.3");
    expect(ref.registry).toBe("ghcr.io");
    expect(ref.repository).toBe("org/plugin");
    expect(ref.reference).toBe("1.2.3");
  });

  it("parses digest reference", () => {
    const ref = parseImageRef("ghcr.io/org/app@sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(ref.registry).toBe("ghcr.io");
    expect(ref.reference).toBe("sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });

  it("throws InvalidImageRefError for empty string", () => {
    expect(() => parseImageRef("")).toThrow(InvalidImageRefError);
  });

  it("parses localhost registry", () => {
    const ref = parseImageRef("localhost:5000/myimage:dev");
    expect(ref.registry).toBe("localhost:5000");
    expect(ref.repository).toBe("myimage");
    expect(ref.reference).toBe("dev");
  });
});

// ── OciClient auth tests ───────────────────────────────────────────────────

describe("OciClient.resolveAuth", () => {
  it("returns anonymous when no config is present", async () => {
    // Spy on fs.readFileSync to simulate missing docker config
    const { default: fs } = await import("node:fs");
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const client = new OciClient({});
    const auth = await client.resolveAuth("ghcr.io");
    expect(auth.kind).toBe("anonymous");
    spy.mockRestore();
  });

  it("returns auth from constructor auth map", async () => {
    const client = new OciClient({
      auth: { "ghcr.io": { kind: "basic", username: "user", password: "pass" } },
    });
    const auth = await client.resolveAuth("ghcr.io");
    expect(auth.kind).toBe("basic");
    if (auth.kind === "basic") {
      expect(auth.username).toBe("user");
    }
  });
});

// ── OciClient manifest pull tests ─────────────────────────────────────────

function mockFetchForManifest(status: number, body: unknown, contentType: string): void {
  const probe = { status: 401, headers: new Headers({ "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }) };
  const tokenResponse = { ok: true, status: 200, json: async () => ({ token: "test-token", expires_in: 3600 }) };
  const manifestResponse = {
    ok: status === 200,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: async () => JSON.stringify(body),
  };

  vi.mocked(fetch).mockResolvedValueOnce(probe as unknown as Response);
  vi.mocked(fetch).mockResolvedValueOnce(tokenResponse as unknown as Response);
  vi.mocked(fetch).mockResolvedValueOnce(manifestResponse as unknown as Response);
}

describe("OciClient.pullManifest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns a valid OciManifest on success", async () => {
    const manifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: "sha256:aa", size: 100 },
      layers: [{ mediaType: "application/vnd.wasm.content.layer.v1+wasm", digest: "sha256:bb", size: 200 }],
    };
    mockFetchForManifest(200, manifest, "application/vnd.oci.image.manifest.v1+json");

    const client = new OciClient({ blobCache: new MemoryBlobCache() });
    const ref = parseImageRef("ghcr.io/org/plugin:latest");
    const result = await client.pullManifest(ref);
    expect(result.schemaVersion).toBe(2);
    expect(result.layers).toHaveLength(1);
  });

  it("throws OciManifestNotFoundError on 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ status: 401, headers: new Headers({ "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: "tok", expires_in: 60 }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers({ "content-type": "application/json" }), text: async () => "{}" } as unknown as Response);

    const client = new OciClient({ blobCache: new MemoryBlobCache() });
    const ref = parseImageRef("ghcr.io/org/notfound:latest");
    await expect(client.pullManifest(ref)).rejects.toThrow(OciManifestNotFoundError);
  });
});

// ── OciClient blob pull tests ──────────────────────────────────────────────

describe("OciClient.pullBlob", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns cached blob without network request", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
    const cache: BlobCache = new MemoryBlobCache();
    await cache.set(digest, data);

    const client = new OciClient({ blobCache: cache });
    const result = await client.pullBlob("ghcr.io", "org/repo", { mediaType: "application/octet-stream", digest, size: 4 });
    expect(result).toEqual(data);
    // fetch should not have been called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("throws OciDigestMismatchError when digest does not match", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const wrongDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    vi.mocked(fetch)
      .mockResolvedValueOnce({ status: 401, headers: new Headers({ "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: "tok", expires_in: 60 }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => data.buffer } as unknown as Response);

    const client = new OciClient({ blobCache: new MemoryBlobCache() });
    await expect(
      client.pullBlob("ghcr.io", "org/repo", { mediaType: "application/octet-stream", digest: wrongDigest, size: 3 }),
    ).rejects.toThrow(OciDigestMismatchError);
  });
});

// ── MemoryBlobCache tests ─────────────────────────────────────────────────

describe("MemoryBlobCache", () => {
  it("stores and retrieves blobs", async () => {
    const cache = new MemoryBlobCache();
    const data = new Uint8Array([10, 20, 30]);
    await cache.set("sha256:abc", data);
    expect(await cache.has("sha256:abc")).toBe(true);
    const result = await cache.get("sha256:abc");
    expect(result).toEqual(data);
  });

  it("returns undefined for missing blobs", async () => {
    const cache = new MemoryBlobCache();
    expect(await cache.get("sha256:missing")).toBeUndefined();
    expect(await cache.has("sha256:missing")).toBe(false);
  });

  it("deletes blobs", async () => {
    const cache = new MemoryBlobCache();
    await cache.set("sha256:del", new Uint8Array([1]));
    await cache.delete("sha256:del");
    expect(await cache.has("sha256:del")).toBe(false);
  });
});
