import { getDb } from "./db.js";

export function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db.transaction(() => {
    const row = db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").get(key) as
      | { count: number; window_start: number }
      | undefined;

    if (!row || now - row.window_start >= windowSeconds) {
      db.prepare(
        "INSERT INTO rate_limits (key, count, window_start, window_seconds) VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start",
      ).run(key, now, windowSeconds);
      return true;
    }

    if (row.count >= limit) {
      return false;
    }

    db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
    return true;
  })();
}

export function resetRateLimit(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
}
