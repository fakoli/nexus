/**
 * Chat RPC handlers.
 *
 * - chat.send  — append a user message to a session, return the message ID.
 *               If the content starts with "/" it is routed to the slash
 *               command framework instead of being stored as a message.
 * - chat.history — retrieve message history for a session.
 */
import { z } from "zod";
import {
  appendMessage,
  getMessages,
  getMessageCount,
  getSession,
  setConfig,
  createLogger,
} from "@nexus/core";
import { executeSlashCommand } from "@nexus/agent";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:chat");

// ── Param schemas ───────────────────────────────────────────────────

const ChatSendParams = z.object({
  sessionId: z.string(),
  content: z.string().min(1),
  role: z.enum(["user", "assistant", "tool_use", "tool_result", "system"]).default("user"),
  metadata: z.record(z.unknown()).optional(),
});

const ChatHistoryParams = z.object({
  sessionId: z.string(),
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
});

// ── Handlers ────────────────────────────────────────────────────────

export async function handleChatSend(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ChatSendParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { sessionId, content, role, metadata } = parsed.data;

  const session = getSession(sessionId);
  if (!session) {
    return {
      id: "",
      ok: false,
      error: { code: "SESSION_NOT_FOUND", message: `Session ${sessionId} not found` },
    };
  }

  // Slash command interception — only for user-role messages starting with "/"
  if (role === "user" && content.startsWith("/")) {
    const ctx = {
      sessionId,
      agentId: session.agentId,
      setConfig: (key: string, value: unknown) => setConfig(key, value),
    };
    const result = await executeSlashCommand(content, ctx);
    if (result.handled) {
      log.info({ sessionId, command: content.split(" ")[0] }, "Slash command handled");
      return {
        id: "",
        ok: true,
        payload: { command: true, response: result.response ?? "" },
      };
    }
    // Not a recognised command — fall through to normal message append
  }

  const messageId = appendMessage(sessionId, role, content, metadata);
  log.info({ sessionId, messageId, role }, "Message appended");

  return {
    id: "",
    ok: true,
    payload: { messageId, sessionId },
  };
}

export function handleChatHistory(params: Record<string, unknown>): ResponseFrame {
  const parsed = ChatHistoryParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { sessionId, limit, offset } = parsed.data;

  const session = getSession(sessionId);
  if (!session) {
    return {
      id: "",
      ok: false,
      error: { code: "SESSION_NOT_FOUND", message: `Session ${sessionId} not found` },
    };
  }

  const messages = getMessages(sessionId, limit, offset);
  const total = getMessageCount(sessionId);

  return {
    id: "",
    ok: true,
    payload: { messages, total, limit, offset },
  };
}
