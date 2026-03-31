/**
 * Tests for RagConfigSchema and its integration into NexusConfigSchema.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-rag-config-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  return db;
}

// ── RagConfigSchema unit tests ────────────────────────────────────────────────

describe("RagConfigSchema: schema validation", () => {
  it("accepts empty object and applies all defaults", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(false);
    expect(result.data.embeddingProvider).toBe("ollama");
    expect(result.data.embeddingModel).toBe("nomic-embed-text");
    expect(result.data.topK).toBe(5);
    expect(result.data.similarityThreshold).toBe(0.7);
    expect(result.data.autoIndex).toBe(true);
  });

  it("accepts explicit valid values", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({
      enabled: true,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      topK: 10,
      similarityThreshold: 0.8,
      autoIndex: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.enabled).toBe(true);
    expect(result.data.embeddingProvider).toBe("openai");
    expect(result.data.embeddingModel).toBe("text-embedding-3-small");
    expect(result.data.topK).toBe(10);
    expect(result.data.similarityThreshold).toBe(0.8);
    expect(result.data.autoIndex).toBe(false);
  });

  it("rejects invalid embeddingProvider", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({ embeddingProvider: "cohere" });
    expect(result.success).toBe(false);
  });

  it("rejects topK below minimum (1)", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({ topK: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects topK above maximum (50)", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({ topK: 51 });
    expect(result.success).toBe(false);
  });

  it("accepts topK at boundary values (1 and 50)", async () => {
    const { RagConfigSchema } = await import("../config.js");
    expect(RagConfigSchema.safeParse({ topK: 1 }).success).toBe(true);
    expect(RagConfigSchema.safeParse({ topK: 50 }).success).toBe(true);
  });

  it("rejects similarityThreshold below 0", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({ similarityThreshold: -0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects similarityThreshold above 1", async () => {
    const { RagConfigSchema } = await import("../config.js");
    const result = RagConfigSchema.safeParse({ similarityThreshold: 1.1 });
    expect(result.success).toBe(false);
  });

  it("accepts similarityThreshold at boundary values (0 and 1)", async () => {
    const { RagConfigSchema } = await import("../config.js");
    expect(RagConfigSchema.safeParse({ similarityThreshold: 0 }).success).toBe(true);
    expect(RagConfigSchema.safeParse({ similarityThreshold: 1 }).success).toBe(true);
  });
});

// ── NexusConfigSchema integration tests ──────────────────────────────────────

describe("NexusConfigSchema: rag field", () => {
  it("includes rag field with defaults in NexusConfigSchema.parse({})", async () => {
    const { NexusConfigSchema } = await import("../config.js");
    const result = NexusConfigSchema.parse({});
    expect(result.rag).toBeDefined();
    expect(result.rag.enabled).toBe(false);
    expect(result.rag.embeddingProvider).toBe("ollama");
    expect(result.rag.topK).toBe(5);
  });

  it("accepts custom rag config within NexusConfigSchema", async () => {
    const { NexusConfigSchema } = await import("../config.js");
    const result = NexusConfigSchema.parse({ rag: { enabled: true, topK: 20 } });
    expect(result.rag.enabled).toBe(true);
    expect(result.rag.topK).toBe(20);
    // Other defaults still present
    expect(result.rag.embeddingProvider).toBe("ollama");
  });
});

// ── getAllConfig integration test ─────────────────────────────────────────────

describe("getAllConfig: rag section", () => {
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

  it("returns default rag config when nothing is set", async () => {
    const { getAllConfig } = await import("../config.js");
    const cfg = getAllConfig();
    expect(cfg.rag).toBeDefined();
    expect(cfg.rag.enabled).toBe(false);
    expect(cfg.rag.embeddingProvider).toBe("ollama");
    expect(cfg.rag.embeddingModel).toBe("nomic-embed-text");
    expect(cfg.rag.topK).toBe(5);
    expect(cfg.rag.similarityThreshold).toBe(0.7);
    expect(cfg.rag.autoIndex).toBe(true);
  });

  it("returns stored rag config when set via setConfig", async () => {
    const { getAllConfig, setConfig } = await import("../config.js");
    setConfig("rag", { enabled: true, topK: 15, embeddingProvider: "openai" });
    const cfg = getAllConfig();
    expect(cfg.rag.enabled).toBe(true);
    expect(cfg.rag.topK).toBe(15);
    expect(cfg.rag.embeddingProvider).toBe("openai");
    // Defaults still applied for unset fields
    expect(cfg.rag.embeddingModel).toBe("nomic-embed-text");
  });
});
