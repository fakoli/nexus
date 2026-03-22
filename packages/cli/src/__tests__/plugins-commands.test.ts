/**
 * plugins-commands.test.ts
 *
 * Tests for the Nexus marketplace CLI commands and the marketplace helper
 * functions.  We test the underlying business logic directly (no shell
 * process spawning) so that tests are fast, hermetic, and don't require a
 * real network connection.
 *
 * Strategy:
 *   - Every test gets a fresh SQLite database in a temp directory so that
 *     config mutations never bleed between tests.
 *   - Registry network calls are intercepted by replacing `globalThis.fetch`
 *     with a stub for tests that exercise remote-registry code paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-plugins-test-"));
}

/** Build a minimal valid RegistryIndex payload for use in fetch stubs. */
function makeRegistryIndex(plugins: object[] = []) {
  return JSON.stringify({
    version: "1",
    updatedAt: "2026-01-01T00:00:00Z",
    plugins,
  });
}

function makeFakePlugin(overrides: Partial<{
  id: string; name: string; version: string; description: string;
  author: string; keywords: string[]; tarball: string;
}> = {}) {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "Tester",
    keywords: ["test"],
    tarball: "https://example.com/test-plugin-1.0.0.tgz",
    ...overrides,
  };
}

// ── Per-test DB isolation ─────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.env.NEXUS_DATA_DIR = tmpDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Close the SQLite singleton so the next test gets a fresh DB
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Registry list / add / remove ──────────────────────────────────────────────

describe("marketplace: listRegistries", () => {
  it("returns the default registry when nothing has been persisted", async () => {
    const { listRegistries, DEFAULT_REGISTRY_URL } = await import(
      "../commands/marketplace.js"
    );
    const list = listRegistries();
    expect(list).toEqual([DEFAULT_REGISTRY_URL]);
  });

  it("returns persisted registries after saveRegistries", async () => {
    const { listRegistries, saveRegistries } = await import(
      "../commands/marketplace.js"
    );
    saveRegistries(["https://example.com/reg1", "https://example.com/reg2"]);
    const list = listRegistries();
    expect(list).toContain("https://example.com/reg1");
    expect(list).toContain("https://example.com/reg2");
    expect(list).toHaveLength(2);
  });
});

describe("marketplace: addRegistry", () => {
  it("adds a new registry URL and returns true", async () => {
    const { addRegistry, listRegistries } = await import(
      "../commands/marketplace.js"
    );
    const added = addRegistry("https://example.com/my-registry");
    expect(added).toBe(true);
    expect(listRegistries()).toContain("https://example.com/my-registry");
  });

  it("returns false and does not duplicate when URL already present", async () => {
    const { addRegistry, listRegistries } = await import(
      "../commands/marketplace.js"
    );
    addRegistry("https://example.com/dup");
    const second = addRegistry("https://example.com/dup");
    expect(second).toBe(false);
    const list = listRegistries();
    expect(list.filter((u) => u === "https://example.com/dup")).toHaveLength(1);
  });

  it("treats trailing slash as the same URL", async () => {
    const { addRegistry, listRegistries } = await import(
      "../commands/marketplace.js"
    );
    addRegistry("https://example.com/reg/");
    const second = addRegistry("https://example.com/reg");
    expect(second).toBe(false);
    const list = listRegistries();
    const matches = list.filter((u) => u.replace(/\/$/, "") === "https://example.com/reg");
    expect(matches).toHaveLength(1);
  });
});

describe("marketplace: removeRegistry", () => {
  it("removes an existing registry and returns true", async () => {
    const { addRegistry, removeRegistry, listRegistries } = await import(
      "../commands/marketplace.js"
    );
    addRegistry("https://example.com/to-remove");
    const removed = removeRegistry("https://example.com/to-remove");
    expect(removed).toBe(true);
    expect(listRegistries()).not.toContain("https://example.com/to-remove");
  });

  it("returns false when URL is not configured", async () => {
    const { removeRegistry } = await import("../commands/marketplace.js");
    const result = removeRegistry("https://example.com/not-there");
    expect(result).toBe(false);
  });

  it("falls back to the default registry when the last entry is removed", async () => {
    const { saveRegistries, removeRegistry, listRegistries, DEFAULT_REGISTRY_URL } =
      await import("../commands/marketplace.js");
    saveRegistries(["https://example.com/only-one"]);
    removeRegistry("https://example.com/only-one");
    expect(listRegistries()).toEqual([DEFAULT_REGISTRY_URL]);
  });
});

// ── validateRegistry (network) ────────────────────────────────────────────────

describe("marketplace: validateRegistry", () => {
  it("parses a well-formed registry.json response", async () => {
    const { validateRegistry } = await import("../commands/marketplace.js");
    const plugin = makeFakePlugin();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex([plugin])),
    }));

    const index = await validateRegistry("https://example.com/reg");
    expect(index.plugins).toHaveLength(1);
    expect(index.plugins[0].id).toBe("test-plugin");
  });

  it("throws when fetch rejects (network error)", async () => {
    const { validateRegistry } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(validateRegistry("https://unreachable.example.com")).rejects.toThrow(
      /Cannot reach registry/,
    );
  });

  it("throws when the server returns a non-200 status", async () => {
    const { validateRegistry } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }));

    await expect(validateRegistry("https://example.com/missing")).rejects.toThrow(/HTTP 404/);
  });

  it("throws when the response is not valid JSON", async () => {
    const { validateRegistry } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    }));

    await expect(validateRegistry("https://example.com/bad-json")).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it("throws when the response JSON lacks a 'plugins' array", async () => {
    const { validateRegistry } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ version: "1", updatedAt: "now" }), // no plugins key
    }));

    await expect(validateRegistry("https://example.com/wrong-shape")).rejects.toThrow(
      /unexpected format/i,
    );
  });
});

