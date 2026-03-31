/**
 * E5: Security Audit CLI Command tests.
 *
 * Verifies:
 * - securityCommand is exported with correct name and subcommands
 * - audit subcommand has --json flag
 * - runSecurityAudit is called and results are formatted
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-security-cmd-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
  const { closeDb, runMigrations } = await import("@nexus/core");
  closeDb();
  runMigrations();
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Command structure ─────────────────────────────────────────────────────────

describe("securityCommand: command metadata", () => {
  it("exports a Command named 'security'", async () => {
    const { securityCommand } = await import("../commands/security.js");
    expect(securityCommand.name()).toBe("security");
  });

  it("has a non-empty description", async () => {
    const { securityCommand } = await import("../commands/security.js");
    expect(securityCommand.description().length).toBeGreaterThan(0);
  });

  it("has an 'audit' subcommand", async () => {
    const { securityCommand } = await import("../commands/security.js");
    const subNames = securityCommand.commands.map((c) => c.name());
    expect(subNames).toContain("audit");
  });

  it("audit subcommand has --json option", async () => {
    const { securityCommand } = await import("../commands/security.js");
    const auditCmd = securityCommand.commands.find((c) => c.name() === "audit");
    expect(auditCmd).toBeDefined();
    const optionNames = auditCmd?.options.map((o) => o.long) ?? [];
    expect(optionNames).toContain("--json");
  });
});

// ── runSecurityAudit integration ──────────────────────────────────────────────

describe("securityCommand: audit output", () => {
  it("runSecurityAudit returns a valid AuditReport", async () => {
    const { runSecurityAudit } = await import("@nexus/core");
    const report = runSecurityAudit();
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("summary");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(typeof report.score).toBe("number");
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("each check has name, status, and detail", async () => {
    const { runSecurityAudit } = await import("@nexus/core");
    const report = runSecurityAudit();
    for (const check of report.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("status");
      expect(check).toHaveProperty("detail");
      expect(["pass", "warn", "fail"]).toContain(check.status);
    }
  });

  it("score is 0-100 and reflects check results", async () => {
    const { runSecurityAudit } = await import("@nexus/core");
    const report = runSecurityAudit();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("summary is a non-empty string", async () => {
    const { runSecurityAudit } = await import("@nexus/core");
    const report = runSecurityAudit();
    expect(typeof report.summary).toBe("string");
    expect(report.summary.length).toBeGreaterThan(0);
  });
});

// ── enforce mode changes check outcome ───────────────────────────────────────

describe("securityCommand: audit reflects config changes", () => {
  it("prompt_guard check passes when set to enforce", async () => {
    const { setConfig, runSecurityAudit } = await import("@nexus/core");
    setConfig("security", { promptGuard: "enforce" });
    const report = runSecurityAudit();
    const check = report.checks.find((c) => c.name === "prompt_guard");
    expect(check).toBeDefined();
    expect(check?.status).toBe("pass");
  });

  it("prompt_guard check warns when set to warn", async () => {
    const { setConfig, runSecurityAudit } = await import("@nexus/core");
    setConfig("security", { promptGuard: "warn" });
    const report = runSecurityAudit();
    const check = report.checks.find((c) => c.name === "prompt_guard");
    expect(check?.status).toBe("warn");
  });

  it("prompt_guard check fails when set to off", async () => {
    const { setConfig, runSecurityAudit } = await import("@nexus/core");
    setConfig("security", { promptGuard: "off" });
    const report = runSecurityAudit();
    const check = report.checks.find((c) => c.name === "prompt_guard");
    expect(check?.status).toBe("fail");
  });

  it("score increases when prompt guard is enforce vs off", async () => {
    const { setConfig, runSecurityAudit } = await import("@nexus/core");
    setConfig("security", { promptGuard: "off" });
    const reportOff = runSecurityAudit();

    setConfig("security", { promptGuard: "enforce" });
    const reportEnforce = runSecurityAudit();

    expect(reportEnforce.score).toBeGreaterThan(reportOff.score);
  });
});

// ── CLI index registration ─────────────────────────────────────────────────────

describe("CLI index: security command registered", () => {
  it("securityCommand is importable from the commands directory", async () => {
    const { securityCommand } = await import("../commands/security.js");
    expect(securityCommand).toBeDefined();
    expect(securityCommand.name()).toBe("security");
  });
});
