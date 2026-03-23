import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-webfetch-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("@nexus/core");
  db.closeDb();
  db.runMigrations();
  return db;
}

describe("web_fetch tool", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("@nexus/core");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers the web_fetch tool", async () => {
    const { registerWebFetchTool, getRegisteredTools } = await import("../index.js");
    registerWebFetchTool();
    const tools = getRegisteredTools();
    const webFetch = tools.find((t) => t.name === "web_fetch");
    expect(webFetch).toBeDefined();
    expect(webFetch?.name).toBe("web_fetch");
  });

  it("has correct parameter schema", async () => {
    const { registerWebFetchTool, getToolDefinitions } = await import("../index.js");
    registerWebFetchTool();
    const defs = getToolDefinitions();
    const webFetch = defs.find((d) => d.name === "web_fetch");
    expect(webFetch).toBeDefined();
    expect(webFetch?.parameters.properties).toHaveProperty("url");
    expect(webFetch?.parameters.required).toContain("url");
  });

  it("blocks internal URLs via SSRF guard", async () => {
    const { registerWebFetchTool, executeTool } = await import("../index.js");
    registerWebFetchTool();
    const result = await executeTool({
      id: "test-1",
      name: "web_fetch",
      input: { url: "http://127.0.0.1/secret" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/blocked/i);
  });

  it("blocks localhost via SSRF guard", async () => {
    const { registerWebFetchTool, executeTool } = await import("../index.js");
    registerWebFetchTool();
    const result = await executeTool({
      id: "test-2",
      name: "web_fetch",
      input: { url: "http://localhost:8080/api" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/blocked/i);
  });

  it("blocks metadata endpoint via SSRF guard", async () => {
    const { registerWebFetchTool, executeTool } = await import("../index.js");
    registerWebFetchTool();
    const result = await executeTool({
      id: "test-3",
      name: "web_fetch",
      input: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/blocked/i);
  });

  it("blocks file:// scheme via SSRF guard", async () => {
    const { registerWebFetchTool, executeTool } = await import("../index.js");
    registerWebFetchTool();
    const result = await executeTool({
      id: "test-4",
      name: "web_fetch",
      input: { url: "file:///etc/passwd" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/blocked/i);
  });

  it("blocks private network 10.x.x.x via SSRF guard", async () => {
    const { registerWebFetchTool, executeTool } = await import("../index.js");
    registerWebFetchTool();
    const result = await executeTool({
      id: "test-5",
      name: "web_fetch",
      input: { url: "http://10.0.0.1/internal" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/blocked/i);
  });
});
