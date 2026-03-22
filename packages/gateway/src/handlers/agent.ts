/**
 * Agent RPC handler — triggers the agent runtime for a session.
 *
 * - agent.run — sends a user message and gets an AI response.
 */
import { z } from "zod";
import { createLogger, getSession } from "@nexus/core";
import { runAgent, registerFilesystemTools, registerBashTool } from "@nexus/agent";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:agent");

let toolsRegistered = false;

function ensureToolsRegistered(): void {
  if (toolsRegistered) return;
  registerFilesystemTools();
  registerBashTool();
  toolsRegistered = true;
  log.info("Default tools registered");
}

const AgentRunParams = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export async function handleAgentRun(params: Record<string, unknown>): Promise<ResponseFrame> {
  ensureToolsRegistered();

  const parsed = AgentRunParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { sessionId, message, provider, model } = parsed.data;

  const session = getSession(sessionId);
  if (!session) {
    return {
      id: "",
      ok: false,
      error: { code: "SESSION_NOT_FOUND", message: `Session ${sessionId} not found` },
    };
  }

  try {
    const result = await runAgent({
      sessionId,
      userMessage: message,
      provider,
      model,
    });

    return {
      id: "",
      ok: true,
      payload: {
        content: result.content,
        messageId: result.messageId,
        toolCallCount: result.toolCallCount,
        usage: result.usage,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, error: msg }, "Agent run failed");
    return {
      id: "",
      ok: false,
      error: { code: "AGENT_ERROR", message: msg },
    };
  }
}
