import { gateway, setStore, store } from "./app";
import { getTuningParams } from "./session-tuning";
import type { Message, SessionInfo } from "../gateway/types";

// ── chat.send / agent.run ─────────────────────────────────────────────────────

/**
 * Appends the user message optimistically, creates an empty assistant
 * placeholder, then calls `agent.stream` to let the server stream deltas.
 * The `agent:delta` event handler in app.ts appends text chunks to the
 * placeholder and clears `sending` on `type: "done"`.
 */
export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || store.chat.sending) return;

  // Optimistic user message
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: trimmed,
    timestamp: Date.now(),
  };

  // Placeholder assistant message — deltas will be appended to this
  const assistantPlaceholder: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  };

  setStore("session", "messages", (msgs) => [...msgs, userMsg, assistantPlaceholder]);
  setStore("chat", "input", "");
  setStore("chat", "sending", true);

  try {
    await gateway.request("agent.stream", {
      sessionId: store.session.id,
      message: trimmed,
      ...getTuningParams(),
    });
    // `sending` will be set to false by the agent:delta { type: "done" } event
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    setStore("chat", "sending", false);
  }
}

// ── chat.history ──────────────────────────────────────────────────────────────

/**
 * Loads message history for the current session and replaces the local list.
 */
export async function loadHistory(): Promise<void> {
  try {
    const payload = await gateway.request("chat.history", {
      sessionId: store.session.id,
    });
    const messages = (payload.messages as Message[] | undefined) ?? [];
    setStore("session", "messages", messages);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── sessions.list ─────────────────────────────────────────────────────────────

/**
 * Fetches all available sessions from the server.
 */
export async function loadSessions(): Promise<void> {
  try {
    const payload = await gateway.request("sessions.list", {});
    const sessions = (payload.sessions as SessionInfo[] | undefined) ?? [];
    setStore("sessions", sessions);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── config.get ────────────────────────────────────────────────────────────────

/**
 * Fetches the full server configuration and merges it into the store.
 */
export async function loadConfig(): Promise<void> {
  try {
    const payload = await gateway.request("config.get", {});
    const cfg = payload as {
      gateway?: Record<string, unknown>;
      agent?: Record<string, unknown>;
      security?: Record<string, unknown>;
    };
    if (cfg.gateway) setStore("config", "gateway", cfg.gateway);
    if (cfg.agent) setStore("config", "agent", cfg.agent);
    if (cfg.security) setStore("config", "security", cfg.security);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── config.set ────────────────────────────────────────────────────────────────

/**
 * Saves a single config section to the server and updates the local store on
 * success.
 */
export async function saveConfig(
  section: "gateway" | "agent" | "security",
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await gateway.request("config.set", { section, value: data });
    setStore("config", section, data);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── sessions.create ───────────────────────────────────────────────────────────

/**
 * Creates a new server session and navigates to the chat tab.
 */
export async function createNewSession(): Promise<void> {
  try {
    const payload = await gateway.request("sessions.create", { agentId: "default" });
    const sessionId = payload.id as string | undefined;
    if (sessionId) {
      setStore("session", "id", sessionId);
      setStore("session", "agentId", "default");
      setStore("session", "messages", []);
    }
    setStore("ui", "tab", "chat");
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── connect + authenticate ───────────────────────────────────────────────────

/**
 * Called from App.tsx on mount / createEffect when credentials are available.
 * Non-throwing — errors go into the store.
 */
export function initGateway(url: string, token: string): void {
  connectAndAuthenticate(url, token).catch(() => {
    // error already stored by connectAndAuthenticate
  });
}

export async function connectAndAuthenticate(url: string, token: string): Promise<void> {
  setStore("connection", "status", "connecting");
  setStore("connection", "error", null);

  try {
    await gateway.connect(url, token);
    // The gateway client emits session:created on HelloOk which updates the store
  } catch (err) {
    setStore("connection", "status", "disconnected");
    setStore("connection", "error", (err as Error).message);
    throw err;
  }
}

// ── Re-export store helpers so consumers only need one import ─────────────────

export { setTab, setTheme, setChatInput } from "./app";
