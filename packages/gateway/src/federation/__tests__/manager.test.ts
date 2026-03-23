import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  events: { emit: vi.fn() },
  appendMessage: vi.fn(),
  getOrCreateSession: vi.fn(),
  getOrCreateAgent: vi.fn(),
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

// Mock FederationClient
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockOnMessage = vi.fn();
const mockOnStream = vi.fn();
const mockOnConnect = vi.fn();
const mockOnDisconnect = vi.fn();
const mockIsConnected = vi.fn(() => false);

vi.mock("../client.js", () => ({
  FederationClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    onMessage: mockOnMessage,
    onStream: mockOnStream,
    onConnect: mockOnConnect,
    onDisconnect: mockOnDisconnect,
    isConnected: mockIsConnected,
    remoteGatewayId: "",
    remoteGatewayName: "",
  })),
}));

// Mock federation handler
vi.mock("../handler.js", () => ({
  getInboundPeers: vi.fn(() => []),
  disconnectInboundPeer: vi.fn(() => false),
  broadcastToInboundPeers: vi.fn(),
  clearInboundPeers: vi.fn(),
}));

import {
  startFederation,
  stopFederation,
  addPeer,
  removePeer,
  getPeers,
  getLocalGatewayId,
  getLocalGatewayName,
} from "../manager.js";
import type { FederationConfig } from "../config.js";

const baseConfig: FederationConfig = {
  enabled: true,
  gatewayId: "gw-test-id",
  gatewayName: "test-gateway",
  peers: [],
  heartbeatInterval: 30000,
  reconnectMaxDelay: 30000,
  messageQueueSize: 1000,
  federationTokens: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Start fresh federation state
  stopFederation();
});

afterEach(() => {
  stopFederation();
});

describe("FederationManager startup", () => {
  it("starts with no peers", () => {
    startFederation(baseConfig);
    const peers = getPeers();
    expect(peers).toEqual([]);
  });

  it("sets local gateway id from config", () => {
    startFederation(baseConfig);
    expect(getLocalGatewayId()).toBe("gw-test-id");
  });

  it("sets local gateway name from config", () => {
    startFederation(baseConfig);
    expect(getLocalGatewayName()).toBe("test-gateway");
  });

  it("generates uuid when gatewayId not in config", () => {
    startFederation({ ...baseConfig, gatewayId: undefined });
    expect(getLocalGatewayId()).toBe("test-uuid-1234");
  });

  it("auto-connects peers marked with autoConnect", () => {
    startFederation({
      ...baseConfig,
      peers: [
        { url: "https://peer1.io", token: "tok1", autoConnect: true },
        { url: "https://peer2.io", token: "tok2", autoConnect: false },
      ],
    });
    // Only peer1 should connect
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

describe("addPeer / removePeer", () => {
  it("adds a peer and returns peer key", () => {
    startFederation(baseConfig);
    const key = addPeer("https://remote.io", "token123", "my-peer");
    expect(key).toBe("my-peer");
    expect(mockConnect).toHaveBeenCalled();
  });

  it("uses url as key when no name provided", () => {
    startFederation(baseConfig);
    const key = addPeer("https://remote.io", "token123");
    expect(key).toBe("https://remote.io");
  });

  it("removes a peer by key", () => {
    startFederation(baseConfig);
    addPeer("https://remote.io", "tok", "peer-x");
    const removed = removePeer("peer-x");
    expect(removed).toBe(true);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("returns false for unknown peer", () => {
    startFederation(baseConfig);
    const removed = removePeer("nonexistent");
    expect(removed).toBe(false);
  });
});

describe("getPeers", () => {
  it("returns outbound peers with status", () => {
    startFederation(baseConfig);
    addPeer("https://remote.io", "tok", "p1");
    mockIsConnected.mockReturnValue(false);

    const peers = getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].direction).toBe("outbound");
    expect(peers[0].status).toBe("connecting");
  });

  it("returns connected status when client is connected", () => {
    startFederation(baseConfig);
    addPeer("https://remote.io", "tok", "p1");
    mockIsConnected.mockReturnValue(true);

    const peers = getPeers();
    expect(peers[0].status).toBe("connected");
  });
});
