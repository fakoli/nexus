/**
 * Memory module — persistent key-value memory for agents.
 *
 * Notes are scoped (global, per-agent, per-session) and optionally tagged
 * for retrieval. This gives agents long-term recall across conversations.
 */
import { getDb } from "./db.js";
import { createLogger } from "./logger.js";
import { randomUUID } from "node:crypto";

const log = createLogger("core:memory");

export interface MemoryNote {
  id: string;
  scope: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

function rowToNote(row: MemoryRow): MemoryNote {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    tags: row.tags ? JSON.parse(row.tags) as string[] : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Serialize tags as a JSON array for safe storage. */
function serializeTags(tags: string[]): string | null {
  return tags.length > 0 ? JSON.stringify(tags) : null;
}

/** Escape SQL LIKE wildcards so literal %, _, and \ are matched exactly. */
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Store a new memory note.
 */
export function addMemory(
  content: string,
  scope: string = "global",
  tags: string[] = [],
): MemoryNote {
  const db = getDb();
  const id = randomUUID();
  const tagStr = serializeTags(tags);
  db.prepare(
    `INSERT INTO memory_notes (id, scope, content, tags) VALUES (?, ?, ?, ?)`,
  ).run(id, scope, content, tagStr);
  log.info({ id, scope, tagCount: tags.length }, "Memory note stored");
  const note = getMemory(id);
  if (!note) {
    throw new Error(`Failed to read back memory note ${id} after insert`);
  }
  return note;
}

/**
 * Retrieve a memory note by ID.
 */
export function getMemory(id: string): MemoryNote | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM memory_notes WHERE id = ?").get(id) as MemoryRow | undefined;
  return row ? rowToNote(row) : null;
}

/**
 * Update an existing memory note's content or tags.
 */
export function updateMemory(
  id: string,
  updates: { content?: string; tags?: string[] },
): MemoryNote | null {
  const db = getDb();
  const existing = getMemory(id);
  if (!existing) return null;

  const content = updates.content ?? existing.content;
  const tags = updates.tags ?? existing.tags;
  const tagStr = serializeTags(tags);

  db.prepare(
    `UPDATE memory_notes SET content = ?, tags = ?, updated_at = unixepoch() WHERE id = ?`,
  ).run(content, tagStr, id);

  log.info({ id }, "Memory note updated");
  return getMemory(id);
}

/**
 * Delete a memory note.
 */
export function deleteMemory(id: string): boolean {
  const db = getDb();
  const changes = db.prepare("DELETE FROM memory_notes WHERE id = ?").run(id).changes;
  if (changes > 0) {
    log.info({ id }, "Memory note deleted");
  }
  return changes > 0;
}

/**
 * Search memory notes by scope and/or tags.
 */
export function searchMemory(options: {
  scope?: string;
  tags?: string[];
  query?: string;
  limit?: number;
}): MemoryNote[] {
  const db = getDb();
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (options.scope !== undefined) {
    conditions.push("scope = ?");
    params.push(options.scope);
  }

  if (options.tags && options.tags.length > 0) {
    // Tags are stored as JSON arrays, so search for the tag string within the JSON
    for (const tag of options.tags) {
      conditions.push("tags LIKE ? ESCAPE '\\'");
      params.push(`%${JSON.stringify(escapeLike(tag))}%`);
    }
  }

  if (options.query !== undefined) {
    conditions.push("content LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(options.query)}%`);
  }

  const limit = options.limit ?? 50;

  const sql = `SELECT * FROM memory_notes WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as MemoryRow[];
  return rows.map(rowToNote);
}

/**
 * List all memory notes for a scope.
 */
export function listMemory(scope: string = "global", limit: number = 100): MemoryNote[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM memory_notes WHERE scope = ? ORDER BY updated_at DESC LIMIT ?",
  ).all(scope, limit) as MemoryRow[];
  return rows.map(rowToNote);
}

/**
 * Count memory notes in a scope.
 */
export function countMemory(scope?: string): number {
  const db = getDb();
  if (scope !== undefined) {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM memory_notes WHERE scope = ?").get(scope) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare("SELECT COUNT(*) as cnt FROM memory_notes").get() as { cnt: number };
  return row.cnt;
}
