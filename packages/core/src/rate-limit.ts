import { z } from "zod";
import { getDb } from "./db.js";

export const RateLimitProfileSchema = z.object({
  name: z.string(),
  requestsPerMinute: z.number().min(1).default(60),
  requestsPerHour: z.number().min(1).default(1000),
  burstSize: z.number().min(1).default(10),
});

export type RateLimitProfile = z.infer<typeof RateLimitProfileSchema>;

export interface RateLimitStatus {
  key: string;
  count: number;
  windowSeconds: number;
  windowStart: number;
  windowRemaining: number;
  exceeded: boolean;
}

export function getRateLimitStatus(key: string): RateLimitStatus | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare("SELECT count, window_start, window_seconds FROM rate_limits WHERE key = ?")
    .get(key) as { count: number; window_start: number; window_seconds: number } | undefined;

  if (!row) return null;

  const windowAge = now - row.window_start;
  const windowExpired = windowAge >= row.window_seconds;
  const windowRemaining = windowExpired ? row.window_seconds : row.window_seconds - windowAge;

  return {
    key,
    count: windowExpired ? 0 : row.count,
    windowSeconds: row.window_seconds,
    windowStart: row.window_start,
    windowRemaining,
    exceeded: false, // no limit stored here — needs external limit for comparison
  };
}

export function checkRateLimitWithProfile(
  key: string,
  profile: RateLimitProfile,
): boolean {
  // Enforce both per-minute and per-hour windows using compound keys
  const minuteKey = `${key}:1m`;
  const hourKey = `${key}:1h`;
  const minuteOk = checkRateLimit(minuteKey, profile.requestsPerMinute, 60);
  const hourOk = checkRateLimit(hourKey, profile.requestsPerHour, 3600);
  return minuteOk && hourOk;
}

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
