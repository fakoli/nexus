/**
 * Tests for the gateway WebSocket client (packages/ui/src/gateway/client.ts).
 *
 * We inject a fake WebSocket constructor so no real network is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake WebSocket ────────────────────────────────────────────────────────────

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState: number;
  url: string;

  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  sent: string[] = [];
  closeCalled = false;
  closeCode?: number;
  closeReason?: string;

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    FakeWebSocket._instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen(): void {
    this.onopen?.({} as Event);
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateClose(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }

  simulateError(): void {
    this.onerror?.({} as Event);
  }

  static _instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket._instances = [];
  }

  static latest(): FakeWebSocket {
    return FakeWebSocket._instances[FakeWebSocket._instances.length - 1];
  }
}

// Inject fake WebSocket globally before importing client
(globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;

// Mock solid-js createSignal so we can test outside a Solid context
vi.mock("solid-js", () => {
  return {
    createSignal: (initial: unknown) => {
      let val = initial;
      const getter = () => val;
      const setter = (next: unknown) => {
        val = typeof next === "function" ? (next as (v: unknown) => unknown)(val) : next;
      };
      return [getter, setter];
    },
  };
});

// Import after mock setup
const { createGatewayClient } = await import("../gateway/client");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHello(sessionId = "sess-1") {
  return {
    proto: 1,
    server: { name: "nexus-gateway", version: "0.1.0" },
    session: { id: sessionId, agentId: "default" },
  };
}

function makeResponse(id: string, payload: Record<string, unknown> = {}) {
  return { id, ok: true, payload };
}

function makeErrorResponse(id: string, code: string, message: string) {
  return { id, ok: false, error: { code, message } };
}

function makeEvent(event: string, payload: Record<string, unknown> = {}, seq = 1) {
  return { event, payload, seq };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createGatewayClient", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts disconnected", () => {
    const client = createGatewayClient("ws://localhost:9999/ws");
    expect(client.connected()).toBe(false);
  });

  it("connect() opens a WebSocket to the given URL", () => {
    const client = createGatewayClient("ws://localhost:9999/ws");
    client.connect();
    expect(FakeWebSocket._instances).toHaveLength(1);
    expect(FakeWebSocket.latest().url).toBe("ws://localhost:9999/ws");
  });

  it("sends ConnectParams on WS open", () => {
    const client = createGatewayClient("ws://test/ws", "tok123", "pass456");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();

    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.token).toBe("tok123");
    expect(sent.password).toBe("pass456");
    expect(sent.client).toMatchObject({ name: "nexus-ui", version: "0.1.0" });
  });

  it("sets connected=true after receiving HelloOk", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    expect(client.connected()).toBe(true);
  });

  it("request() resolves when a matching ResponseFrame arrives", async () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    const promise = client.request("config.get");

    // Extract the request id from the frame that was sent
    const requestFrame = JSON.parse(ws.sent[ws.sent.length - 1]);
    const { id } = requestFrame;

    ws.simulateMessage(makeResponse(id, { port: 18789 }));

    const result = await promise;
    expect(result).toEqual({ port: 18789 });
  });

  it("request() rejects when the server returns an error frame", async () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    const promise = client.request("chat.send", { message: "hi" });
    const requestFrame = JSON.parse(ws.sent[ws.sent.length - 1]);

    ws.simulateMessage(makeErrorResponse(requestFrame.id, "NOT_FOUND", "method not found"));

    await expect(promise).rejects.toThrow("method not found");
  });

  it("request() rejects immediately when not connected", async () => {
    const client = createGatewayClient("ws://test/ws");
    // Do not connect at all
    await expect(client.request("config.get")).rejects.toThrow("Not connected");
  });

  it("disconnect() sets connected=false and closes the socket", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    expect(client.connected()).toBe(true);
    client.disconnect();
    expect(client.connected()).toBe(false);
    expect(ws.closeCalled).toBe(true);
  });

  it("disconnect() rejects all pending requests", async () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    const promise = client.request("sessions.list");
    client.disconnect();

    await expect(promise).rejects.toThrow("Client disconnected");
  });

  it("schedules reconnect after unexpected close", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    ws.simulateClose(1006); // abnormal close

    // Before timer fires, no new socket
    expect(FakeWebSocket._instances).toHaveLength(1);

    // Fast-forward past the backoff delay (1000ms for attempt 0)
    vi.advanceTimersByTime(1100);

    expect(FakeWebSocket._instances).toHaveLength(2);
  });

  it("does not reconnect after intentional disconnect()", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    client.disconnect();
    vi.advanceTimersByTime(5000);

    // Still only the original socket — no reconnect attempted
    expect(FakeWebSocket._instances).toHaveLength(1);
  });

  it("onEvent() fires registered callback for matching event", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    const cb = vi.fn();
    client.onEvent("session:message", cb);

    ws.simulateMessage(makeEvent("session:message", { role: "assistant", content: "hi" }));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ role: "assistant", content: "hi" });
  });

  it("onEvent() unsubscribe stops future callbacks", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();
    ws.simulateMessage(makeHello());

    const cb = vi.fn();
    const unsub = client.onEvent("config:changed", cb);

    ws.simulateMessage(makeEvent("config:changed", { key: "port" }));
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    ws.simulateMessage(makeEvent("config:changed", { key: "port" }));
    expect(cb).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it("session:created synthetic event is emitted on HelloOk with correct payload", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws = FakeWebSocket.latest();
    ws.simulateOpen();

    const cb = vi.fn();
    client.onEvent("session:created", cb);

    ws.simulateMessage(makeHello("my-session"));

    expect(cb).toHaveBeenCalledOnce();
    const payload = cb.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe("my-session");
    expect(payload.agentId).toBe("default");
  });

  it("resets reconnect attempt counter to 0 after successful HelloOk", () => {
    const client = createGatewayClient("ws://test/ws");
    client.connect();
    const ws1 = FakeWebSocket.latest();
    ws1.simulateOpen();
    // Trigger a close before auth to bump the attempt counter
    ws1.simulateClose(1006);

    vi.advanceTimersByTime(1100);
    const ws2 = FakeWebSocket.latest();
    ws2.simulateOpen();
    ws2.simulateMessage(makeHello());

    // After successful hello, attempt counter is reset.
    // We verify indirectly: next disconnect→reconnect should have a 1000ms delay
    ws2.simulateClose(1006);
    vi.advanceTimersByTime(1100);

    expect(FakeWebSocket._instances).toHaveLength(3);
  });
});
