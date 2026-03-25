// Protocol version
export const PROTO_VERSION = 1;

// ── Outbound (client → server) ────────────────────────────────────────────────

export interface ConnectParams {
  token: string;
  password: string;
  client: { name: string; version: string };
}

export type RequestMethod =
  | "chat.send"
  | "chat.history"
  | "agent.run"
  | "agent.stream"
  | "sessions.list"
  | "sessions.create"
  | "config.get"
  | "config.set"
  | "agents.list"
  | "agents.get"
  | "agents.create"
  | "agents.update"
  | "agents.delete"
  | "agents.bootstrap.get"
  | "agents.bootstrap.set"
  | "cron.list"
  | "cron.create"
  | "cron.update"
  | "cron.delete"
  | "cron.run"
  | "cron.history"
  | "usage.summary"
  | "usage.by-session"
  | "usage.by-model"
  | "usage.timeseries"
  | "gateway.status"
  | "security.audit"
  | "plugins.list"
  | "plugins.install"
  | "plugins.uninstall"
  | "plugins.search"
  | "speech.tts"
  | "speech.stt"
  | "speech.voices"
  // Federation
  | "federation.peers"
  | "federation.connect"
  | "federation.disconnect"
  | "federation.status"
  // Skills
  | "skills.list"
  | "skills.install"
  | "skills.search";

export interface RequestFrame {
  id: string;
  method: RequestMethod;
  params: Record<string, unknown>;
}

// ── Inbound (server → client) ─────────────────────────────────────────────────

export interface HelloOk {
  proto: number;
  server: { name: string; version: string };
  session: { id: string; agentId: string };
}

export interface ResponseFrame {
  id: string;
  ok: boolean;
  payload: Record<string, unknown>;
  error?: { code: string; message: string };
}

export type EventName =
  | "session:message"
  | "session:created"
  | "config:changed"
  | "agent:delta"
  | "log"
  | "federation:peer:connected"
  | "federation:peer:disconnected"
  | "federation:message:received"
  | "federation:message:forwarded"
  | "speech:tts"
  | "speech:stt";

export interface EventFrame {
  event: EventName;
  payload: Record<string, unknown>;
  seq: number;
}

// ── Domain types ──────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  createdAt: number;
  messageCount: number;
}

export interface ConfigSection {
  gateway: Record<string, unknown>;
  agent: Record<string, unknown>;
  security: Record<string, unknown>;
}

// ── Agent types ────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  createdAt: number;
}

// ── Cron types ─────────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  agentId: string;
  prompt: string;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
}

export interface CronRunHistory {
  id: string;
  jobId: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "success" | "error";
  error: string | null;
}

// ── Usage types ────────────────────────────────────────────────────────────────

export interface UsageSummary {
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  byModel: Record<string, { tokens: number; cost: number; requests: number }>;
  periodStart: number;
  periodEnd: number;
}

// ── Plugin types ───────────────────────────────────────────────────────────────

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  status: "active" | "disabled" | "error";
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
}

// ── Connection state ──────────────────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type TabName = "overview" | "chat" | "sessions" | "config" | "agents" | "cron" | "analytics" | "plugins" | "logs" | "debug" | "federation" | "skills";

// ── Gateway status types ───────────────────────────────────────────────────────

export interface GatewayStatus {
  uptime: number;
  version: string;
  connectedClients: number;
  activeSessions: number;
  totalMessages: number;
}

// ── Log entry type ─────────────────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
}

export type ThemeName = "dark" | "light";

// ── Federation types ──────────────────────────────────────────────────────────

export interface FederatedPeer {
  gatewayId: string;
  gatewayName: string;
  direction: "inbound" | "outbound";
  status: "connecting" | "connected" | "disconnected";
  connectedAt?: number;
}

// ── Speech types ──────────────────────────────────────────────────────────────

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  format?: "mp3" | "opus" | "wav";
}

export interface STTRequest {
  audio: string; // base64
  language?: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
}

// ── Skill types ───────────────────────────────────────────────────────────────

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  source: "bundled" | "managed" | "workspace";
}
