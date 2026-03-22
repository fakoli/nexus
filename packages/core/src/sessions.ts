import { getDb } from "./db.js";
import { events } from "./events.js";
import type { Session, Message } from "./types.js";

export function createSession(
  id: string,
  agentId: string,
  channel?: string,
  peerId?: string,
): Session {
  const db = getDb();
  db.prepare(
    "INSERT INTO sessions (id, agent_id, channel, peer_id) VALUES (?, ?, ?, ?)",
  ).run(id, agentId, channel ?? null, peerId ?? null);
  events.emit("session:created", { sessionId: id, agentId });
  return getSession(id)!;
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, agent_id as agentId, channel, peer_id as peerId, state, metadata, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?",
    )
    .get(id) as (Session & { metadata: string | null }) | undefined;
  if (!row) return null;
  return {
    ...row,
    channel: row.channel ?? undefined,
    peerId: row.peerId ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

export function getOrCreateSession(
  id: string,
  agentId: string,
  channel?: string,
  peerId?: string,
): Session {
  const existing = getSession(id);
  if (existing) return existing;
  return createSession(id, agentId, channel, peerId);
}

export function listSessions(agentId?: string, state?: string): Session[] {
  const db = getDb();
  let sql = "SELECT id, agent_id as agentId, channel, peer_id as peerId, state, metadata, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE 1=1";
  const params: unknown[] = [];
  if (agentId) {
    sql += " AND agent_id = ?";
    params.push(agentId);
  }
  if (state) {
    sql += " AND state = ?";
    params.push(state);
  }
  sql += " ORDER BY updated_at DESC";
  const rows = db.prepare(sql).all(...params) as Array<Session & { metadata: string | null }>;
  return rows.map((r) => ({ ...r, metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined }));
}

export function appendMessage(
  sessionId: string,
  role: string,
  content: string,
  metadata?: Record<string, unknown>,
): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)",
    )
    .run(sessionId, role, content, metadata ? JSON.stringify(metadata) : null);
  db.prepare("UPDATE sessions SET updated_at = unixepoch() WHERE id = ?").run(sessionId);
  events.emit("session:message", { sessionId, role, content });
  return result.lastInsertRowid as number;
}

export function getMessages(sessionId: string, limit = 100, offset = 0): Message[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
    )
    .all(sessionId, limit, offset) as Array<Message & { metadata: string | null }>;
  return rows.map((r) => ({
    ...r,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
  }));
}

export function getMessageCount(sessionId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
    .get(sessionId) as { count: number };
  return row.count;
}
