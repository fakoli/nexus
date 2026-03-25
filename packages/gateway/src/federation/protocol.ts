/**
 * Federation protocol — Zod schemas for all federation frame types.
 */
import { z } from "zod";

// ── Handshake ───────────────────────────────────────────────────────

export const FederationHandshakeSchema = z.object({
  type: z.literal("federation:hello"),
  gatewayId: z.string().uuid(),
  gatewayName: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  token: z.string().optional(),
});

export type FederationHandshake = z.infer<typeof FederationHandshakeSchema>;

// ── Ack ─────────────────────────────────────────────────────────────

export const FederationAckSchema = z.object({
  type: z.literal("federation:ack"),
  gatewayId: z.string(),
  gatewayName: z.string(),
  accepted: z.boolean(),
  reason: z.string().optional(),
});

export type FederationAck = z.infer<typeof FederationAckSchema>;

// ── Message ─────────────────────────────────────────────────────────

export const FederatedMessageSchema = z.object({
  type: z.literal("federation:message"),
  originGateway: z.string().uuid(),
  sessionId: z.string().min(1),
  message: z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    metadata: z.record(z.unknown()).optional(),
  }),
  timestamp: z.number(),
});

export type FederatedMessage = z.infer<typeof FederatedMessageSchema>;

// ── Session ─────────────────────────────────────────────────────────

export const FederatedSessionSchema = z.object({
  type: z.literal("federation:session"),
  action: z.enum(["create", "sync", "close"]),
  originGateway: z.string().uuid(),
  session: z.object({
    id: z.string().min(1),
    agentId: z.string().min(1),
  }),
});

export type FederatedSession = z.infer<typeof FederatedSessionSchema>;

// ── Stream ──────────────────────────────────────────────────────────

export const FederatedStreamSchema = z.object({
  type: z.literal("federation:stream"),
  originGateway: z.string().uuid(),
  sessionId: z.string().min(1),
  delta: z.object({
    type: z.enum(["text", "tool_call", "done"]),
    content: z.string().optional(),
  }),
});

export type FederatedStream = z.infer<typeof FederatedStreamSchema>;

// ── Discriminated union ─────────────────────────────────────────────

export const FederationFrameSchema = z.discriminatedUnion("type", [
  FederationHandshakeSchema,
  FederationAckSchema,
  FederatedMessageSchema,
  FederatedSessionSchema,
  FederatedStreamSchema,
]);

export type FederationFrame = z.infer<typeof FederationFrameSchema>;
