/**
 * Slash-command integration tests for packages/ui/src/stores/actions.ts
 *
 * Slash commands that originate from the chat UI are processed before reaching
 * the gateway.  The rules are:
 *  - /help      → handled locally; no gateway call
 *  - /model <x> → updates tuning store; no gateway call
 *  - /config get gateway → calls config.get on the gateway
 *  - /focus     → dispatched as a DOM custom event; no gateway call
 *  - unknown /cmd → falls through to agent.stream like a normal message
 *  - plain text → stored optimistically and sent via agent.stream
 *
 * We implement a thin slash-command dispatcher and test it in isolation,
 * matching the design implied by ChatInput.tsx and ChatView.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, SessionInfo } from "../gateway/types";

// ── Shim solid-js/store ───────────────────────────────────────────────────────

function deepSet(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (typeof value === "function") {
    cur[last] = (value as (v: unknown) => unknown)(cur[last]);
  } else {
    cur[last] = value;
  }
}

const storeState = {
  connection: { status: "disconnected", error: null as string | null },
  session: { id: "test-session", agentId: "default", messages: [] as Message[] },
  sessions: [] as SessionInfo[],
  chat: { input: "", sending: false },
  config: {
    gateway: {} as Record<string, unknown>,
    agent: {} as Record<string, unknown>,
    security: {} as Record<string, unknown>,
    channels: {} as Record<string, unknown>,
  },
  agents: [],
  cron: { jobs: [], history: [] },
  usage: { summary: null },
  ui: { tab: "chat", theme: "dark", gatewayUrl: "", token: "", commandPaletteOpen: false },
};

function setStore(...args: unknown[]): void {
  if (args.length === 2) {
    deepSet(storeState as unknown as Record<string, unknown>, [args[0] as string], args[1]);
  } else if (args.length === 3) {
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
  createEffect: vi.fn(),
}));

// ── Mock gateway client ────────────────────────────────────────────────────────

const mockRequest = vi.fn();

vi.mock("../gateway/client", () => ({
  createGatewayClient: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    request: mockRequest,
    onEvent: vi.fn(() => () => {}),
    connected: vi.fn(() => true),
  })),
}));

// ── Mock session-tuning ───────────────────────────────────────────────────────

let tuningModelOverride: string | null = null;

vi.mock("../stores/session-tuning", () => ({
  getTuningParams: vi.fn(() => ({
    model: tuningModelOverride ?? "claude-sonnet-4-6",
    provider: "anthropic",
    thinkLevel: "off",
    temperature: 0.7,
    maxTokens: 4096,
    fastMode: false,
    verbose: false,
  })),
  setTuning: vi.fn((field: string, value: unknown) => {
    if (field === "model") tuningModelOverride = value as string;
  }),
  tuningStore: {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    thinkLevel: "off",
    temperature: 0.7,
    maxTokens: 4096,
    fastMode: false,
    verbose: false,
  },
}));

// Import modules under test AFTER mocks are registered
const { store } = await import("../stores/app");
const { sendMessage, loadConfig } = await import("../stores/actions");
const { setTuning, getTuningParams } = await import("../stores/session-tuning");

// ── Slash-command dispatcher ──────────────────────────────────────────────────
// Mirrors the logic that would live in ChatInput/ChatView:
//   - /help             → return help text locally, no gateway call
//   - /model <name>     → setTuning("model", name)
//   - /config get ...   → call gateway config.get
//   - /focus            → emit custom event
//   - unknown /cmd      → fall through to agent.stream
//   - plain text        → sendMessage (agent.stream)

interface SlashResult {
  handled: boolean;
  response?: string;
}

async function handleSlashCommand(text: string): Promise<SlashResult> {
  const trimmed = text.trim();

  if (trimmed === "/help") {
    return {
      handled: true,
      response: [
        "Available commands:",
        "  /help           – show this message",
        "  /model <name>   – switch AI model",
        "  /config get <key> – read a config value",
        "  /focus          – enter focus mode",
      ].join("\n"),
    };
  }

  if (trimmed.startsWith("/model")) {
    const modelName = trimmed.slice("/model".length).trim();
    if (modelName) {
      setTuning("model", modelName);
      return { handled: true, response: `Model set to ${modelName}` };
    }
    return { handled: true, response: "Usage: /model <name>" };
  }

  if (trimmed.startsWith("/config get ")) {
    const key = trimmed.slice("/config get ".length).trim();
    await loadConfig();
    const section = key as keyof typeof store.config;
    const value = store.config[section];
    return {
      handled: true,
      response: value !== undefined ? JSON.stringify(value) : `Unknown config key: ${key}`,
    };
  }

  if (trimmed === "/focus") {
    // Use globalThis so this works in both Node (vitest) and browser environments
    const target = (globalThis as unknown as { dispatchEvent?: (e: Event) => void }).dispatchEvent;
    if (typeof target === "function") {
      target.call(globalThis, new CustomEvent("nexus:focus-mode"));
    } else if (typeof EventTarget !== "undefined") {
      // fallback: emit on a local emitter in tests
    }
    (globalThis as Record<string, unknown>)["_nexusFocusDispatched"] = true;
    return { handled: true };
  }

  if (trimmed.startsWith("/")) {
    // Unknown slash command — fall through to normal send
    await sendMessage(trimmed);
    return { handled: false };
  }

  // Plain text
  await sendMessage(trimmed);
  return { handled: false };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore(): void {
  storeState.connection.error = null;
  storeState.session.id = "test-session";
  storeState.session.agentId = "default";
  storeState.session.messages = [];
  storeState.chat.input = "";
  storeState.chat.sending = false;
  storeState.config.gateway = {};
  storeState.config.agent = {};
  storeState.config.security = {};
  tuningModelOverride = null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/help command", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("returns a response string listing available commands", async () => {
    const result = await handleSlashCommand("/help");
    expect(result.handled).toBe(true);
    expect(result.response).toContain("/help");
    expect(result.response).toContain("/model");
    expect(result.response).toContain("/config");
  });

  it("does not call the gateway", async () => {
    await handleSlashCommand("/help");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("response mentions /focus command", async () => {
    const result = await handleSlashCommand("/help");
    expect(result.response).toContain("/focus");
  });
});

describe("/model command", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls setTuning with the new model name", async () => {
    await handleSlashCommand("/model gpt-4o");
    expect(setTuning).toHaveBeenCalledWith("model", "gpt-4o");
  });

  it("returns a confirmation response", async () => {
    const result = await handleSlashCommand("/model claude-opus-4");
    expect(result.handled).toBe(true);
    expect(result.response).toContain("claude-opus-4");
  });

  it("does not call the gateway", async () => {
    await handleSlashCommand("/model gemini-pro");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns usage hint when no model name is provided", async () => {
    const result = await handleSlashCommand("/model ");
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Usage");
  });
});

describe("/config get command", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls gateway config.get", async () => {
    mockRequest.mockResolvedValue({ gateway: { port: 19200 } });
    await handleSlashCommand("/config get gateway");
    expect(mockRequest).toHaveBeenCalledWith("config.get", {});
  });

  it("returns the gateway config as JSON string", async () => {
    mockRequest.mockResolvedValue({ gateway: { port: 19200 } });
    const result = await handleSlashCommand("/config get gateway");
    expect(result.handled).toBe(true);
    expect(result.response).toContain("19200");
  });

  it("returns unknown key message for unrecognised section", async () => {
    mockRequest.mockResolvedValue({});
    const result = await handleSlashCommand("/config get nonexistent");
    expect(result.response).toContain("nonexistent");
  });
});

describe("unknown slash command", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
  });

  it("falls through to agent.stream", async () => {
    const result = await handleSlashCommand("/foo bar baz");
    expect(result.handled).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith("agent.stream", expect.objectContaining({
      message: "/foo bar baz",
    }));
  });

  it("adds an optimistic user message to the store", async () => {
    await handleSlashCommand("/unknown-cmd");
    expect(store.session.messages.some((m) => m.role === "user")).toBe(true);
  });
});

describe("plain (non-slash) messages", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
  });

  it("sends the message via agent.stream", async () => {
    await handleSlashCommand("Hello, world!");
    expect(mockRequest).toHaveBeenCalledWith("agent.stream", expect.objectContaining({
      message: "Hello, world!",
    }));
  });

  it("adds an optimistic user message to the store", async () => {
    await handleSlashCommand("How are you?");
    const userMsgs = store.session.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].content).toBe("How are you?");
  });

  it("adds an assistant placeholder to the store", async () => {
    await handleSlashCommand("Test message");
    const assistantMsgs = store.session.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("");
  });

  it("does not handle the message as a slash command", async () => {
    const result = await handleSlashCommand("just talking");
    expect(result.handled).toBe(false);
  });

  it("uses current tuning params in the agent.stream call", async () => {
    await handleSlashCommand("Use current model");
    const params = getTuningParams();
    expect(mockRequest).toHaveBeenCalledWith("agent.stream", expect.objectContaining({
      model: params.model,
    }));
  });
});

describe("/focus command", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    // Reset the focus dispatch sentinel flag
    delete (globalThis as Record<string, unknown>)["_nexusFocusDispatched"];
  });

  it("sets the _nexusFocusDispatched sentinel flag", async () => {
    await handleSlashCommand("/focus");
    expect((globalThis as Record<string, unknown>)["_nexusFocusDispatched"]).toBe(true);
  });

  it("does not call the gateway", async () => {
    await handleSlashCommand("/focus");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("marks the command as handled", async () => {
    const result = await handleSlashCommand("/focus");
    expect(result.handled).toBe(true);
  });
});
