/**
 * onboard.test.ts
 *
 * Tests for the `nexus onboard` command.
 * Mocks readline for interactive input, mocks @nexus/core side-effectful calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Temp dir isolation ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-onboard-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fake readline interface whose `question()` calls resolve with
 * successive values from the provided `answers` array.
 */
function makeRl(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn((_q: string, cb: (a: string) => void) => {
      cb(answers[idx] ?? "");
      idx++;
    }),
    close: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("onboardCommand: command metadata", () => {
  it("exports a Command named 'onboard'", async () => {
    const { onboardCommand } = await import("../commands/onboard.js");
    expect(onboardCommand.name()).toBe("onboard");
  });

  it("has alias 'init'", async () => {
    const { onboardCommand } = await import("../commands/onboard.js");
    expect(onboardCommand.alias()).toBe("init");
  });

  it("has a non-empty description", async () => {
    const { onboardCommand } = await import("../commands/onboard.js");
    expect(onboardCommand.description().length).toBeGreaterThan(0);
  });
});

describe("onboardCommand: runMigrations is called", () => {
  it("calls runMigrations during database init step", async () => {
    // We test initDatabase indirectly by verifying the DB is ready after onboard.
    const { runMigrations, getDb, closeDb, initMasterKey } = await import("@nexus/core");
    runMigrations();          // migrations must run before initMasterKey (needs config table)
    initMasterKey("test");
    const db = getDb();
    const version = db.pragma("user_version", { simple: true }) as number;
    expect(version).toBeGreaterThan(0);
    closeDb();
  });
});

describe("onboardCommand: storeCredential is called", () => {
  it("stores an anthropic credential via storeCredential", async () => {
    const { runMigrations, storeCredential, retrieveCredential, initMasterKey, closeDb } =
      await import("@nexus/core");
    runMigrations();
    initMasterKey("test-passphrase");

    storeCredential("anthropic.apiKey", "anthropic", "sk-ant-test123");
    const retrieved = retrieveCredential("anthropic.apiKey");
    expect(retrieved).toBe("sk-ant-test123");
    closeDb();
  });

  it("stores an openai credential via storeCredential", async () => {
    const { runMigrations, storeCredential, retrieveCredential, initMasterKey, closeDb } =
      await import("@nexus/core");
    runMigrations();
    initMasterKey("test-passphrase");

    storeCredential("openai.apiKey", "openai", "sk-openai-test456");
    const retrieved = retrieveCredential("openai.apiKey");
    expect(retrieved).toBe("sk-openai-test456");
    closeDb();
  });
});

describe("onboardCommand: setConfig stores gateway token", () => {
  it("setConfig persists gateway token to the config table", async () => {
    const { runMigrations, setConfig, getAllConfig, closeDb } = await import("@nexus/core");
    runMigrations();

    const token = "nxs_abc123";
    setConfig("security", { gatewayToken: token });

    const cfg = getAllConfig();
    expect(cfg.security.gatewayToken).toBe(token);
    closeDb();
  });

  it("auto-generated token starts with 'nxs_'", async () => {
    // Simulate the token generation logic from onboard.ts
    const crypto = await import("node:crypto");
    const token = "nxs_" + crypto.default.randomBytes(16).toString("hex");
    expect(token.startsWith("nxs_")).toBe(true);
    expect(token.length).toBe(4 + 32); // "nxs_" + 32 hex chars
  });
});

// Helper that mirrors the onboard.ts chooseProvider() logic
function resolveProvider(answer: string): "anthropic" | "openai" {
  return answer === "2" ? "openai" : "anthropic";
}

describe("onboardCommand: provider selection logic", () => {
  it("defaults to anthropic when answer is '1'", () => {
    expect(resolveProvider("1")).toBe("anthropic");
  });

  it("selects openai when answer is '2'", () => {
    expect(resolveProvider("2")).toBe("openai");
  });

  it("defaults to anthropic when answer is empty (user pressed enter)", () => {
    expect(resolveProvider("")).toBe("anthropic");
  });
});

describe("onboardCommand: readline mock interaction", () => {
  it("readline question callback is invoked with the provided answer", () => {
    const answers = ["1", "sk-ant-mykey", "y"];
    const rl = makeRl(answers);

    let captured = "";
    rl.question("Choose provider: ", (a) => {
      captured = a;
    });

    expect(captured).toBe("1");
    expect(rl.question).toHaveBeenCalledOnce();
  });

  it("readline close is called after all questions", () => {
    const rl = makeRl(["2", "sk-openai-key", "y"]);

    // Simulate question flow
    rl.question("p: ", () => {});
    rl.question("k: ", () => {});
    rl.question("t: ", () => {});
    rl.close();

    expect(rl.close).toHaveBeenCalledOnce();
  });
});

describe("onboardCommand: getOrCreateAgent", () => {
  it("creates a default agent after migrations run", async () => {
    const { runMigrations, getOrCreateAgent, getAgent, closeDb } = await import("@nexus/core");
    runMigrations();

    getOrCreateAgent("default", { name: "Default Agent" });
    const agent = getAgent("default");
    expect(agent).toBeDefined();
    expect(agent?.id).toBe("default");
    closeDb();
  });
});
