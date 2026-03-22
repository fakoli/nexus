import { createStore } from "solid-js/store";
import { createGatewayClient } from "../gateway/client";
import type {
  ConnectionStatus,
  Message,
  SessionInfo,
  TabName,
  ThemeName,
} from "../gateway/types";

// ── Store shape ───────────────────────────────────────────────────────────────

export interface AppStore {
  connection: {
    status: ConnectionStatus;
    error: string | null;
  };
  session: {
    id: string;
    agentId: string;
    messages: Message[];
  };
  sessions: SessionInfo[];
  chat: {
    input: string;
    sending: boolean;
  };
  config: {
    gateway: Record<string, unknown>;
    agent: Record<string, unknown>;
    security: Record<string, unknown>;
  };
  ui: {
    tab: TabName;
    theme: ThemeName;
    gatewayUrl: string;
    token: string;
  };
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState: AppStore = {
  connection: { status: "disconnected", error: null },
  session: { id: "", agentId: "", messages: [] },
  sessions: [],
  chat: { input: "", sending: false },
  config: { gateway: {}, agent: {}, security: {} },
  ui: { tab: "chat", theme: "dark", gatewayUrl: "", token: "" },
};

export const [store, setStore] = createStore<AppStore>(initialState);

// ── Gateway client singleton ──────────────────────────────────────────────────

export const gateway = createGatewayClient(
  "ws://localhost:18789/ws",
  import.meta.env.VITE_NEXUS_TOKEN ?? "",
  import.meta.env.VITE_NEXUS_PASSWORD ?? "",
);

// ── Wire gateway events into the store ───────────────────────────────────────

// session:created fires when the HelloOk handshake completes
gateway.onEvent("session:created", (payload) => {
  const p = payload as { id?: string; agentId?: string };
  setStore("connection", "status", "connected");
  setStore("connection", "error", null);
  if (p.id) setStore("session", "id", p.id);
  if (p.agentId) setStore("session", "agentId", p.agentId);
});

// session:message pushed by the server
gateway.onEvent("session:message", (payload) => {
  const msg = payload as Message;
  setStore("session", "messages", (msgs) => [...msgs, msg]);
});

// config:changed pushed by the server
gateway.onEvent("config:changed", (payload) => {
  const p = payload as Partial<AppStore["config"]>;
  if (p.gateway) setStore("config", "gateway", p.gateway);
  if (p.agent) setStore("config", "agent", p.agent);
  if (p.security) setStore("config", "security", p.security);
});

// ── Simple tab/theme helpers (no async, exported for convenience) ─────────────

export function setTab(tab: TabName): void {
  setStore("ui", "tab", tab);
}

export function setTheme(theme: ThemeName): void {
  setStore("ui", "theme", theme);
}

export function setChatInput(value: string): void {
  setStore("chat", "input", value);
}

export function setConnectionError(error: string | null): void {
  setStore("connection", "error", error);
  if (error) setStore("connection", "status", "disconnected");
}
