/**
 * Tests for tool-executor.ts
 * Covers: registerTool, getRegisteredTools, getToolDefinitions, executeTool
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// Set up temp data dir before any imports that touch the DB
const tmpDir = path.join(os.tmpdir(), `nexus-test-tool-exec-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations } from "@nexus/core";
import {
  registerTool,
  getRegisteredTools,
  getToolDefinitions,
  executeTool,
  type ToolHandler,
} from "../tool-executor.js";

// The registry is module-level state; we reset it between tests by re-importing
// is not straightforward without factory reset — instead we use unique names per test.

function makeTool(name: string, impl?: (input: Record<string, unknown>) => Promise<string>): ToolHandler {
  return {
    name,
    description: `Description for ${name}`,
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    execute: impl ?? (async (input) => `echo:${input.value}`),
  };
}

describe("tool-executor", () => {
  beforeEach(() => {
    runMigrations();
  });

  describe("registerTool", () => {
    it("registers a tool and makes it retrievable", () => {
      const tool = makeTool("te_register_1");
      registerTool(tool);
      const tools = getRegisteredTools();
      const found = tools.find((t) => t.name === "te_register_1");
      expect(found).toBeDefined();
      expect(found?.description).toBe("Description for te_register_1");
    });

    it("overwrites a tool when registered with the same name", () => {
      const toolV1 = makeTool("te_overwrite_1");
      const toolV2: ToolHandler = { ...makeTool("te_overwrite_1"), description: "Updated" };
      registerTool(toolV1);
      registerTool(toolV2);
      const found = getRegisteredTools().find((t) => t.name === "te_overwrite_1");
      expect(found?.description).toBe("Updated");
    });
  });

  describe("getRegisteredTools", () => {
    it("returns an array", () => {
      const tools = getRegisteredTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it("includes all registered tools", () => {
      registerTool(makeTool("te_list_a"));
      registerTool(makeTool("te_list_b"));
      const names = getRegisteredTools().map((t) => t.name);
      expect(names).toContain("te_list_a");
      expect(names).toContain("te_list_b");
    });
  });

  describe("getToolDefinitions", () => {
    it("returns only name, description, parameters (no execute fn)", () => {
      registerTool(makeTool("te_def_1"));
      const defs = getToolDefinitions();
      const def = defs.find((d) => d.name === "te_def_1");
      expect(def).toBeDefined();
      expect(def).toHaveProperty("name");
      expect(def).toHaveProperty("description");
      expect(def).toHaveProperty("parameters");
      expect((def as unknown as Record<string, unknown>).execute).toBeUndefined();
    });

    it("parameter shape matches the registered tool", () => {
      const tool = makeTool("te_def_shape");
      registerTool(tool);
      const defs = getToolDefinitions();
      const def = defs.find((d) => d.name === "te_def_shape");
      expect(def?.parameters).toEqual(tool.parameters);
    });
  });

  describe("executeTool", () => {
    it("calls the handler and returns its output", async () => {
      registerTool(makeTool("te_exec_ok", async (input) => `result:${input.value}`));
      const result = await executeTool({ id: "call-1", name: "te_exec_ok", input: { value: "hello" } });
      expect(result).toBe("result:hello");
    });

    it("returns error JSON for an unknown tool", async () => {
      const result = await executeTool({ id: "call-unknown", name: "no_such_tool_xyz", input: {} });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toMatch(/unknown tool/i);
    });

    it("catches handler throws and returns error JSON", async () => {
      registerTool(
        makeTool("te_exec_throws", async () => {
          throw new Error("handler blew up");
        }),
      );
      const result = await executeTool({ id: "call-throw", name: "te_exec_throws", input: {} });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toContain("handler blew up");
    });

    it("catches non-Error throws and returns error JSON", async () => {
      registerTool(
        makeTool("te_exec_string_throw", async () => {
          throw "string error";
        }),
      );
      const result = await executeTool({ id: "call-str", name: "te_exec_string_throw", input: {} });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toBe("string error");
    });
  });
});
