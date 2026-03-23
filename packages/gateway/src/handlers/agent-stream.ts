/**
 * agent.stream RPC handler — streams assistant response deltas back to the
 * requesting client as EventFrames while the agent is running.
 *
 * Protocol:
 *   Client sends:  { method: "agent.stream", params: { sessionId, message } }
 *   Server replies immediately with: { ok: true, payload: { started: true } }
 *   Server then pushes EventFrames:
 *     { event: "agent:delta", payload: { sessionId, type: "text", text: "…" }, seq }
 *     { event: "agent:delta", payload: { sessionId, type: "done" }, seq }
 */
import { z } from "zod";
import { createLogger, getSession, appendMessage, getOrCreateSession, getOrCreateAgent, recordAudit } from "@nexus/core";
import {
  resolveProvider,
  buildContext,
  getToolDefinitions,
  registerFilesystemTools,
  registerBashTool,
  registerWebFetchTool,
  runStreamingLoop,
} from "@nexus/agent";
import type { StreamDelta } from "@nexus/agent";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:agent-stream");

let toolsRegistered = false;

function ensureToolsRegistered(): void {
  if (toolsRegistered) return;
  registerFilesystemTools();
  registerBashTool();
  registerWebFetchTool();
  toolsRegistered = true;
  log.info("Default tools registered");
}

const AgentStreamParams = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
});

// Broadcast function injected at registration time so this module stays
// independent of the server's internal client map.
type BroadcastFn = (event: string, payload: Record<string, unknown>) => void;

let broadcastFn: BroadcastFn = () => { /* no-op until wired */ };

export function setBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export async function handleAgentStream(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  ensureToolsRegistered();

  const parsed = AgentStreamParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { sessionId, message, provider: providerOverride, model: modelOverride } = parsed.data;

  const session = getSession(sessionId);
  if (!session) {
    return {
      id: "",
      ok: false,
      error: { code: "SESSION_NOT_FOUND", message: `Session ${sessionId} not found` },
    };
  }

  // Kick off streaming in the background; return immediately so the client
  // gets the ack and starts listening for EventFrames.
  void runStream(sessionId, message, providerOverride, modelOverride);

  return { id: "", ok: true, payload: { started: true, sessionId } };
}

async function runStream(
  sessionId: string,
  message: string,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
): Promise<void> {
  const agentId = "default";
  getOrCreateAgent(agentId);
  getOrCreateSession(sessionId, agentId);

  appendMessage(sessionId, "user", message);
  recordAudit("agent_stream_start", "system", { sessionId });

  const context = buildContext({
    sessionId,
    tools: getToolDefinitions(),
  });

  const onDelta = (delta: StreamDelta): void => {
    if (delta.type === "text") {
      broadcastFn("agent:delta", { sessionId, type: "text", text: delta.text });
    } else if (delta.type === "done") {
      broadcastFn("agent:delta", { sessionId, type: "done" });
    }
  };

  try {
    const { provider, model } = resolveProvider(providerOverride, modelOverride);
    log.info({ provider: provider.id, model, sessionId }, "Streaming agent run started");

    const result = await runStreamingLoop({
      provider,
      model,
      sessionId,
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      tools: context.tools,
      onDelta,
    });

    // Persist the final assembled assistant message
    appendMessage(sessionId, "assistant", result.content, {
      usage: result.usage,
      toolCallCount: result.toolCallCount,
    });

    log.info({ sessionId, tokens: result.usage, tools: result.toolCallCount }, "Stream complete");
    recordAudit("agent_stream_complete", "system", { sessionId, usage: result.usage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, error: msg }, "Streaming agent run failed");
    appendMessage(sessionId, "assistant", `Error: ${msg}`);
    broadcastFn("agent:delta", { sessionId, type: "done", error: msg });
  }
}
