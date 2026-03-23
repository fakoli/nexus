/**
 * Tests for the slash command framework.
 *
 * Covers: registration, dispatch, all command categories, edge cases.
 */
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

// Must set data dir before any DB-touching imports
const tmpDir = path.join(os.tmpdir(), `nexus-test-commands-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations, createSession, createAgent, setConfig, getConfig } from "@nexus/core";
import {
  registerCommand,
  getCommands,
  executeSlashCommand,
} from "../commands/index.js";
import type { CommandContext } from "../commands/registry.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    sessionId: "test-session",
    agentId: "default",
    setConfig: (key, value) => setConfig(key, value),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  runMigrations();
  try { createAgent("default"); } catch { /* already exists */ }
  try { createSession("test-session", "default"); } catch { /* already exists */ }
});

// ── Registration ──────────────────────────────────────────────────────

describe("registerCommand", () => {
  it("registers a custom command and makes it available via getCommands", () => {
    registerCommand({
      name: "test_custom_cmd",
      category: "test",
      description: "A test command",
      handler: async () => "custom result",
    });
    const names = getCommands().map((c) => c.name);
    expect(names).toContain("test_custom_cmd");
  });

  it("registers aliases that also resolve to the same command", async () => {
    registerCommand({
      name: "test_aliased",
      aliases: ["ta"],
      category: "test",
      description: "Aliased command",
      handler: async () => "aliased",
    });
    const result = await executeSlashCommand("/ta", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe("aliased");
  });

  it("getCommands deduplicates — aliases do not appear as separate entries", () => {
    registerCommand({
      name: "test_dedup",
      aliases: ["td1", "td2"],
      category: "test",
      description: "Dedup test",
      handler: async () => "ok",
    });
    const cmds = getCommands();
    const matches = cmds.filter((c) => c.name === "test_dedup");
    expect(matches.length).toBe(1);
  });
});

// ── executeSlashCommand dispatch ──────────────────────────────────────

describe("executeSlashCommand", () => {
  it("returns handled:false for non-slash input", async () => {
    const result = await executeSlashCommand("hello world", makeCtx());
    expect(result.handled).toBe(false);
    expect(result.response).toBeUndefined();
  });

  it("returns handled:false for unknown command", async () => {
    const result = await executeSlashCommand("/totally_unknown_xyz", makeCtx());
    expect(result.handled).toBe(false);
  });

  it("returns handled:false for bare slash with no name", async () => {
    const result = await executeSlashCommand("/", makeCtx());
    expect(result.handled).toBe(false);
  });

  it("parses args correctly and passes them to handler", async () => {
    registerCommand({
      name: "test_echo_args",
      category: "test",
      description: "Echo args",
      handler: async (args) => `got: ${args}`,
    });
    const result = await executeSlashCommand("/test_echo_args hello world", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe("got: hello world");
  });

  it("wraps handler errors in a user-facing error response", async () => {
    registerCommand({
      name: "test_throws",
      category: "test",
      description: "Always throws",
      handler: async () => { throw new Error("boom"); },
    });
    const result = await executeSlashCommand("/test_throws", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toMatch(/Error: boom/);
  });
});

// ── /help ─────────────────────────────────────────────────────────────

describe("/help", () => {
  it("returns a non-empty string listing commands", async () => {
    const result = await executeSlashCommand("/help", makeCtx());
    expect(result.handled).toBe(true);
    expect(typeof result.response).toBe("string");
    expect(result.response?.length).toBeGreaterThan(0);
  });

  it("includes 'session' category in help output", async () => {
    const result = await executeSlashCommand("/help", makeCtx());
    expect(result.response).toContain("session");
  });

  it("includes /model in help output", async () => {
    const result = await executeSlashCommand("/help", makeCtx());
    expect(result.response).toContain("/model");
  });
});

// ── /model ────────────────────────────────────────────────────────────

describe("/model", () => {
  it("switches the model and reports back", async () => {
    const configChanges: Array<{ key: string; value: unknown }> = [];
    const ctx = makeCtx({
      setConfig: (key, value) => {
        configChanges.push({ key, value });
        setConfig(key, value);
      },
    });
    const result = await executeSlashCommand("/model claude-opus-4", ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("claude-opus-4");
    expect(configChanges.some((c) => c.value === "claude-opus-4")).toBe(true);
  });

  it("shows current model when no arg given", async () => {
    const result = await executeSlashCommand("/model", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Current model");
  });
});

// ── /status ───────────────────────────────────────────────────────────

describe("/status", () => {
  it("returns session and gateway info", async () => {
    const result = await executeSlashCommand("/status", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("test-session");
    expect(result.response).toContain("default");
    expect(result.response).toContain("Gateway");
  });
});

// ── /config ───────────────────────────────────────────────────────────

describe("/config", () => {
  it("returns full config when called with no args", async () => {
    const result = await executeSlashCommand("/config", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("gateway");
  });

  it("returns a specific key value", async () => {
    setConfig("testkey", "testval");
    const result = await executeSlashCommand("/config testkey", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("testkey");
    expect(result.response).toContain("testval");
  });

  it("sets a config key and reports back", async () => {
    const result = await executeSlashCommand('/config mykey myvalue', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("mykey");
    const stored = getConfig("mykey");
    expect(stored).toBe("myvalue");
  });

  it("parses JSON values when setting config", async () => {
    const result = await executeSlashCommand("/config jsonkey 42", makeCtx());
    expect(result.handled).toBe(true);
    const stored = getConfig("jsonkey");
    expect(stored).toBe(42);
  });
});

// ── /version ──────────────────────────────────────────────────────────

describe("/version", () => {
  it("returns version string", async () => {
    const result = await executeSlashCommand("/version", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Nexus");
  });
});

// ── /think ────────────────────────────────────────────────────────────

describe("/think", () => {
  it("sets think level to high", async () => {
    const changes: Array<{ key: string; value: unknown }> = [];
    const ctx = makeCtx({ setConfig: (k, v) => { changes.push({ key: k, value: v }); setConfig(k, v); } });
    const result = await executeSlashCommand("/think high", ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("high");
    expect(changes.some((c) => c.value === "high")).toBe(true);
  });

  it("rejects invalid think level", async () => {
    const result = await executeSlashCommand("/think turbo", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Usage");
  });
});

// ── /search ───────────────────────────────────────────────────────────

describe("/search", () => {
  it("returns usage hint when no query given", async () => {
    const result = await executeSlashCommand("/search", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Usage");
  });

  it("returns no-match message for non-existent content", async () => {
    const result = await executeSlashCommand("/search zzz_no_match_xyz", makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain("No messages matching");
  });
});
