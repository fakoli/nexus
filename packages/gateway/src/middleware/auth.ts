/**
 * Authentication middleware for the Nexus WebSocket gateway.
 *
 * Supports token-based and password-based auth with rate limiting and
 * audit logging, all backed by @nexus/core primitives.
 */
import {
  timingSafeEqual,
  checkRateLimit,
  recordAudit,
  getAllConfig,
  createLogger,
  events,
} from "@nexus/core";
import type { ConnectParams } from "../protocol/frames.js";

const log = createLogger("gateway:auth");

/** Maximum auth attempts per IP within the rate-limit window. */
const AUTH_RATE_LIMIT = 10;
/** Window length in seconds for auth rate limiting. */
const AUTH_WINDOW_SECONDS = 60;

export interface AuthResult {
  ok: boolean;
  method: string;
  error?: string;
}

/**
 * Authenticate an incoming WebSocket connection.
 *
 * @param params - Parsed ConnectParams from the client's first message.
 * @param clientId - An identifier for the connecting client (e.g. IP address).
 * @returns An AuthResult indicating success or failure.
 */
export function authenticate(
  params: ConnectParams,
  clientId: string,
): AuthResult {
  // --- rate-limit check ---
  const rateLimitKey = `auth:${clientId}`;
  if (!checkRateLimit(rateLimitKey, AUTH_RATE_LIMIT, AUTH_WINDOW_SECONDS)) {
    const result: AuthResult = {
      ok: false,
      method: "rate_limit",
      error: "Too many auth attempts. Try again later.",
    };
    recordAudit("auth:rate_limited", clientId, { method: "rate_limit" });
    events.emit("auth:attempt", { method: "rate_limit", success: false, clientId });
    log.warn({ clientId }, "Auth rate-limited");
    return result;
  }

  const config = getAllConfig();
  const { gatewayToken, gatewayPassword } = config.security;

  // --- token auth ---
  if (params.token) {
    if (!gatewayToken) {
      return fail("token", clientId, "Server has no token configured");
    }
    if (timingSafeEqual(params.token, gatewayToken)) {
      return succeed("token", clientId);
    }
    return fail("token", clientId, "Invalid token");
  }

  // --- password auth ---
  if (params.password) {
    if (!gatewayPassword) {
      return fail("password", clientId, "Server has no password configured");
    }
    if (timingSafeEqual(params.password, gatewayPassword)) {
      return succeed("password", clientId);
    }
    return fail("password", clientId, "Invalid password");
  }

  // --- device-token auth (placeholder, validates presence only) ---
  if (params.deviceToken) {
    // In a full implementation this would look up the paired_devices table
    // and verify a hash. For now we treat any non-empty device token as
    // valid when no token/password is configured, allowing local-only setups.
    if (!gatewayToken && !gatewayPassword) {
      return succeed("device_token", clientId);
    }
    return fail("device_token", clientId, "Device token auth not sufficient when token/password is configured");
  }

  // --- no credentials at all ---
  // If the server has no auth configured, allow anonymous access.
  if (!gatewayToken && !gatewayPassword) {
    return succeed("none", clientId);
  }

  return fail("none", clientId, "Authentication required");
}

// ── Helpers ─────────────────────────────────────────────────────────

function succeed(method: string, clientId: string): AuthResult {
  recordAudit("auth:success", clientId, { method });
  events.emit("auth:attempt", { method, success: true, clientId });
  log.info({ clientId, method }, "Auth succeeded");
  return { ok: true, method };
}

function fail(method: string, clientId: string, error: string): AuthResult {
  recordAudit("auth:failure", clientId, { method, error });
  events.emit("auth:attempt", { method, success: false, clientId });
  log.warn({ clientId, method, error }, "Auth failed");
  return { ok: false, method, error };
}
