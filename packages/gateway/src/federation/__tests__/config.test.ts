import { describe, it, expect, vi } from "vitest";

// Mock @nexus/core DB-dependent parts to avoid SQLite init
vi.mock("@nexus/core", async () => {
  const { z } = await import("zod");

  const FederationPeerConfigSchema = z.object({
    url: z.string().url(),
    name: z.string().optional(),
    token: z.string(),
    autoConnect: z.boolean().default(true),
  });

  const FederationConfigSchema = z.object({
    enabled: z.boolean().default(false),
    gatewayId: z.string().uuid().optional(),
    gatewayName: z.string().default("nexus"),
    token: z.string().optional(),
    peers: z.array(FederationPeerConfigSchema).default([]),
    maxPeers: z.number().default(10),
    messageQueueSize: z.number().default(1000),
    heartbeatInterval: z.number().default(30000),
  });

  return {
    FederationConfigSchema,
    FederationPeerConfigSchema,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { FederationConfigSchema, FederationPeerSchema } from "../config.js";

// ---------------------------------------------------------------------------
// FederationConfigSchema
// ---------------------------------------------------------------------------

describe("FederationConfigSchema", () => {
  it("applies correct defaults", () => {
    const result = FederationConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.gatewayName).toBe("nexus");
    expect(result.peers).toEqual([]);
    expect(result.maxPeers).toBe(10);
    expect(result.heartbeatInterval).toBe(30000);
  });

  it("accepts full valid config", () => {
    const result = FederationConfigSchema.parse({
      enabled: true,
      gatewayId: "550e8400-e29b-41d4-a716-446655440000",
      gatewayName: "my-gateway",
      token: "secret-token",
      peers: [
        {
          url: "wss://peer.example.com/ws",
          name: "peer-1",
          token: "peer-token",
        },
      ],
      maxPeers: 5,
    });
    expect(result.enabled).toBe(true);
    expect(result.peers).toHaveLength(1);
  });

  it("rejects invalid gatewayId", () => {
    const result = FederationConfigSchema.safeParse({
      gatewayId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FederationPeerSchema
// ---------------------------------------------------------------------------

describe("FederationPeerSchema", () => {
  it("accepts valid peer config", () => {
    const result = FederationPeerSchema.safeParse({
      url: "wss://peer.example.com/ws",
      token: "secret",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoConnect).toBe(true);
    }
  });

  it("rejects invalid URL", () => {
    const result = FederationPeerSchema.safeParse({
      url: "not-a-url",
      token: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing token", () => {
    const result = FederationPeerSchema.safeParse({
      url: "wss://peer.example.com/ws",
    });
    expect(result.success).toBe(false);
  });

  it("allows optional name", () => {
    const result = FederationPeerSchema.safeParse({
      url: "https://peer.example.com",
      token: "t",
      name: "friendly-name",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("friendly-name");
    }
  });
});
