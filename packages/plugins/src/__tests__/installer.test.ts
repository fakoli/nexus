import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-installer-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const { closeDb, runMigrations } = await import("@nexus/core");
  closeDb();
  runMigrations();
}

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

const VALID_MANIFEST = {
  id: "test-plugin",
  name: "Test Plugin",
  version: "1.0.0",
  description: "A test plugin",
  author: "tester",
  repository: "https://github.com/fakoli/fakoli-plugins",
  main: "src/index.ts",
  nexus: {
    minVersion: "0.1.0",
    type: "tool",
  },
};

const VALID_REGISTRY = {
  version: 1,
  plugins: [
    {
      id: "test-plugin",
      name: "Test Plugin",
      description: "A test plugin",
      version: "1.0.0",
      author: "tester",
      repository: "https://github.com/fakoli/fakoli-plugins",
      path: "plugins/test-plugin",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests for readLocalManifest
// ---------------------------------------------------------------------------

describe("installer: readLocalManifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads and validates a valid nexus-plugin.json", async () => {
    writeFileSync(path.join(dir, "nexus-plugin.json"), JSON.stringify(VALID_MANIFEST));
    const { readLocalManifest } = await import("../installer.js");
    const manifest = readLocalManifest(dir);
    expect(manifest.id).toBe("test-plugin");
    expect(manifest.version).toBe("1.0.0");
  });

  it("throws when nexus-plugin.json is missing", async () => {
    const { readLocalManifest } = await import("../installer.js");
    expect(() => readLocalManifest(dir)).toThrow(/manifest not found/);
  });

  it("throws when the manifest fails Zod validation", async () => {
    writeFileSync(
      path.join(dir, "nexus-plugin.json"),
      JSON.stringify({ id: "bad id!", version: "not-semver" }),
    );
    const { readLocalManifest } = await import("../installer.js");
    expect(() => readLocalManifest(dir)).toThrow(/Invalid plugin manifest/);
  });

  it("throws when nexus-plugin.json is malformed JSON", async () => {
    writeFileSync(path.join(dir, "nexus-plugin.json"), "{ not valid json }");
    const { readLocalManifest } = await import("../installer.js");
    expect(() => readLocalManifest(dir)).toThrow();
  });

  it("accepts a manifest with optional dependencies field", async () => {
    const withDeps = { ...VALID_MANIFEST, dependencies: { axios: "^1.0.0" } };
    writeFileSync(path.join(dir, "nexus-plugin.json"), JSON.stringify(withDeps));
    const { readLocalManifest } = await import("../installer.js");
    const manifest = readLocalManifest(dir);
    expect(manifest.dependencies).toEqual({ axios: "^1.0.0" });
  });
});

// ---------------------------------------------------------------------------
// Tests for installPlugin (mocked fetch + tar + child_process)
// ---------------------------------------------------------------------------

describe("installer: installPlugin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    vi.resetModules();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    const { closeDb } = await import("@nexus/core");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when plugin is not in the registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ version: 1, plugins: [] })),
    );
    const { installPlugin } = await import("../installer.js");
    await expect(
      installPlugin("https://github.com/fakoli/fakoli-plugins", "missing-plugin"),
    ).rejects.toThrow(/not found in registry/);
  });

  it("throws when already installed and force=false", async () => {
    // Pre-record as installed
    vi.resetModules();
    const { recordInstall } = await import("../registry.js");
    recordInstall({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      registryUrl: "https://github.com/fakoli/fakoli-plugins",
      installPath: path.join(dir, "plugins", "test-plugin"),
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { installPlugin } = await import("../installer.js");
    await expect(
      installPlugin("https://github.com/fakoli/fakoli-plugins", "test-plugin"),
    ).rejects.toThrow(/already installed/);
  });

  it("throws when the registry fetch fails (HTTP error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({}, 503)));
    const { installPlugin } = await import("../installer.js");
    await expect(
      installPlugin("https://github.com/fakoli/fakoli-plugins", "test-plugin"),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("throws when the manifest id mismatches the registry entry", async () => {
    const wrongManifest = { ...VALID_MANIFEST, id: "different-plugin" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(VALID_REGISTRY)) // registry
      .mockResolvedValueOnce(mockJsonResponse(wrongManifest)); // manifest
    vi.stubGlobal("fetch", fetchMock);
    const { installPlugin } = await import("../installer.js");
    await expect(
      installPlugin("https://github.com/fakoli/fakoli-plugins", "test-plugin"),
    ).rejects.toThrow(/Manifest id mismatch/);
  });

  it("calls fetch with the GitHub tarball API URL", async () => {
    // We can't complete the install (no real tarball) but we can verify the
    // correct URL is attempted for the tarball download.
    const tarballCallUrl: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      tarballCallUrl.push(url);
      if (url.includes("registry.json")) return Promise.resolve(mockJsonResponse(VALID_REGISTRY));
      if (url.includes("nexus-plugin.json")) return Promise.resolve(mockJsonResponse(VALID_MANIFEST));
      // tarball download — simulate a broken body to abort early
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        body: null, // triggers "Empty response body" error
        json: async () => ({}),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { installPlugin } = await import("../installer.js");
    await expect(
      installPlugin("https://github.com/fakoli/fakoli-plugins", "test-plugin"),
    ).rejects.toThrow(/Empty response body/);
    expect(tarballCallUrl.some((u) => u.includes("api.github.com/repos"))).toBe(true);
  });

  it("Zod rejects a manifest with an invalid plugin id format", async () => {
    const { PluginManifestSchema } = await import("../types.js");
    const result = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, id: "Bad ID!" });
    expect(result.success).toBe(false);
  });

  it("Zod rejects a manifest with a non-semver version", async () => {
    const { PluginManifestSchema } = await import("../types.js");
    const result = PluginManifestSchema.safeParse({ ...VALID_MANIFEST, version: "v1" });
    expect(result.success).toBe(false);
  });

  it("Zod accepts a fully valid manifest", async () => {
    const { PluginManifestSchema } = await import("../types.js");
    const result = PluginManifestSchema.safeParse(VALID_MANIFEST);
    expect(result.success).toBe(true);
  });
});
