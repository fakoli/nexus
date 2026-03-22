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
  | "config.set";

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

// ── Connection state ──────────────────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type TabName = "chat" | "sessions" | "config";

export type ThemeName = "dark" | "light";
