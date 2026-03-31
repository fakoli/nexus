/**
 * Barrel re-export — keeps the old `../stores/app` import path working while
 * the actual state lives in focused domain stores.
 */
import { createStore } from "solid-js/store";
import { createGatewayClient } from "../gateway/client";
import { DEFAULT_GATEWAY_URL } from "../constants";
import type {
  Agent,
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
import type { ConnectionStatus } from "../gateway/types";

// ── Re-export domain stores ───────────────────────────────────────────────────

export {
  connectionStore,
  setConnectionStore,
  setConnectionStatus,
  setConnectionError,
  setGatewayUrl,
  setToken,
} from "./connection-store";

export {
  sessionStore,
  setSessionStore,
  sessionsListStore,
  setSessionsListStore,
  appendMessage,
  updateLastMessage,
  setCurrentSession,
} from "./session-store";

export {
  agentStore,
  setAgentStore,
  setAgents,
  setCurrentAgent,
} from "./agent-store";

export {
  configStore,
  setConfigStore,
  setConfigSection,
} from "./config-store";

export {
  cronStore,
  setCronStore,
  setCronJobs,
  setCronHistory,
} from "./cron-store";

export {
  usageStore,
  setUsageStore,
  setUsageSummary,
} from "./usage-store";

export {
  federationStore,
  setFederationStore,
  upsertPeer,
  setPeerDisconnected,
  setFederationEnabled,
} from "./federation-store";

export {
  speechStore,
  setSpeechStore,
  setVoices,
  setTtsEnabled,
  setSttEnabled,
} from "./speech-store";

export {
  uiStore,
  setUiStore,
  setCommandPaletteOpen,
} from "./ui-store";
import { setTab as _setTab, setTheme as _setTheme } from "./ui-store";

// ── Monolithic AppStore shape (preserved for backwards-compatibility) ─────────

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

gateway.onEvent("session:created", (payload) => {
  const p = payload as { id?: string; agentId?: string };
  setStore("connection", "status", "connected");
  setStore("connection", "error", null);
  if (p.id) setStore("session", "id", p.id);
  if (p.agentId) setStore("session", "agentId", p.agentId);
});

gateway.onEvent("session:message", (payload) => {
  const msg = payload as unknown as Message;
  setStore("session", "messages", (msgs) => [...msgs, msg]);
});

gateway.onEvent("config:changed", (payload) => {
  const p = payload as { key: string; value: unknown };
  if (p.key === "gateway") setStore("config", "gateway", p.value as Record<string, unknown>);
  else if (p.key === "agent") setStore("config", "agent", p.value as Record<string, unknown>);
  else if (p.key === "security") setStore("config", "security", p.value as Record<string, unknown>);
});

gateway.onEvent("agent:delta", (payload) => {
  const p = payload as { sessionId?: string; type: string; text?: string };
  if (p.type === "text" && typeof p.text === "string") {
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

// ── Simple helpers (exported for convenience) ─────────────────────────────────

export function setChatInput(value: string): void {
  setStore("chat", "input", value);
}

export function setTab(tab: TabName): void {
  _setTab(tab);
  setStore("ui", "tab", tab);
}

export function setTheme(theme: ThemeName): void {
  _setTheme(theme);
  setStore("ui", "theme", theme);
}
