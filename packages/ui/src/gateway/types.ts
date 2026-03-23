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
  | "usage.timeseries";

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
  | "agent:delta";

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

// ── Connection state ──────────────────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type TabName = "chat" | "sessions" | "config" | "agents" | "cron" | "analytics";

export type ThemeName = "dark" | "light";
