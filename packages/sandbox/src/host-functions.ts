/**
 * Host function bridge — exposes core capabilities to sandboxed agent code.
 *
 * Each host function validates its input with Zod before use and enforces
 * capability checks. Tool execution stubs are returned here; real dispatch
 * can be wired later through the options.
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import { isToolAllowed } from "./capabilities.js";
import type { AgentCapabilities } from "./capabilities.js";
import type { HostFunction } from "./runtime.js";

// ── Input schemas ───────────────────────────────────────────────────

const ToolExecuteInputSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

const MemorySearchInputSchema = z.object({
  query: z.string(),
  scope: z.string().optional(),
  limit: z.number().optional(),
});

const LogInputSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});

// ── Host function factory ───────────────────────────────────────────

export interface HostFunctionOptions {
  capabilities: AgentCapabilities;
  agentId: string;
  sessionId: string;
  /**
   * Optional real tool executor. When provided, tool_execute will call it
   * instead of returning a stub.
   */
  toolExecutor?: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export function createHostFunctions(options: HostFunctionOptions): Map<string, HostFunction> {
  const { capabilities, agentId, sessionId, toolExecutor } = options;
  const log = createLogger(`sandbox:host:${agentId}`);
  const functions = new Map<string, HostFunction>();

  // tool_execute — dispatch a named tool with capability check
  functions.set("tool_execute", async (input: string) => {
    const raw: unknown = (() => {
      try { return JSON.parse(input); } catch { return null; }
    })();
    const parsed = ToolExecuteInputSchema.safeParse(raw);
    if (!parsed.success) {
      return JSON.stringify({ error: `Invalid tool_execute input: ${parsed.error.message}` });
    }

    const { name, input: toolInput } = parsed.data;

    if (!isToolAllowed(capabilities, name)) {
      log.warn({ agentId, tool: name }, "Tool blocked by sandbox capability");
      return JSON.stringify({ error: `Tool "${name}" is not permitted by sandbox capabilities` });
    }

    log.info({ agentId, sessionId, tool: name }, "Sandbox tool_execute");

    if (toolExecutor) {
      try {
        const result = await toolExecutor(name, toolInput);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    // Stub — real executor not wired yet
    return JSON.stringify({ result: `[stub] tool ${name} executed`, toolName: name });
  });

  // memory_search — search the agent's memory store
  functions.set("memory_search", async (input: string) => {
    const raw: unknown = (() => {
      try { return JSON.parse(input); } catch { return null; }
    })();
    const parsed = MemorySearchInputSchema.safeParse(raw);
    if (!parsed.success) {
      return JSON.stringify({ error: `Invalid memory_search input: ${parsed.error.message}` });
    }

    const { query, scope, limit } = parsed.data;
    log.debug({ agentId, sessionId, query, scope, limit }, "Sandbox memory_search");

    // Stub implementation — real memory integration can be wired later
    return JSON.stringify({ results: [], query, scope });
  });

  // log — emit structured log from guest code
  functions.set("log", async (input: string) => {
    const raw: unknown = (() => {
      try { return JSON.parse(input); } catch { return null; }
    })();
    const parsed = LogInputSchema.safeParse(raw);
    if (!parsed.success) {
      return JSON.stringify({ error: `Invalid log input: ${parsed.error.message}` });
    }

    const { level, message } = parsed.data;
    log[level]({ agentId, sessionId }, `[guest] ${message}`);
    return JSON.stringify({ ok: true });
  });

  return functions;
}
