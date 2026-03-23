import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock federation manager
const mockGetPeers = vi.fn();
const mockAddPeer = vi.fn();
const mockRemovePeer = vi.fn();
const mockGetLocalGatewayId = vi.fn();
const mockGetLocalGatewayName = vi.fn();

vi.mock("../../federation/manager.js", () => ({
  getPeers: (...args: unknown[]) => mockGetPeers(...args),
  addPeer: (...args: unknown[]) => mockAddPeer(...args),
  removePeer: (...args: unknown[]) => mockRemovePeer(...args),
  getLocalGatewayId: () => mockGetLocalGatewayId(),
  getLocalGatewayName: () => mockGetLocalGatewayName(),
}));

import {
  handleFederationPeers,
  handleFederationConnect,
  handleFederationDisconnect,
  handleFederationStatus,
} from "../federation.js";
import type { ResponseFrame } from "../../protocol/frames.js";

function payload(r: ResponseFrame): Record<string, unknown> & { peers: Array<Record<string, unknown>> } {
  return r.payload as Record<string, unknown> & { peers: Array<Record<string, unknown>> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPeers.mockReturnValue([]);
  mockGetLocalGatewayId.mockReturnValue("gw-123");
  mockGetLocalGatewayName.mockReturnValue("nexus-test");
});

describe("handleFederationPeers", () => {
  it("returns empty peer list", () => {
    const result = handleFederationPeers();
    expect(result.ok).toBe(true);
    expect(payload(result).peers).toEqual([]);
  });

  it("returns peer list from manager", () => {
    mockGetPeers.mockReturnValue([
      { gatewayId: "peer-1", gatewayName: "remote", direction: "outbound", status: "connected" },
    ]);
    const result = handleFederationPeers();
    expect(result.ok).toBe(true);
    expect(payload(result).peers).toHaveLength(1);
    expect((payload(result).peers as Array<Record<string, unknown>>)[0].gatewayId).toBe("peer-1");
  });
});

describe("handleFederationConnect", () => {
  it("rejects missing url", () => {
    const result = handleFederationConnect({ token: "tok" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects invalid url format", () => {
    const result = handleFederationConnect({ url: "not-a-url", token: "tok" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects missing token", () => {
    const result = handleFederationConnect({ url: "https://peer.example.com" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns peerKey on valid params", () => {
    mockAddPeer.mockReturnValue("peer-key-1");
    const result = handleFederationConnect({
      url: "https://peer.example.com",
      token: "secret-token",
    });
    expect(result.ok).toBe(true);
    expect(payload(result).peerKey).toBe("peer-key-1");
    expect(payload(result).status).toBe("connecting");
  });

  it("returns error when addPeer throws", () => {
    mockAddPeer.mockImplementation(() => { throw new Error("Connection refused"); });
    const result = handleFederationConnect({
      url: "https://peer.example.com",
      token: "tok",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("FEDERATION_ERROR");
  });
});

describe("handleFederationDisconnect", () => {
  it("rejects missing gatewayId", () => {
    const result = handleFederationDisconnect({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects non-string gatewayId", () => {
    const result = handleFederationDisconnect({ gatewayId: 123 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns success when peer is found", () => {
    mockRemovePeer.mockReturnValue(true);
    const result = handleFederationDisconnect({ gatewayId: "peer-1" });
    expect(result.ok).toBe(true);
    expect(payload(result).disconnected).toBe(true);
  });

  it("returns PEER_NOT_FOUND when peer does not exist", () => {
    mockRemovePeer.mockReturnValue(false);
    const result = handleFederationDisconnect({ gatewayId: "unknown" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PEER_NOT_FOUND");
  });
});

describe("handleFederationStatus", () => {
  it("returns status with no peers", () => {
    const result = handleFederationStatus();
    expect(result.ok).toBe(true);
    expect(payload(result).gatewayId).toBe("gw-123");
    expect(payload(result).gatewayName).toBe("nexus-test");
    expect(payload(result).totalPeers).toBe(0);
    expect(payload(result).connectedPeers).toBe(0);
  });

  it("counts connected peers correctly", () => {
    mockGetPeers.mockReturnValue([
      { gatewayId: "p1", status: "connected" },
      { gatewayId: "p2", status: "connecting" },
      { gatewayId: "p3", status: "connected" },
    ]);
    const result = handleFederationStatus();
    expect(result.ok).toBe(true);
    expect(payload(result).totalPeers).toBe(3);
    expect(payload(result).connectedPeers).toBe(2);
  });
});
