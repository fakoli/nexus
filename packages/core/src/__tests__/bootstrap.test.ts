/**
 * Tests for core/bootstrap.ts
 * Uses temp directories so tests never touch ~/.nexus.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function makeTmpHome(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-bootstrap-test-"));
}

describe("bootstrap: getBootstrapDir", () => {
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
    process.env.NEXUS_HOME = home;
  });

  afterEach(() => {
    delete process.env.NEXUS_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("returns global bootstrap dir when no agentId given", async () => {
    const { getBootstrapDir } = await import("../bootstrap.js");
    const dir = getBootstrapDir();
    expect(dir).toBe(path.join(home, "bootstrap"));
  });

  it("returns per-agent dir when agentId is given", async () => {
    const { getBootstrapDir } = await import("../bootstrap.js");
    const dir = getBootstrapDir("agent-42");
    expect(dir).toBe(path.join(home, "agents", "agent-42", "bootstrap"));
  });
});

describe("bootstrap: setBootstrapFile / getBootstrapFile", () => {
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
    process.env.NEXUS_HOME = home;
  });

  afterEach(() => {
    delete process.env.NEXUS_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("writes and reads a global bootstrap file", async () => {
    const { setBootstrapFile, getBootstrapFile } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "# Soul content");
    expect(getBootstrapFile("SOUL.md")).toBe("# Soul content");
  });

  it("writes and reads a per-agent bootstrap file", async () => {
    const { setBootstrapFile, getBootstrapFile } = await import("../bootstrap.js");
    setBootstrapFile("IDENTITY.md", "# Agent identity", "my-agent");
    expect(getBootstrapFile("IDENTITY.md", "my-agent")).toBe("# Agent identity");
  });

  it("returns null when file does not exist", async () => {
    const { getBootstrapFile } = await import("../bootstrap.js");
    expect(getBootstrapFile("SOUL.md")).toBeNull();
  });

  it("per-agent file shadows the global file", async () => {
    const { setBootstrapFile, getBootstrapFile } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "global soul");
    setBootstrapFile("SOUL.md", "agent soul", "my-agent");
    expect(getBootstrapFile("SOUL.md", "my-agent")).toBe("agent soul");
  });

  it("falls back to global when no per-agent file exists", async () => {
    const { setBootstrapFile, getBootstrapFile } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "global soul");
    expect(getBootstrapFile("SOUL.md", "other-agent")).toBe("global soul");
  });
});

describe("bootstrap: listBootstrapFiles", () => {
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
    process.env.NEXUS_HOME = home;
  });

  afterEach(() => {
    delete process.env.NEXUS_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("returns empty array when no files exist", async () => {
    const { listBootstrapFiles } = await import("../bootstrap.js");
    expect(listBootstrapFiles()).toEqual([]);
  });

  it("lists written global files", async () => {
    const { setBootstrapFile, listBootstrapFiles } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "soul");
    setBootstrapFile("USER.md", "user");
    const files = listBootstrapFiles();
    expect(files).toContain("SOUL.md");
    expect(files).toContain("USER.md");
  });

  it("merges global and per-agent files without duplicates", async () => {
    const { setBootstrapFile, listBootstrapFiles } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "global");
    setBootstrapFile("IDENTITY.md", "agent", "ag-1");
    const files = listBootstrapFiles("ag-1");
    expect(files).toContain("SOUL.md");
    expect(files).toContain("IDENTITY.md");
  });
});

describe("bootstrap: loadBootstrapContent", () => {
  let home: string;

  beforeEach(() => {
    home = makeTmpHome();
    process.env.NEXUS_HOME = home;
  });

  afterEach(() => {
    delete process.env.NEXUS_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("returns empty string when no files exist", async () => {
    const { loadBootstrapContent } = await import("../bootstrap.js");
    expect(loadBootstrapContent()).toBe("");
  });

  it("concatenates multiple files in canonical order", async () => {
    const { setBootstrapFile, loadBootstrapContent } = await import("../bootstrap.js");
    setBootstrapFile("SOUL.md", "soul text");
    setBootstrapFile("IDENTITY.md", "identity text");
    const content = loadBootstrapContent();
    const soulIdx = content.indexOf("soul text");
    const identIdx = content.indexOf("identity text");
    expect(soulIdx).toBeGreaterThanOrEqual(0);
    expect(identIdx).toBeGreaterThan(soulIdx);
  });
});

describe("bootstrap: BOOTSTRAP_FILES constant", () => {
  it("exports the five canonical file names", async () => {
    const { BOOTSTRAP_FILES } = await import("../bootstrap.js");
    expect(BOOTSTRAP_FILES).toContain("SOUL.md");
    expect(BOOTSTRAP_FILES).toContain("IDENTITY.md");
    expect(BOOTSTRAP_FILES).toContain("USER.md");
    expect(BOOTSTRAP_FILES).toContain("TOOLS.md");
    expect(BOOTSTRAP_FILES).toContain("AGENTS.md");
    expect(BOOTSTRAP_FILES).toHaveLength(5);
  });
});
