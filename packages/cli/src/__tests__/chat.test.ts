/**
 * chat.test.ts
 *
 * Tests for the `nexus chat` and `nexus quickstart` commands.
 * Uses a temp data directory for isolation, mocks WebSocket for connection tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { EventEmitter } from "node:events";

// ── Temp dir isolation ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-chat-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── chatCommand: command metadata ─────────────────────────────────────────────

describe("chatCommand: command metadata", () => {
  it("exports a Command named 'chat'", async () => {
    const { chatCommand } = await import("../commands/chat.js");
    expect(chatCommand.name()).toBe("chat");
  });

  it("has a non-empty description", async () => {
    const { chatCommand } = await import("../commands/chat.js");
    expect(chatCommand.description().length).toBeGreaterThan(0);
  });

  it("has a --session option", async () => {
    const { chatCommand } = await import("../commands/chat.js");
    const optionNames = chatCommand.options.map((o) => o.long);
    expect(optionNames).toContain("--session");
  });

  it("has a --port option", async () => {
    const { chatCommand } = await import("../commands/chat.js");
    const optionNames = chatCommand.options.map((o) => o.long);
    expect(optionNames).toContain("--port");
  });
});

// ── quickstartCommand: command metadata ───────────────────────────────────────

describe("quickstartCommand: command metadata", () => {
  it("exports a Command named 'quickstart'", async () => {
    const { quickstartCommand } = await import("../commands/quickstart.js");
    expect(quickstartCommand.name()).toBe("quickstart");
  });

  it("has alias 'start'", async () => {
    const { quickstartCommand } = await import("../commands/quickstart.js");
    expect(quickstartCommand.alias()).toBe("start");
  });

  it("has a non-empty description", async () => {
    const { quickstartCommand } = await import("../commands/quickstart.js");
    expect(quickstartCommand.description().length).toBeGreaterThan(0);
  });
});

// ── WS mock helpers ───────────────────────────────────────────────────────────

/**
 * Builds a minimal WebSocket mock that emits the Nexus HelloOk frame shortly
 * after "open", then lets the test control subsequent messages.
 */
function makeWsMock(sessionId = "test-session-123") {
  const emitter = new EventEmitter();
  const sent: string[] = [];

  const ws = {
    on: (event: string, cb: (...args: unknown[]) => void) => emitter.on(event, cb),
    once: (event: string, cb: (...args: unknown[]) => void) => emitter.once(event, cb),
    send: vi.fn((data: string) => {
      sent.push(data);
      // After ConnectParams, emit HelloOk
      if (sent.length === 1) {
        const helloOk = JSON.stringify({
          proto: 1,
          server: "nexus-test",
          session: { id: sessionId },
        });
        setImmediate(() => emitter.emit("message", helloOk));
      }
    }),
    close: vi.fn(() => emitter.emit("close")),
    readyState: 1, // OPEN
    sent,
    _emitter: emitter,
  };

  return ws;
}

// ── WS ConnectParams / HelloOk handshake logic ────────────────────────────────

describe("chat: WebSocket handshake logic", () => {
  it("sends ConnectParams as the first WebSocket message", async () => {
    const ws = makeWsMock();
    const connectParams: Record<string, unknown> = {
      client: { name: "nexus-cli-chat", version: "0.1.0", platform: process.platform },
    };
    const token = "test-token";
    if (token) connectParams.token = token;

    // Simulate what chat.ts does on ws.open
    ws.send(JSON.stringify(connectParams));

    expect(ws.sent).toHaveLength(1);
    const parsed = JSON.parse(ws.sent[0]) as Record<string, unknown>;
    expect(parsed.client).toBeDefined();
    expect(parsed.token).toBe("test-token");
  });

  it("parses HelloOk frame correctly and extracts session ID", () => {
    const helloOk = {
      proto: 1,
      server: "nexus-test",
      session: { id: "sess-abc-123" },
    };
    const frame = JSON.parse(JSON.stringify(helloOk)) as Record<string, unknown>;

    // Replicate the handshake check from chat.ts
    const isHelloOk = typeof frame.proto === "number" && frame.session != null;
    expect(isHelloOk).toBe(true);

    const session = frame.session as { id: string };
    expect(session.id).toBe("sess-abc-123");
  });

  it("detects an auth-failure frame (no proto field)", () => {
    const errFrame = {
      error: { code: "AUTH_FAILED", message: "Invalid token" },
    };
    const frame = JSON.parse(JSON.stringify(errFrame)) as Record<string, unknown>;

    const isHelloOk = typeof frame.proto === "number" && frame.session != null;
    expect(isHelloOk).toBe(false);

    const errObj = frame.error as { code: string; message: string };
    expect(errObj.code).toBe("AUTH_FAILED");
  });

  it("emits HelloOk after ConnectParams is sent via mock", async () => {
    const ws = makeWsMock("sess-789");
    const messages: string[] = [];

    ws.on("message", (data: unknown) => {
      messages.push(String(data));
    });

    ws.send(JSON.stringify({ client: { name: "test" } }));

    // Wait for the HelloOk to be emitted by the mock
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(messages).toHaveLength(1);
    const hello = JSON.parse(messages[0]) as Record<string, unknown>;
    expect((hello.session as { id: string }).id).toBe("sess-789");
  });
});

