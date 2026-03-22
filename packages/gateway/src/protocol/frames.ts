/**
 * WebSocket protocol frame schemas.
 *
 * All messages exchanged over the Nexus WS gateway are validated against
 * these Zod schemas before being processed or forwarded.
 */
import { z } from "zod";

// ── Connect (client → server, first message after upgrade) ──────────

export const ConnectParams = z.object({
  /** Auth token (preferred). */
  token: z.string().optional(),
  /** Password-based auth fallback. */
  password: z.string().optional(),
  /** Device token for paired-device authentication. */
  deviceToken: z.string().optional(),
  /** Client metadata. */
  client: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
      platform: z.string().optional(),
    })
    .optional(),
});
export type ConnectParams = z.infer<typeof ConnectParams>;

// ── HelloOk (server → client, sent after successful auth) ──────────

export const HelloOk = z.object({
  proto: z.literal(1),
  server: z.object({
    name: z.string(),
    version: z.string(),
  }),
  session: z.object({
    id: z.string(),
    agentId: z.string(),
  }),
});
export type HelloOk = z.infer<typeof HelloOk>;

// ── RequestFrame (client → server RPC call) ─────────────────────────

export const RequestFrame = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.unknown()).default({}),
});
export type RequestFrame = z.infer<typeof RequestFrame>;

// ── ResponseFrame (server → client RPC reply) ───────────────────────

export const ResponseFrame = z.object({
  id: z.string(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

// ── EventFrame (server → client broadcast) ──────────────────────────

export const EventFrame = z.object({
  event: z.string(),
  payload: z.record(z.unknown()).default({}),
  seq: z.number().int().nonnegative(),
});
export type EventFrame = z.infer<typeof EventFrame>;
