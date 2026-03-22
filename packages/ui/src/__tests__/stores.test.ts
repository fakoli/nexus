/**
 * Tests for store actions (packages/ui/src/stores/actions.ts).
 *
 * The gateway client is fully mocked so no WebSocket is needed.
 * solid-js/store is shimmed with a plain-object reactive stand-in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, SessionInfo } from "../gateway/types";

// ── Shim solid-js ─────────────────────────────────────────────────────────────
// We use a simple deep-path setter that mirrors createStore's path-based API.

function deepSet(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i] as string] as Record<string, unknown>;
  }
  const last = path[path.length - 1] as string;
  if (typeof value === "function") {
    cur[last] = (value as (v: unknown) => unknown)(cur[last]);
  } else {
    cur[last] = value;
  }
}

const storeState = {
  connection: { status: "disconnected", error: null as string | null },
  session: { id: "", agentId: "", messages: [] as Message[] },
  sessions: [] as SessionInfo[],
  chat: { input: "", sending: false },
  config: { gateway: {} as Record<string, unknown>, agent: {} as Record<string, unknown>, security: {} as Record<string, unknown> },
  ui: { tab: "chat", theme: "dark" },
};

function setStore(...args: unknown[]): void {
  if (args.length === 2) {
    // setStore("sessions", value)
    deepSet(storeState as unknown as Record<string, unknown>, [args[0] as string], args[1]);
  } else if (args.length === 3) {
    // setStore("connection", "status", value)
    deepSet(storeState as unknown as Record<string, unknown>, [args[0] as string, args[1] as string], args[2]);
  }
}

vi.mock("solid-js/store", () => ({
  createStore: (_initial: unknown) => [storeState, setStore],
}));

vi.mock("solid-js", () => ({
  createSignal: (initial: unknown) => {
    let val = initial;
    const getter = () => val;
    const setter = (next: unknown) => {
      val = typeof next === "function" ? (next as (v: unknown) => unknown)(val) : next;
    };
    return [getter, setter];
  },
}));

// ── Mock gateway client ────────────────────────────────────────────────────────

const mockRequest = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockOnEvent = vi.fn(() => () => {});
const mockConnected = vi.fn(() => true);

vi.mock("../gateway/client", () => ({
  createGatewayClient: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    request: mockRequest,
    onEvent: mockOnEvent,
    connected: mockConnected,
  })),
}));

// Import modules under test AFTER mocks are set up
const { store } = await import("../stores/app");
const {
  sendMessage,
  loadHistory,
  loadSessions,
  loadConfig,
  saveConfig,
  setTab,
  setTheme,
  setChatInput,
} = await import("../stores/actions");

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore(): void {
  storeState.connection.status = "disconnected";
  storeState.connection.error = null;
  storeState.session.id = "test-session";
  storeState.session.agentId = "default";
  storeState.session.messages = [];
  storeState.sessions = [];
  storeState.chat.input = "";
  storeState.chat.sending = false;
  storeState.config.gateway = {};
  storeState.config.agent = {};
  storeState.config.security = {};
  storeState.ui.tab = "chat";
  storeState.ui.theme = "dark";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendMessage", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
  });

  it("adds an optimistic user message to store.session.messages", async () => {
    await sendMessage("Hello, world!");
    expect(store.session.messages).toHaveLength(1);
    expect(store.session.messages[0].role).toBe("user");
    expect(store.session.messages[0].content).toBe("Hello, world!");
  });

  it("clears chat input after sending", async () => {
    storeState.chat.input = "Hello!";
    await sendMessage("Hello!");
    expect(store.chat.input).toBe("");
  });

  it("calls gateway.request with agent.run and the trimmed message", async () => {
    storeState.session.id = "sess-abc";
    await sendMessage("  test message  ");
    expect(mockRequest).toHaveBeenCalledWith("agent.run", {
      sessionId: "sess-abc",
      message: "test message",
    });
  });

  it("ignores empty / whitespace-only messages", async () => {
    await sendMessage("   ");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(store.session.messages).toHaveLength(0);
  });

  it("sets connection error if request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));
    await sendMessage("hi");
    expect(store.connection.error).toBe("network error");
  });

  it("resets chat.sending to false after success", async () => {
    await sendMessage("hi");
    expect(store.chat.sending).toBe(false);
  });

  it("resets chat.sending to false even if request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("fail"));
    await sendMessage("hi");
    expect(store.chat.sending).toBe(false);
  });

  it("does not send if already sending", async () => {
    storeState.chat.sending = true;
    await sendMessage("hi");
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("loadHistory", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("populates store.session.messages from payload.messages", async () => {
    const messages: Message[] = [
      { id: "m1", role: "user", content: "hi", timestamp: 1 },
      { id: "m2", role: "assistant", content: "hello", timestamp: 2 },
    ];
    mockRequest.mockResolvedValue({ messages });

    await loadHistory();
    expect(store.session.messages).toHaveLength(2);
    expect(store.session.messages[0].content).toBe("hi");
    expect(store.session.messages[1].content).toBe("hello");
  });

  it("uses empty array when payload.messages is missing", async () => {
    storeState.session.messages = [
      { id: "old", role: "user", content: "old", timestamp: 0 },
    ];
    mockRequest.mockResolvedValue({});

    await loadHistory();
    expect(store.session.messages).toHaveLength(0);
  });

  it("calls chat.history with the current sessionId", async () => {
    storeState.session.id = "sess-xyz";
    mockRequest.mockResolvedValue({ messages: [] });
    await loadHistory();
    expect(mockRequest).toHaveBeenCalledWith("chat.history", { sessionId: "sess-xyz" });
  });

  it("sets connection error if request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("history error"));
    await loadHistory();
    expect(store.connection.error).toBe("history error");
  });
});

describe("loadSessions", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("populates store.sessions from payload.sessions", async () => {
    const sessions: SessionInfo[] = [
      { id: "s1", agentId: "default", createdAt: 1, messageCount: 3 },
    ];
    mockRequest.mockResolvedValue({ sessions });
    await loadSessions();
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe("s1");
  });

  it("uses empty array when payload.sessions is missing", async () => {
    storeState.sessions = [{ id: "old", agentId: "default", createdAt: 0, messageCount: 0 }];
    mockRequest.mockResolvedValue({});
    await loadSessions();
    expect(store.sessions).toHaveLength(0);
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("populates config.gateway from payload", async () => {
    mockRequest.mockResolvedValue({ gateway: { port: 18789 }, agent: {}, security: {} });
    await loadConfig();
    expect(store.config.gateway).toEqual({ port: 18789 });
  });

  it("populates config.agent from payload", async () => {
    mockRequest.mockResolvedValue({ agent: { model: "gpt-4" } });
    await loadConfig();
    expect(store.config.agent).toEqual({ model: "gpt-4" });
  });

  it("populates config.security from payload", async () => {
    mockRequest.mockResolvedValue({ security: { authRequired: true } });
    await loadConfig();
    expect(store.config.security).toEqual({ authRequired: true });
  });

  it("sets connection error if request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("config error"));
    await loadConfig();
    expect(store.connection.error).toBe("config error");
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
  });

  it("calls config.set with section and data", async () => {
    await saveConfig("gateway", { port: 9000 });
    expect(mockRequest).toHaveBeenCalledWith("config.set", {
      section: "gateway",
      data: { port: 9000 },
    });
  });

  it("updates the local store on success", async () => {
    await saveConfig("agent", { model: "claude-3" });
    expect(store.config.agent).toEqual({ model: "claude-3" });
  });

  it("sets error if request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("save failed"));
    await saveConfig("security", {});
    expect(store.connection.error).toBe("save failed");
  });
});

describe("setTab / setTheme / setChatInput", () => {
  beforeEach(() => resetStore());

  it("setTab changes store.ui.tab", () => {
    setTab("sessions");
    expect(store.ui.tab).toBe("sessions");
  });

  it("setTab can switch back to chat", () => {
    setTab("config");
    setTab("chat");
    expect(store.ui.tab).toBe("chat");
  });

  it("setTheme changes store.ui.theme to light", () => {
    setTheme("light");
    expect(store.ui.theme).toBe("light");
  });

  it("setTheme changes store.ui.theme to dark", () => {
    storeState.ui.theme = "light";
    setTheme("dark");
    expect(store.ui.theme).toBe("dark");
  });

  it("setChatInput updates store.chat.input", () => {
    setChatInput("new input text");
    expect(store.chat.input).toBe("new input text");
  });

  it("setChatInput accepts empty string", () => {
    storeState.chat.input = "something";
    setChatInput("");
    expect(store.chat.input).toBe("");
  });
});