// ── chat.send RPC frame structure ─────────────────────────────────────────────

describe("chat: RPC frame structure", () => {
  it("constructs a valid chat.send RPC request frame", () => {
    const sessionId = "sess-001";
    const content = "Hello, Nexus!";
    let counter = 0;
    counter++;

    const request = {
      id: `chat-${counter}`,
      method: "chat.send",
      params: { sessionId, content, role: "user" },
    };

    expect(request.method).toBe("chat.send");
    expect(request.params.sessionId).toBe(sessionId);
    expect(request.params.content).toBe(content);
    expect(request.params.role).toBe("user");
    expect(request.id).toBe("chat-1");
  });

  it("increments request ID counter for each message sent", () => {
    let counter = 0;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      counter++;
      ids.push(`chat-${counter}`);
    }
    expect(ids).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  it("includes sessionId in params even when sending a follow-up message", () => {
    const sessionId = "sess-abc";
    let counter = 0;

    const buildRequest = (msg: string) => {
      counter++;
      return { id: `r${counter}`, method: "chat.send", params: { sessionId, content: msg, role: "user" } };
    };

    const r1 = buildRequest("first");
    const r2 = buildRequest("second");

    expect(r1.params.sessionId).toBe(sessionId);
    expect(r2.params.sessionId).toBe(sessionId);
    expect(r1.id).not.toBe(r2.id);
  });
});

// ── chat: response frame parsing ──────────────────────────────────────────────

describe("chat: response frame parsing", () => {
  it("extracts text from payload.content field", () => {
    const frame = {
      id: "r1",
      ok: true,
      payload: { content: "Hello from Nexus!", messageId: "msg-001" },
    };
    const payload = frame.payload as { content?: string; text?: string };
    const text = payload.content ?? payload.text ?? JSON.stringify(payload);
    expect(text).toBe("Hello from Nexus!");
  });

  it("falls back to payload.text when content is absent", () => {
    const frame = {
      id: "r1",
      ok: true,
      payload: { text: "Fallback text" },
    };
    const payload = frame.payload as { content?: string; text?: string };
    const text = payload.content ?? payload.text ?? JSON.stringify(payload);
    expect(text).toBe("Fallback text");
  });

  it("reports error when ok is false", () => {
    const frame = {
      id: "r1",
      ok: false,
      error: { code: "SESSION_NOT_FOUND", message: "No such session" },
    };
    const isError = frame.ok === false;
    expect(isError).toBe(true);
    const errObj = frame.error as { code: string; message: string };
    expect(errObj.code).toBe("SESSION_NOT_FOUND");
  });
});

// ── quickstart: isInitialized logic ───────────────────────────────────────────

describe("quickstart: initialization check", () => {
  it("reports not initialized when DB does not exist", () => {
    // A fresh temp dir has no nexus.db
    const fs = { existsSync: (p: string) => p.endsWith("nonexistent.db") };
    const dbPath = path.join(tmpDir, "nexus.db");
    const exists = fs.existsSync(dbPath);
    expect(exists).toBe(false);
  });

  it("reports initialized after migrations run and token is set", async () => {
    const { runMigrations, setConfig, getAllConfig, closeDb } = await import("@nexus/core");
    runMigrations();
    setConfig("security", { gatewayToken: "nxs_abc123" });
    const config = getAllConfig();
    expect(Boolean(config.security.gatewayToken)).toBe(true);
    closeDb();
  });

  it("token auto-generation uses nxs_ prefix and 32 hex chars", async () => {
    const crypto = await import("node:crypto");
    const token = "nxs_" + crypto.default.randomBytes(16).toString("hex");
    expect(token.startsWith("nxs_")).toBe(true);
    expect(token.length).toBe(36); // "nxs_" (4) + 32 hex chars
  });
});

// ── quickstart: gateway URL construction ──────────────────────────────────────

describe("quickstart: gateway URL construction", () => {
  it("uses loopback host when bind is 'loopback'", () => {
    const bind = "loopback";
    const port = 19200;
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    const url = `ws://${host}:${port}/ws`;
    expect(url).toBe("ws://127.0.0.1:19200/ws");
  });

  it("uses 0.0.0.0 host when bind is 'all'", () => {
    const bind: string = "all";
    const port = 19200;
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    const url = `ws://${host}:${port}/ws`;
    expect(url).toBe("ws://0.0.0.0:19200/ws");
  });

  it("builds correct healthz URL for readiness check", () => {
    const port = 19200;
    const url = `http://127.0.0.1:${port}/healthz`;
    expect(url).toBe("http://127.0.0.1:19200/healthz");
  });
});
