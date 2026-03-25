import { createStore } from "solid-js/store";
import { createGatewayClient } from "../gateway/client";
import { DEFAULT_GATEWAY_URL } from "../constants";
import type {
  Agent,
  ConnectionStatus,
  CronJob,
  CronRunHistory,
  FederatedPeer,
  Message,
  SessionInfo,
  SkillInfo,
  TabName,
  ThemeName,
  UsageSummary,
  VoiceInfo,
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
    channels: Record<string, unknown>;
  };
  agents: Agent[];
  cron: {
    jobs: CronJob[];
    history: CronRunHistory[];
  };
  usage: {
    summary: UsageSummary | null;
  };
  federation: {
    peers: FederatedPeer[];
    enabled: boolean;
  };
  speech: {
    voices: VoiceInfo[];
    ttsEnabled: boolean;
    sttEnabled: boolean;
  };
  skills: {
    available: SkillInfo[];
  };
  ui: {
    tab: TabName;
    theme: ThemeName;
    gatewayUrl: string;
    token: string;
    commandPaletteOpen: boolean;
  };
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState: AppStore = {
  connection: { status: "disconnected", error: null },
  session: { id: "", agentId: "", messages: [] },
  sessions: [],
  chat: { input: "", sending: false },
  config: { gateway: {}, agent: {}, security: {}, channels: {} },
  agents: [],
  cron: { jobs: [], history: [] },
  usage: { summary: null },
  federation: { peers: [], enabled: false },
  speech: { voices: [], ttsEnabled: false, sttEnabled: false },
  skills: { available: [] },
  ui: { tab: "overview", theme: "dark", gatewayUrl: "", token: "", commandPaletteOpen: false },
};

export const [store, setStore] = createStore<AppStore>(initialState);

// ── Gateway client singleton ──────────────────────────────────────────────────

export const gateway = createGatewayClient(
  DEFAULT_GATEWAY_URL,
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
  const msg = payload as unknown as Message;
  setStore("session", "messages", (msgs) => [...msgs, msg]);
});

// config:changed pushed by the server
gateway.onEvent("config:changed", (payload) => {
  const p = payload as { key: string; value: unknown };
  if (p.key === "gateway") setStore("config", "gateway", p.value as Record<string, unknown>);
  else if (p.key === "agent") setStore("config", "agent", p.value as Record<string, unknown>);
  else if (p.key === "security") setStore("config", "security", p.value as Record<string, unknown>);
});

// agent:delta — streaming text chunks from agent.stream
gateway.onEvent("agent:delta", (payload) => {
  const p = payload as { sessionId?: string; type: string; text?: string };
  if (p.type === "text" && typeof p.text === "string") {
    // Append text to the last assistant message placeholder
    setStore("session", "messages", (msgs) => {
      if (msgs.length === 0) return msgs;
      const last = msgs[msgs.length - 1];
      if (last.role !== "assistant") return msgs;
      const updated = { ...last, content: last.content + p.text };
      return [...msgs.slice(0, -1), updated];
    });
  } else if (p.type === "done") {
    setStore("chat", "sending", false);
  }
});

// federation:peer:connected — a peer has connected
gateway.onEvent("federation:peer:connected", (payload) => {
  const p = payload as { gatewayId: string; gatewayName: string; direction: FederatedPeer["direction"] };
  const peer: FederatedPeer = {
    ...p,
    status: "connected",
    connectedAt: Date.now(),
  };
  setStore("federation", "peers", (peers) => {
    const filtered = peers.filter((existing) => existing.gatewayId !== peer.gatewayId);
    return [...filtered, peer];
  });
});

// federation:peer:disconnected — a peer has disconnected
gateway.onEvent("federation:peer:disconnected", (payload) => {
  const p = payload as { gatewayId?: string };
  if (p.gatewayId) {
    setStore("federation", "peers", (peers) =>
      peers.map((peer) =>
        peer.gatewayId === p.gatewayId ? { ...peer, status: "disconnected" as const } : peer,
      ),
    );
  }
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