// ── searchRegistries ──────────────────────────────────────────────────────────

describe("marketplace: searchRegistries", () => {
  it("returns plugins whose fields match the query term", async () => {
    const { searchRegistries } = await import("../commands/marketplace.js");
    const plugins = [
      makeFakePlugin({ id: "slack-bridge", name: "Slack Bridge", description: "Slack integration" }),
      makeFakePlugin({ id: "email-agent", name: "Email Agent", description: "Send emails" }),
    ];
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex(plugins)),
    }));

    const results = await searchRegistries("slack", ["https://example.com/reg"]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("slack-bridge");
  });

  it("returns an empty array when nothing matches", async () => {
    const { searchRegistries } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex([makeFakePlugin()])),
    }));

    const results = await searchRegistries("nonexistent-xyz", ["https://example.com/reg"]);
    expect(results).toHaveLength(0);
  });

  it("skips unreachable registries instead of throwing", async () => {
    const { searchRegistries } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("good")) {
        return {
          ok: true,
          json: async () => JSON.parse(makeRegistryIndex([makeFakePlugin({ id: "found-plugin" })])),
        };
      }
      throw new Error("timeout");
    });

    const results = await searchRegistries("found", [
      "https://bad.example.com/reg",
      "https://good.example.com/reg",
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("found-plugin");
  });

  it("deduplicates plugins by ID when they appear in multiple registries", async () => {
    const { searchRegistries } = await import("../commands/marketplace.js");
    const plugin = makeFakePlugin({ id: "shared-plugin" });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex([plugin])),
    }));

    const results = await searchRegistries("shared", [
      "https://reg1.example.com",
      "https://reg2.example.com",
    ]);
    expect(results.filter((r) => r.id === "shared-plugin")).toHaveLength(1);
  });
});

// ── lookupPlugin ──────────────────────────────────────────────────────────────

describe("marketplace: lookupPlugin", () => {
  it("returns the plugin with its source registry URL when found", async () => {
    const { lookupPlugin } = await import("../commands/marketplace.js");
    const plugin = makeFakePlugin({ id: "my-plugin" });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex([plugin])),
    }));

    const result = await lookupPlugin("my-plugin", ["https://example.com/reg"]);
    expect(result).toBeDefined();
    expect(result!.id).toBe("my-plugin");
    expect(result!.registryUrl).toBe("https://example.com/reg");
  });

  it("returns undefined when the plugin ID does not exist in any registry", async () => {
    const { lookupPlugin } = await import("../commands/marketplace.js");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => JSON.parse(makeRegistryIndex([makeFakePlugin({ id: "other-plugin" })])),
    }));

    const result = await lookupPlugin("does-not-exist", ["https://example.com/reg"]);
    expect(result).toBeUndefined();
  });
});

// ── resolveRegistryJsonUrl ────────────────────────────────────────────────────

describe("marketplace: resolveRegistryJsonUrl", () => {
  it("appends /registry.json to a bare base URL", async () => {
    const { resolveRegistryJsonUrl } = await import("../commands/marketplace.js");
    expect(resolveRegistryJsonUrl("https://example.com/reg")).toBe(
      "https://example.com/reg/registry.json",
    );
  });

  it("does not double-append if URL already ends with /registry.json", async () => {
    const { resolveRegistryJsonUrl } = await import("../commands/marketplace.js");
    const url = "https://example.com/reg/registry.json";
    expect(resolveRegistryJsonUrl(url)).toBe(url);
  });

  it("strips a trailing slash before appending", async () => {
    const { resolveRegistryJsonUrl } = await import("../commands/marketplace.js");
    expect(resolveRegistryJsonUrl("https://example.com/reg/")).toBe(
      "https://example.com/reg/registry.json",
    );
  });
});

// ── plugins command structure ─────────────────────────────────────────────────

describe("pluginsCommand: command structure", () => {
  it("exports a Command named 'plugins'", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    expect(pluginsCommand.name()).toBe("plugins");
  });

  it("has a 'list' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("list");
  });

  it("has a 'search' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("search");
  });

  it("has an 'install' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("install");
  });

  it("has an 'update' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("update");
  });

  it("has an 'uninstall' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("uninstall");
  });

  it("has an 'info' sub-command", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const names = pluginsCommand.commands.map((c) => c.name());
    expect(names).toContain("info");
  });

  it("has a 'registry' sub-command with add/list/remove children", async () => {
    const { pluginsCommand } = await import("../commands/plugins.js");
    const registryCmd = pluginsCommand.commands.find((c) => c.name() === "registry");
    expect(registryCmd).toBeDefined();
    const childNames = registryCmd!.commands.map((c) => c.name());
    expect(childNames).toContain("add");
    expect(childNames).toContain("list");
    expect(childNames).toContain("remove");
  });
});
