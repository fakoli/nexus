import { getDb } from "./db.js";
import { events } from "./events.js";
import type { AuditEntry } from "./types.js";

export function recordAudit(
  eventType: string,
  actor?: string,
  details?: Record<string, unknown>,
): number {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO audit_log (event_type, actor, details) VALUES (?, ?, ?)",
    )
    .run(eventType, actor ?? null, details ? JSON.stringify(details) : null);
  events.emit("audit:entry", { eventType, actor });
  return result.lastInsertRowid as number;
}

type RawAuditRow = Omit<AuditEntry, "details"> & { details: string | null };

function deserializeAuditRows(rows: RawAuditRow[]): AuditEntry[] {
  return rows.map((r) => ({
    ...r,
    details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : undefined,
  }));
}

export function queryAudit(
  eventType?: string,
  limit = 100,
  offset = 0,
): AuditEntry[] {
  const db = getDb();
  if (eventType) {
    const rows = db
      .prepare(
        "SELECT id, event_type as eventType, actor, details, created_at as createdAt FROM audit_log WHERE event_type = ? ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .all(eventType, limit, offset) as RawAuditRow[];
    return deserializeAuditRows(rows);
  }
  const rows = db
    .prepare(
      "SELECT id, event_type as eventType, actor, details, created_at as createdAt FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset) as RawAuditRow[];
  return deserializeAuditRows(rows);
}
