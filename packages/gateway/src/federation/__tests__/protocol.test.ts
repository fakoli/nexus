import { describe, it, expect } from "vitest";
import {
  FederationHandshakeSchema,
  FederationAckSchema,
  FederatedMessageSchema,
  FederatedSessionSchema,
  FederatedStreamSchema,
  FederationFrameSchema,
} from "../protocol.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

describe("FederationHandshakeSchema", () => {
  it("accepts valid handshake", () => {
    const result = FederationHandshakeSchema.safeParse({
      type: "federation:hello",
      gatewayId: UUID,
      gatewayName: "nexus-a",
      version: "1.0.0",
      token: "secret",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual([]);
    }
  });

  it("rejects non-uuid gatewayId", () => {
    const result = FederationHandshakeSchema.safeParse({
      type: "federation:hello",
      gatewayId: "not-a-uuid",
      gatewayName: "nexus-a",
      version: "1.0.0",
      token: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong type literal", () => {
    const result = FederationHandshakeSchema.safeParse({
      type: "federation:ack",
      gatewayId: UUID,
      gatewayName: "x",
      version: "1.0.0",
      token: "t",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ack
// ---------------------------------------------------------------------------

describe("FederationAckSchema", () => {
  it("accepts valid ack", () => {
    const result = FederationAckSchema.safeParse({
      type: "federation:ack",
      gatewayId: UUID,
      gatewayName: "nexus-b",
      accepted: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts ack with rejection reason", () => {
    const result = FederationAckSchema.safeParse({
      type: "federation:ack",
      gatewayId: UUID,
      gatewayName: "nexus-b",
      accepted: false,
      reason: "Unauthorized",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Unauthorized");
    }
  });
});

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

describe("FederatedMessageSchema", () => {
  it("accepts valid message", () => {
    const result = FederatedMessageSchema.safeParse({
      type: "federation:message",
      originGateway: UUID,
      sessionId: "sess-1",
      message: { role: "user", content: "hello" },
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const result = FederatedMessageSchema.safeParse({
      type: "federation:message",
      originGateway: UUID,
      sessionId: "sess-1",
      message: { role: "tool", content: "x" },
      timestamp: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

describe("FederatedSessionSchema", () => {
  it("accepts create action", () => {
    const result = FederatedSessionSchema.safeParse({
      type: "federation:session",
      action: "create",
      originGateway: UUID,
      session: { id: "s1", agentId: "a1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = FederatedSessionSchema.safeParse({
      type: "federation:session",
      action: "delete",
      originGateway: UUID,
      session: { id: "s1", agentId: "a1" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

describe("FederatedStreamSchema", () => {
  it("accepts text delta", () => {
    const result = FederatedStreamSchema.safeParse({
      type: "federation:stream",
      originGateway: UUID,
      sessionId: "s1",
      delta: { type: "text", content: "hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts done delta without content", () => {
    const result = FederatedStreamSchema.safeParse({
      type: "federation:stream",
      originGateway: UUID,
      sessionId: "s1",
      delta: { type: "done" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid delta type", () => {
    const result = FederatedStreamSchema.safeParse({
      type: "federation:stream",
      originGateway: UUID,
      sessionId: "s1",
      delta: { type: "unknown" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

describe("FederationFrameSchema (union)", () => {
  it("parses handshake frame via discriminator", () => {
    const result = FederationFrameSchema.safeParse({
      type: "federation:hello",
      gatewayId: UUID,
      gatewayName: "x",
      version: "1.0.0",
      token: "t",
    });
    expect(result.success).toBe(true);
  });

  it("parses message frame via discriminator", () => {
    const result = FederationFrameSchema.safeParse({
      type: "federation:message",
      originGateway: UUID,
      sessionId: "s",
      message: { role: "assistant", content: "hi" },
      timestamp: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown frame type", () => {
    const result = FederationFrameSchema.safeParse({
      type: "federation:unknown",
      data: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects frame with missing required fields", () => {
    const result = FederationFrameSchema.safeParse({
      type: "federation:hello",
    });
    expect(result.success).toBe(false);
  });
});
