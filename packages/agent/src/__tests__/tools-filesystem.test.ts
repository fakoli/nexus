/**
 * Tests for tools/filesystem.ts
 * Covers: read_file, write_file, list_directory
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), `nexus-test-fs-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations } from "@nexus/core";
import { registerFilesystemTools } from "../tools/filesystem.js";
import { executeTool, getRegisteredTools } from "../tool-executor.js";

// Workspace dir for file operations during tests
const workspaceDir = path.join(os.tmpdir(), `nexus-fs-workspace-${process.pid}`);

describe("tools/filesystem", () => {
  beforeEach(() => {
    runMigrations();
    registerFilesystemTools();
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe("read_file", () => {
    it("reads an existing file and returns its content", async () => {
      const filePath = path.join(workspaceDir, "hello.txt");
      fs.writeFileSync(filePath, "Hello, world!", "utf-8");

      const result = await executeTool({ id: "r1", name: "read_file", input: { path: filePath } });
      expect(result).toBe("Hello, world!");
    });

    it("returns error JSON for a nonexistent file", async () => {
      const filePath = path.join(workspaceDir, "does-not-exist.txt");

      const result = await executeTool({ id: "r2", name: "read_file", input: { path: filePath } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/not found/i);
    });

    it("returns error JSON for a relative path", async () => {
      const result = await executeTool({ id: "r3", name: "read_file", input: { path: "relative/path.txt" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/absolute/i);
    });

    it("returns error JSON when path is a directory", async () => {
      const result = await executeTool({ id: "r4", name: "read_file", input: { path: workspaceDir } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/directory/i);
    });

    it("returns error JSON for files larger than 1MB", async () => {
      const filePath = path.join(workspaceDir, "big.bin");
      // Write 1MB + 1 byte
      const buf = Buffer.alloc(1_000_001, "x");
      fs.writeFileSync(filePath, buf);

      const result = await executeTool({ id: "r5", name: "read_file", input: { path: filePath } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/too large/i);
    });
  });

  describe("write_file", () => {
    it("writes content to a new file", async () => {
      const filePath = path.join(workspaceDir, "output.txt");

      const result = await executeTool({
        id: "w1",
        name: "write_file",
        input: { path: filePath, content: "written content" },
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("written content");
    });

    it("creates intermediate directories", async () => {
      const filePath = path.join(workspaceDir, "deep", "nested", "dir", "file.txt");

      const result = await executeTool({
        id: "w2",
        name: "write_file",
        input: { path: filePath, content: "nested" },
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("reports the correct byte count in the response", async () => {
      const filePath = path.join(workspaceDir, "size-check.txt");
      const content = "abc"; // 3 bytes

      const result = await executeTool({
        id: "w3",
        name: "write_file",
        input: { path: filePath, content },
      });

      const parsed = JSON.parse(result);
      expect(parsed.bytes).toBe(3);
    });

    it("returns error JSON for a relative path", async () => {
      const result = await executeTool({
        id: "w4",
        name: "write_file",
        input: { path: "relative/file.txt", content: "data" },
      });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/absolute/i);
    });

    it("overwrites an existing file", async () => {
      const filePath = path.join(workspaceDir, "overwrite.txt");
      fs.writeFileSync(filePath, "old content", "utf-8");

      await executeTool({
        id: "w5",
        name: "write_file",
        input: { path: filePath, content: "new content" },
      });

      expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
    });
  });

  describe("list_directory", () => {
    it("lists files in a directory", async () => {
      fs.writeFileSync(path.join(workspaceDir, "a.txt"), "");
      fs.writeFileSync(path.join(workspaceDir, "b.txt"), "");

      const result = await executeTool({ id: "l1", name: "list_directory", input: { path: workspaceDir } });
      const items = JSON.parse(result) as Array<{ name: string; type: string }>;
      const names = items.map((i) => i.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
    });

    it("distinguishes files from directories", async () => {
      fs.writeFileSync(path.join(workspaceDir, "file.txt"), "");
      fs.mkdirSync(path.join(workspaceDir, "subdir"));

      const result = await executeTool({ id: "l2", name: "list_directory", input: { path: workspaceDir } });
      const items = JSON.parse(result) as Array<{ name: string; type: string }>;

      const fileEntry = items.find((i) => i.name === "file.txt");
      const dirEntry = items.find((i) => i.name === "subdir");
      expect(fileEntry?.type).toBe("file");
      expect(dirEntry?.type).toBe("directory");
    });

    it("returns error JSON for a nonexistent directory", async () => {
      const result = await executeTool({
        id: "l3",
        name: "list_directory",
        input: { path: path.join(workspaceDir, "no-such-dir") },
      });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/not found/i);
    });

    it("returns error JSON for a relative path", async () => {
      const result = await executeTool({ id: "l4", name: "list_directory", input: { path: "relative/dir" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/absolute/i);
    });
  });
});
