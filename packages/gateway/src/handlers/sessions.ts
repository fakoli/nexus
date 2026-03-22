/**
 * Session RPC handlers.
 *
 * - sessions.list   — list sessions with optional filters.
 * - sessions.create — create a new session.
 */
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  listSessions,
  createSession,
  getOrCreateAgent,
  createLogger,
} from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:sessions");

// ── Param schemas ───────────────────────────────────────────────────

const SessionsListParams = z.object({
  agentId: z.string().optional(),
  state: z.enum(["active", "archived", "deleted"]).optional(),
});

const SessionsCreateParams = z.object({
  agentId: z.string().default("default"),
  channel: z.string().optional(),
  peerId: z.string().optional(),
  sessionId: z.string().optional(),
});

// ── Handlers ────────────────────────────────────────────────────────

export function handleSessionsList(params: Record<string, unknown>): ResponseFrame {
  const parsed = SessionsListParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { agentId, state } = parsed.data;
  const sessions = listSessions(agentId, state);

  return {
    id: "",
    ok: true,
    payload: { sessions },
  };
}

export function handleSessionsCreate(params: Record<string, unknown>): ResponseFrame {
  const parsed = SessionsCreateParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { agentId, channel, peerId, sessionId: requestedId } = parsed.data;

  // Ensure the agent exists (auto-create with defaults if necessary).
  getOrCreateAgent(agentId);

  const id = requestedId ?? uuid();
  const session = createSession(id, agentId, channel, peerId);
  log.info({ sessionId: id, agentId }, "Session created");

  return {
    id: "",
    ok: true,
    payload: { session },
  };
}
