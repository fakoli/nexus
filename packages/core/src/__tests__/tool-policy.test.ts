import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-tool-policy-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  return db;
}

describe("tool-policy: checkToolPolicy", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows any tool when no policy is set", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-no-policy", {});
    const result = checkToolPolicy("agent-no-policy", "bash");
    expect(result.allowed).toBe(true);
  });

  it("returns not-allowed for unknown agent", async () => {
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    const result = checkToolPolicy("ghost-agent", "bash");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it("deny list blocks a specific tool", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-deny", { toolPolicy: { deny: ["bash"] } });
    const result = checkToolPolicy("agent-deny", "bash");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/bash/);
  });

  it("deny list blocks with wildcard pattern", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-deny-wild", { toolPolicy: { deny: ["bash*"] } });
    expect(checkToolPolicy("agent-deny-wild", "bash").allowed).toBe(false);
    expect(checkToolPolicy("agent-deny-wild", "bash_extra").allowed).toBe(false);
  });

  it("allow list permits matching tool", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-allow", { toolPolicy: { allow: ["read_file", "list_directory"] } });
    expect(checkToolPolicy("agent-allow", "read_file").allowed).toBe(true);
  });

  it("allow list blocks non-matching tool", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-allow-strict", { toolPolicy: { allow: ["read_file"] } });
    const result = checkToolPolicy("agent-allow-strict", "bash");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allow list/i);
  });

  it("deny takes precedence over allow", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-conflict", {
      toolPolicy: { allow: ["bash"], deny: ["bash"] },
    });
    const result = checkToolPolicy("agent-conflict", "bash");
    expect(result.allowed).toBe(false);
  });

  it("wildcard * in allow list permits everything", async () => {
    const { createAgent } = await import("../agents.js");
    const { checkToolPolicy } = await import("../security/tool-policy.js");
    createAgent("agent-allow-all", { toolPolicy: { allow: ["*"] } });
    expect(checkToolPolicy("agent-allow-all", "bash").allowed).toBe(true);
    expect(checkToolPolicy("agent-allow-all", "write_file").allowed).toBe(true);
  });
});

describe("tool-policy: matchGlob", () => {
  it("exact match works", async () => {
    const { matchGlob } = await import("../security/tool-policy.js");
    expect(matchGlob("bash", "bash")).toBe(true);
    expect(matchGlob("bash", "bash2")).toBe(false);
  });

  it("* matches everything", async () => {
    const { matchGlob } = await import("../security/tool-policy.js");
    expect(matchGlob("*", "anything")).toBe(true);
    expect(matchGlob("*", "")).toBe(true);
  });

  it("prefix wildcard bash* matches bash-prefixed names", async () => {
    const { matchGlob } = await import("../security/tool-policy.js");
    expect(matchGlob("bash*", "bash")).toBe(true);
    expect(matchGlob("bash*", "bash_exec")).toBe(true);
    expect(matchGlob("bash*", "read_file")).toBe(false);
  });

  it("suffix wildcard *_file matches file-suffixed names", async () => {
    const { matchGlob } = await import("../security/tool-policy.js");
    expect(matchGlob("*_file", "read_file")).toBe(true);
    expect(matchGlob("*_file", "write_file")).toBe(true);
    expect(matchGlob("*_file", "bash")).toBe(false);
  });
});
