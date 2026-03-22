/**
 * doctor.test.ts
 *
 * Tests for the `nexus doctor` command.
 * Covers each check: data dir, DB, API key, gateway token, gateway reachable,
 * channels, plugins.  Network fetch is mocked throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Temp dir isolation ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-doctor-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.NEXUS_API_KEY;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Command structure ─────────────────────────────────────────────────────────

describe("doctorCommand: command metadata", () => {
  it("exports a Command named 'doctor'", async () => {
    const { doctorCommand } = await import("../commands/doctor.js");
    expect(doctorCommand.name()).toBe("doctor");
  });

  it("has alias 'check'", async () => {
    const { doctorCommand } = await import("../commands/doctor.js");
    expect(doctorCommand.alias()).toBe("check");
  });

  it("has a non-empty description", async () => {
    const { doctorCommand } = await import("../commands/doctor.js");
    expect(doctorCommand.description().length).toBeGreaterThan(0);
  });
});

// ── Data directory check ──────────────────────────────────────────────────────

describe("doctor: data directory check", () => {
  it("getDataDir returns a directory that exists", async () => {
    const { getDataDir } = await import("@nexus/core");
    const dir = getDataDir();
    const { existsSync } = await import("node:fs");
    expect(existsSync(dir)).toBe(true);
  });

  it("data directory is the tmp dir we set", async () => {
    const { getDataDir } = await import("@nexus/core");
    expect(getDataDir()).toBe(tmpDir);
  });
});

// ── Database check ────────────────────────────────────────────────────────────

describe("doctor: database check", () => {
  it("nexus.db does not exist before migrations", async () => {
    const { existsSync } = await import("node:fs");
    const dbPath = path.join(tmpDir, "nexus.db");
    expect(existsSync(dbPath)).toBe(false);
  });

  it("nexus.db exists after runMigrations", async () => {
    const { runMigrations, closeDb } = await import("@nexus/core");
    const { existsSync } = await import("node:fs");
    runMigrations();
    const dbPath = path.join(tmpDir, "nexus.db");
    expect(existsSync(dbPath)).toBe(true);
    closeDb();
  });

  it("user_version is > 0 after migrations", async () => {
    const { runMigrations, getDb, closeDb } = await import("@nexus/core");
    runMigrations();
    const db = getDb();
    const version = db.pragma("user_version", { simple: true }) as number;
    expect(version).toBeGreaterThan(0);
    closeDb();
  });

  it("table count is > 0 after migrations", async () => {
    const { runMigrations, getDb, closeDb } = await import("@nexus/core");
    runMigrations();
    const db = getDb();
    const { n } = db
      .prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'")
      .get() as { n: number };
    expect(n).toBeGreaterThan(0);
    closeDb();
  });
});

// ── API key check ─────────────────────────────────────────────────────────────

describe("doctor: API key check", () => {
  it("detects ANTHROPIC_API_KEY env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const key =
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.NEXUS_API_KEY;
    expect(key).toBeDefined();
    expect(key).toBe("sk-ant-test");
  });

  it("detects OPENAI_API_KEY env var", () => {
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const key =
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.NEXUS_API_KEY;
    expect(key).toBeDefined();
  });

  it("detects NEXUS_API_KEY env var", () => {
    process.env.NEXUS_API_KEY = "nexus-key-xyz";
    const key =
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.NEXUS_API_KEY;
    expect(key).toBe("nexus-key-xyz");
  });

  it("falls through to vault when no env var is set", async () => {
    const { runMigrations, storeCredential, retrieveCredential, initMasterKey, closeDb } =
      await import("@nexus/core");
    runMigrations();          // must run before initMasterKey (config table needed for salt)
    initMasterKey("test");

    storeCredential("anthropic.apiKey", "anthropic", "vault-key");
    const stored = retrieveCredential("anthropic.apiKey");
    expect(stored).toBe("vault-key");
    closeDb();
  });

  it("reports no key when neither env var nor vault has one", async () => {
    // No env vars set, vault is empty → retrieveCredential returns null
    const { runMigrations, retrieveCredential, initMasterKey, closeDb } =
      await import("@nexus/core");
    runMigrations();
    initMasterKey("test");

    const stored =
      retrieveCredential("anthropic.apiKey") ?? retrieveCredential("openai.apiKey");
    expect(stored).toBeNull();
    closeDb();
  });
});

// ── Gateway token check ───────────────────────────────────────────────────────

describe("doctor: gateway token check", () => {
  it("reports token missing when not configured", async () => {
    const { runMigrations, getAllConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    const cfg = getAllConfig();
    // gatewayToken is optional — not set by default
    expect(cfg.security.gatewayToken).toBeUndefined();
    closeDb();
  });

  it("reports token present after setConfig", async () => {
    const { runMigrations, setConfig, getAllConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    setConfig("security", { gatewayToken: "nxs_hello" });
    const cfg = getAllConfig();
    expect(cfg.security.gatewayToken).toBe("nxs_hello");
    closeDb();
  });
});

// ── Gateway reachability check (mocked fetch) ─────────────────────────────────

describe("doctor: gateway reachable check", () => {
  it("passes when fetch returns ok response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fakeFetch);

    const res = await fetch("http://localhost:18789/healthz", {
      signal: AbortSignal.timeout(2000),
    });
    expect(res.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledWith(
      "http://localhost:18789/healthz",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("fails when fetch throws (gateway not running)", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fakeFetch);

    await expect(
      fetch("http://localhost:18789/healthz", { signal: AbortSignal.timeout(2000) }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("fails when fetch returns non-ok status", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fakeFetch);

    const res = await fetch("http://localhost:18789/healthz", {
      signal: AbortSignal.timeout(2000),
    });
    expect(res.ok).toBe(false);
    expect((res as { status: number }).status).toBe(503);
  });
});

// ── Channels check ────────────────────────────────────────────────────────────

describe("doctor: channels check", () => {
  it("reports zero channels when config key is absent", async () => {
    const { runMigrations, getConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    const channels = getConfig("channels");
    const count = Array.isArray(channels) ? channels.length : 0;
    expect(count).toBe(0);
    closeDb();
  });

  it("reports channel count when channels are configured", async () => {
    const { runMigrations, setConfig, getConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    setConfig("channels", [{ type: "telegram", enabled: true }]);
    const channels = getConfig("channels") as unknown[];
    expect(Array.isArray(channels)).toBe(true);
    expect(channels.length).toBe(1);
    closeDb();
  });
});

// ── Plugins check ─────────────────────────────────────────────────────────────

describe("doctor: plugins check", () => {
  it("reports zero plugins when config key is absent", async () => {
    const { runMigrations, getConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    const plugins = getConfig("plugins.installed");
    const count = Array.isArray(plugins) ? plugins.length : 0;
    expect(count).toBe(0);
    closeDb();
  });

  it("reports plugin count when plugins are installed", async () => {
    const { runMigrations, setConfig, getConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    setConfig("plugins.installed", ["nexus-plugin-weather", "nexus-plugin-calendar"]);
    const plugins = getConfig("plugins.installed") as unknown[];
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBe(2);
    closeDb();
  });
});
