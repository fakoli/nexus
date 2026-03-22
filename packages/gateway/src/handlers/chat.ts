/**
 * Chat RPC handlers.
 *
 * - chat.send  — append a user message to a session, return the message ID.
 * - chat.history — retrieve message history for a session.
 */
import { z } from "zod";
import {
  appendMessage,
  getMessages,
  getMessageCount,
  getSession,
  createLogger,
} from "@nexus/core";
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

export function handleChatSend(params: Record<string, unknown>): ResponseFrame {
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
