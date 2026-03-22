/**
 * plugins-commands.test.ts
 *
 * Tests for the Nexus plugins CLI command structure.
 * The marketplace.ts helper file has been removed (B-7); its registry
 * management functions now live in @nexus/plugins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-plugins-test-"));
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
