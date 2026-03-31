import type { HelloOk, ResponseFrame, EventFrame } from "./types";

// ── Runtime validation helpers for gateway wire messages ──────────────────────
// Zod is not in the UI bundle; use plain TypeScript type guards instead.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── HelloOk ───────────────────────────────────────────────────────────────────

export function parseHelloOk(obj: unknown): HelloOk | undefined {
  if (!isRecord(obj)) {
    console.warn("[nexus-client] HelloOk: expected object, got", typeof obj);
    return undefined;
  }
  if (typeof obj["proto"] !== "number") {
    console.warn("[nexus-client] HelloOk: missing or invalid proto field");
    return undefined;
  }
  if (!isRecord(obj["session"]) || typeof (obj["session"] as Record<string, unknown>)["id"] !== "string") {
    console.warn("[nexus-client] HelloOk: missing or invalid session field");
    return undefined;
  }
  if (!isRecord(obj["server"])) {
    console.warn("[nexus-client] HelloOk: missing server field");
    return undefined;
  }
  return obj as unknown as HelloOk;
}

// ── ResponseFrame ─────────────────────────────────────────────────────────────

export function parseResponseFrame(obj: unknown): ResponseFrame | undefined {
  if (!isRecord(obj)) {
    console.warn("[nexus-client] ResponseFrame: expected object, got", typeof obj);
    return undefined;
  }
  if (typeof obj["id"] !== "string") {
    console.warn("[nexus-client] ResponseFrame: missing or invalid id field");
    return undefined;
  }
  if (typeof obj["ok"] !== "boolean") {
    console.warn("[nexus-client] ResponseFrame: missing or invalid ok field");
    return undefined;
  }
  const payload = obj["payload"];
  if (payload !== undefined && payload !== null && !isRecord(payload)) {
    console.warn("[nexus-client] ResponseFrame: payload must be an object if present");
    return undefined;
  }
  return {
    id:      obj["id"] as string,
    ok:      obj["ok"] as boolean,
    payload: (isRecord(payload) ? payload : {}) as Record<string, unknown>,
    error:   isRecord(obj["error"])
      ? { code: String(obj["error"]["code"] ?? ""), message: String(obj["error"]["message"] ?? "") }
      : undefined,
  };
}

// ── EventFrame ────────────────────────────────────────────────────────────────

export function parseEventFrame(obj: unknown): EventFrame | undefined {
  if (!isRecord(obj)) {
    console.warn("[nexus-client] EventFrame: expected object, got", typeof obj);
    return undefined;
  }
  if (typeof obj["event"] !== "string") {
    console.warn("[nexus-client] EventFrame: missing or invalid event field");
    return undefined;
  }
  if (typeof obj["seq"] !== "number") {
    console.warn("[nexus-client] EventFrame: missing or invalid seq field");
    return undefined;
  }
  const payload = obj["payload"];
  return {
    event:   obj["event"] as EventFrame["event"],
    seq:     obj["seq"] as number,
    payload: (isRecord(payload) ? payload : {}) as Record<string, unknown>,
  };
}
