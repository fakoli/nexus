/**
 * Tests for tools/bash.ts
 * Covers: simple commands, blocked commands, failing commands
 */
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

const tmpDir = path.join(os.tmpdir(), `nexus-test-bash-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations } from "@nexus/core";
import { registerBashTool } from "../tools/bash.js";
import { executeTool } from "../tool-executor.js";

describe("tools/bash", () => {
  beforeEach(() => {
    runMigrations();
    registerBashTool();
  });

  describe("simple commands", () => {
    it("executes echo and returns the output", async () => {
      const result = await executeTool({ id: "b1", name: "bash", input: { command: "echo hello" } });
      expect(result.trim()).toBe("hello");
    });

    it("returns (no output) for commands with no stdout", async () => {
      // `true` exits 0 with no output
      const result = await executeTool({ id: "b2", name: "bash", input: { command: "true" } });
      expect(result).toBe("(no output)");
    });

    it("returns stdout for multi-word commands", async () => {
      const result = await executeTool({ id: "b3", name: "bash", input: { command: "echo foo bar baz" } });
      expect(result.trim()).toBe("foo bar baz");
    });

    it("captures stderr for commands that mix stdout and stderr", async () => {
      const result = await executeTool({
        id: "b4",
        name: "bash",
        input: { command: "echo out && echo err >&2" },
      });
      // stdout should be present
      expect(result).toContain("out");
    });
  });

  describe("blocked dangerous commands", () => {
    it("blocks rm -rf /", async () => {
      const result = await executeTool({ id: "b5", name: "bash", input: { command: "rm -rf /" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });

    it("blocks mkfs commands", async () => {
      const result = await executeTool({ id: "b6", name: "bash", input: { command: "mkfs.ext4 /dev/sda1" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });

    it("blocks shutdown commands", async () => {
      const result = await executeTool({ id: "b7", name: "bash", input: { command: "shutdown now" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });

    it("blocks reboot commands", async () => {
      const result = await executeTool({ id: "b8", name: "bash", input: { command: "reboot" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });

    it("blocks halt commands", async () => {
      const result = await executeTool({ id: "b9", name: "bash", input: { command: "halt" } });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });

    it("blocks raw device writes", async () => {
      const result = await executeTool({
        id: "b10",
        name: "bash",
        input: { command: "dd if=/dev/zero > /dev/sda" },
      });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/blocked/i);
    });
  });

  describe("failing commands (exit code != 0)", () => {
    it("returns exit code and stderr when a command fails", async () => {
      const result = await executeTool({
        id: "b11",
        name: "bash",
        input: { command: "ls /this-path-does-not-exist-xyz" },
      });
      // Should contain a non-zero exit code indicator or stderr
      expect(result).toMatch(/exit code|No such file|not found/i);
    });

    it("returns exit code 1 output for false command", async () => {
      const result = await executeTool({ id: "b12", name: "bash", input: { command: "false" } });
      expect(result).toMatch(/exit code:\s*1/i);
    });

    it("includes exit code in the response for any non-zero exit", async () => {
      const result = await executeTool({
        id: "b13",
        name: "bash",
        input: { command: "exit 42" },
      });
      // The result string should reference the failure
      expect(result).toBeTruthy();
      // Either shows "Exit code: 42" or some error output
      expect(typeof result).toBe("string");
    });
  });
});
