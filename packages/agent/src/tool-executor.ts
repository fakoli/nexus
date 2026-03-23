/**
 * Tool executor — runs tool calls and returns results.
 *
 * Dispatches to registered tool handlers. Each tool is a simple function.
 * This replaces OpenClaw's scattered tool instantiation in attempt.ts.
 */
import { createLogger, recordAudit, checkToolPolicy } from "@nexus/core";
import type { ToolCall, ToolDefinition } from "./providers/base.js";

const log = createLogger("agent:tools");

export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

const registry = new Map<string, ToolHandler>();

export function registerTool(tool: ToolHandler): void {
  registry.set(tool.name, tool);
  log.debug({ tool: tool.name }, "Tool registered");
}

export function getRegisteredTools(): ToolHandler[] {
  return Array.from(registry.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  return getRegisteredTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function executeTool(
  call: ToolCall,
  agentId?: string,
): Promise<string> {
  // Policy check — runs only when an agentId is available
  if (agentId) {
    const policy = checkToolPolicy(agentId, call.name);
    if (!policy.allowed) {
      log.warn({ tool: call.name, agentId, reason: policy.reason }, "Tool blocked by policy");
      return JSON.stringify({
        error: `Tool "${call.name}" blocked by policy: ${policy.reason}`,
      });
    }
  }

  const handler = registry.get(call.name);
  if (!handler) {
    log.warn({ tool: call.name }, "Unknown tool");
    return JSON.stringify({ error: `Unknown tool: ${call.name}` });
  }

  log.info({ tool: call.name, id: call.id }, "Executing tool");
  recordAudit("tool_execution", "agent", { tool: call.name, input: call.input });

  try {
    const result = await handler.execute(call.input);
    log.info({ tool: call.name, resultLength: result.length }, "Tool completed");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ tool: call.name, error: message }, "Tool failed");
    return JSON.stringify({ error: message });
  }
}
