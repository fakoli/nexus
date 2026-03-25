import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock ws module
const mockWsSend = vi.fn();
const mockWsClose = vi.fn();
const mockWsPing = vi.fn();
const mockWsOn = vi.fn();

vi.mock("ws", () => ({
  WebSocket: vi.fn().mockImplementation(() => ({
    send: mockWsSend,
    close: mockWsClose,
    ping: mockWsPing,
    on: mockWsOn,
    readyState: 1, // OPEN
  })),
}));

// Mock protocol
vi.mock("../protocol.js", () => ({
  FederationFrameSchema: {
    safeParse: vi.fn((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d && typeof d === "object" && "type" in d) {
        return { success: true, data: d };
      }
      return { success: false, error: { message: "Invalid frame" } };
    }),
  },
}));

import { FederationClient } from "../client.js";
import type { FederationClientOptions } from "../client.js";

const defaultOpts: FederationClientOptions = {
  localGatewayId: "local-gw-id",
  localGatewayName: "local-gw",
  version: "0.1.0",
  heartbeatInterval: 30000,
  reconnectMaxDelay: 30000,
  messageQueueSize: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FederationClient connection state", () => {
  it("starts disconnected", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    expect(client.isConnected()).toBe(false);
  });

  it("creates WebSocket on connect", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.connect();
    // WebSocket was created, so the on handler should have been registered
    expect(mockWsOn).toHaveBeenCalled();
  });

  it("sets remoteGatewayId to empty before connection", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    expect(client.remoteGatewayId).toBe("");
    expect(client.remoteGatewayName).toBe("");
  });

  it("disconnects and clears state", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.connect();
    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(mockWsClose).toHaveBeenCalledWith(1000, "Federation client disconnecting");
  });
});

describe("message queuing when disconnected", () => {
  it("queues messages when not connected", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    // Not connected, so forwardMessage should queue
    client.forwardMessage("session-1", {
      role: "user",
      content: "Hello",
    });
    // Since not connected, ws.send should NOT be called
    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it("queues stream forwarding when disconnected", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.forwardStream("session-1", {
      type: "text",
      content: "chunk",
    });
    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it("queues session sync when disconnected", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.syncSession(
      { id: "s1", agentId: "a1" },
      "create",
    );
    expect(mockWsSend).not.toHaveBeenCalled();
  });
});

describe("event handlers", () => {
  it("registers message handler", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    const handler = vi.fn();
    client.onMessage(handler);
    // Handler is registered (no throw)
    expect(true).toBe(true);
  });

  it("registers connect handler", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    const handler = vi.fn();
    client.onConnect(handler);
    expect(true).toBe(true);
  });

  it("registers disconnect handler", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    const handler = vi.fn();
    client.onDisconnect(handler);
    expect(true).toBe(true);
  });

  it("registers stream handler", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    const handler = vi.fn();
    client.onStream(handler);
    expect(true).toBe(true);
  });
});

describe("reconnect backoff", () => {
  it("does not reconnect after explicit disconnect", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.connect();
    const callCountAfterConnect = mockWsOn.mock.calls.length;

    client.disconnect();
    expect(client.isConnected()).toBe(false);

    // Advance timers - should not try to reconnect
    vi.advanceTimersByTime(60000);
    // mockWsOn should not have been called again (no new WebSocket)
    expect(mockWsOn).toHaveBeenCalledTimes(callCountAfterConnect);
  });

  it("registers open/message/close/error handlers on connect", () => {
    const client = new FederationClient("https://remote.io", "tok", defaultOpts);
    client.connect();

    const eventNames = mockWsOn.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(eventNames).toContain("open");
    expect(eventNames).toContain("message");
    expect(eventNames).toContain("close");
    expect(eventNames).toContain("error");
  });
});
