import { getDb } from "./db.js";
import type { Agent } from "./types.js";

export function createAgent(id: string, config: Record<string, unknown> = {}): Agent {
  const db = getDb();
  db.prepare("INSERT INTO agents (id, config) VALUES (?, ?)").run(id, JSON.stringify(config));
  return getAgent(id)!;
}

export function getAgent(id: string): Agent | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, config, created_at as createdAt, updated_at as updatedAt FROM agents WHERE id = ?")
    .get(id) as (Omit<Agent, "config"> & { config: string }) | undefined;
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config) };
}

export function getOrCreateAgent(id: string, config: Record<string, unknown> = {}): Agent {
  const existing = getAgent(id);
  if (existing) return existing;
  return createAgent(id, config);
}

export function listAgents(): Agent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, config, created_at as createdAt, updated_at as updatedAt FROM agents ORDER BY created_at DESC")
    .all() as Array<Omit<Agent, "config"> & { config: string }>;
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) }));
}

export function updateAgent(id: string, config: Record<string, unknown>): void {
  const db = getDb();
  db.prepare("UPDATE agents SET config = ?, updated_at = unixepoch() WHERE id = ?").run(
    JSON.stringify(config),
    id,
  );
}
