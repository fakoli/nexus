/**
 * E2: Tool Policy Tightening tests.
 *
 * Verifies that:
 * - Allowed tools execute normally
 * - Denied tools return an error JSON
 * - Policy violations are logged to the audit trail
 */
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
  const { closeDb, runMigrations } = await import("@nexus/core");
  closeDb();
  runMigrations();
});

async function cleanup() {
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── Allowed tool execution ────────────────────────────────────────────────────

describe("tool policy: allowed tools execute normally", () => {
  it("executes a tool when no agentId is provided (no policy check)", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations } = await import("@nexus/core");
    runMigrations();

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "tp_echo_allowed",
      description: "Echo tool",
      parameters: {},
      execute: async (input) => `echo:${String(input.value ?? "")}`,
    });

    const result = await executeTool({ id: "call-1", name: "tp_echo_allowed", input: { value: "hello" } });
    expect(result).toBe("echo:hello");

    await cleanup();
  });

  it("executes a tool when agentId has no deny policy", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-allow-all", {});

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "tp_allowed_tool",
      description: "Allowed tool",
      parameters: {},
      execute: async () => "success",
    });

    const result = await executeTool(
      { id: "call-2", name: "tp_allowed_tool", input: {} },
      "agent-allow-all",
    );
    expect(result).toBe("success");

    await cleanup();
  });

  it("executes a tool matching the allow list", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-with-allow", { toolPolicy: { allow: ["tp_read*"] } });

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "tp_read_file",
      description: "Read file",
      parameters: {},
      execute: async () => "file content",
    });

    const result = await executeTool(
      { id: "call-3", name: "tp_read_file", input: {} },
      "agent-with-allow",
    );
    expect(result).toBe("file content");

    await cleanup();
  });
});

// ── Denied tools return error ─────────────────────────────────────────────────

describe("tool policy: denied tools return error JSON", () => {
  it("blocks a tool on the deny list", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-deny-bash", { toolPolicy: { deny: ["bash"] } });

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "bash",
      description: "Bash shell",
      parameters: {},
      execute: async () => "should not run",
    });

    const result = await executeTool(
      { id: "call-denied", name: "bash", input: {} },
      "agent-deny-bash",
    );
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toMatch(/blocked by policy/i);

    await cleanup();
  });

  it("blocks a tool not in the allow list", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-strict-allow", { toolPolicy: { allow: ["safe_tool"] } });

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "unsafe_tool",
      description: "Unsafe",
      parameters: {},
      execute: async () => "should not run",
    });

    const result = await executeTool(
      { id: "call-notallowed", name: "unsafe_tool", input: {} },
      "agent-strict-allow",
    );
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toMatch(/blocked by policy/i);

    await cleanup();
  });

  it("blocks wildcard-denied tools", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-deny-wildcard", { toolPolicy: { deny: ["bash*"] } });

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "bash_exec",
      description: "Bash exec variant",
      parameters: {},
      execute: async () => "should not run",
    });

    const result = await executeTool(
      { id: "call-wild", name: "bash_exec", input: {} },
      "agent-deny-wildcard",
    );
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed).toHaveProperty("error");

    await cleanup();
  });
});

// ── Policy violations logged to audit ─────────────────────────────────────────

describe("tool policy: violations are logged to audit trail", () => {
  it("records security:tool_policy_violation in audit log on denial", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent, queryAudit } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-audit-deny", { toolPolicy: { deny: ["dangerous_tool"] } });

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "dangerous_tool",
      description: "Should be denied",
      parameters: {},
      execute: async () => "should not run",
    });

    await executeTool(
      { id: "call-audit", name: "dangerous_tool", input: {} },
      "agent-audit-deny",
    );

    const entries = queryAudit("security:tool_policy_violation", 10);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    expect(entry?.eventType).toBe("security:tool_policy_violation");
    expect(entry?.actor).toBe("agent-audit-deny");
    expect(entry?.details?.tool).toBe("dangerous_tool");

    await cleanup();
  });

  it("does NOT record policy violation when tool is allowed", async () => {
    await cleanup().catch(() => undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nexus-tool-policy-agent-test-"));
    process.env.NEXUS_DATA_DIR = tmpDir;
    const { runMigrations, createAgent, queryAudit } = await import("@nexus/core");
    runMigrations();
    createAgent("agent-no-deny", {});

    const { registerTool, executeTool } = await import("../tool-executor.js");

    registerTool({
      name: "good_tool",
      description: "Allowed tool",
      parameters: {},
      execute: async () => "fine",
    });

    const countBefore = queryAudit("security:tool_policy_violation", 100).length;
    await executeTool(
      { id: "call-ok", name: "good_tool", input: {} },
      "agent-no-deny",
    );
    const countAfter = queryAudit("security:tool_policy_violation", 100).length;

    expect(countAfter).toBe(countBefore);

    await cleanup();
  });
});
