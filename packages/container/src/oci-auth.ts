/**
 * OCI auth — token management and credential resolution.
 *
 * Extracted from oci-client.ts to keep both files under 200 lines.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createLogger } from "@nexus/core";
import type { RegistryAuth } from "./types.js";

const log = createLogger("container:oci-auth");

// ── Validation constants ───────────────────────────────────────────────────────

/** Allowlist regex for docker credential helper names. */
const HELPER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Private/loopback IPv4 CIDR ranges that are always blocked for SSRF protection. */
const BLOCKED_IPV4_PREFIXES = [
  "127.",
  "10.",
  "169.254.",
];

/** Private IPv4 ranges requiring prefix-length checks. */
const BLOCKED_IPV4_RANGES: Array<[string, number, number]> = [
  // 172.16.0.0/12 → 172.16.x.x – 172.31.x.x
  [String("172."), 16, 31],
  // 192.168.0.0/16
  [String("192.168."), 0, 255],
];

/** Blocked IPv6 addresses / prefixes (after lowercasing). */
const BLOCKED_IPV6_PREFIXES = ["::1", "fc", "fd"];

/**
 * Returns true if the hostname resolves to a private/internal address.
 * This is a static pattern check — it does NOT perform a DNS lookup.
 */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().split(":")[0]; // strip port

  // IPv6 literal (wrapped in brackets is already stripped by URL)
  if (h.startsWith("[") || h.includes(":")) {
    const bare = h.replace(/^\[|\]$/g, "");
    for (const prefix of BLOCKED_IPV6_PREFIXES) {
      if (bare === prefix || bare.startsWith(prefix)) return true;
    }
    return false;
  }

  // Simple prefix checks
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (h.startsWith(prefix)) return true;
  }

  // Range checks
  for (const [prefix, low, high] of BLOCKED_IPV4_RANGES) {
    if (h.startsWith(prefix)) {
      const second = parseInt(h.slice(prefix.length).split(".")[0], 10);
      if (!isNaN(second) && second >= low && second <= high) return true;
    }
  }

  return false;
}

// ── Token cache types (re-exported for OciClient) ────────────────────────────

export interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

export const TOKEN_REFRESH_THRESHOLD_MS = 30_000;

// ── OciAuthError (defined here to avoid circular deps) ───────────────────────

export class OciAuthError extends Error {
  constructor(msg: string) { super(msg); this.name = "OciAuthError"; }
}

// ── Credential resolution ─────────────────────────────────────────────────────

export async function resolveAuth(
  registry: string,
  optAuth: Record<string, RegistryAuth>,
): Promise<RegistryAuth> {
  const explicit = optAuth[registry];
  if (explicit) return explicit;

  const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");
  try {
    const raw = fs.readFileSync(dockerConfigPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    const credHelpers = config["credHelpers"] as Record<string, string> | undefined;
    if (credHelpers?.[registry]) {
      return { kind: "credential-helper", helperName: credHelpers[registry] };
    }

    const auths = config["auths"] as Record<string, Record<string, string>> | undefined;
    const entry = auths?.[registry];
    if (entry?.auth) {
      const decoded = Buffer.from(entry.auth, "base64").toString("utf-8");
      const colonIdx = decoded.indexOf(":");
      if (colonIdx !== -1) {
        return {
          kind: "basic",
          username: decoded.slice(0, colonIdx),
          password: decoded.slice(colonIdx + 1),
        };
      }
    }
  } catch {
    // docker config not present — fall through to anonymous
  }

  return { kind: "anonymous" };
}

/**
 * Resolves credentials for a registry by calling the docker credential helper
 * with the registry hostname on stdin, as per the Docker credential helper protocol.
 */
export function resolveCredentialForRegistry(
  auth: RegistryAuth,
  registry: string,
): { username: string; password: string } | null {
  if (auth.kind === "basic") {
    return { username: auth.username, password: auth.password };
  }
  if (auth.kind === "credential-helper") {
    const helperName = auth.helperName;
    if (!HELPER_NAME_RE.test(helperName)) {
      log.warn({ helper: helperName }, "Credential helper name contains unsafe characters — skipping");
      return null;
    }
    try {
      const output = execFileSync(`docker-credential-${helperName}`, ["get"], {
        input: registry,
        encoding: "utf-8",
        timeout: 5000,
      });
      const parsed = JSON.parse(output) as { Username?: string; Secret?: string };
      if (parsed.Username && parsed.Secret) {
        return { username: parsed.Username, password: parsed.Secret };
      }
    } catch {
      log.warn({ helper: helperName, registry }, "Credential helper failed");
    }
  }
  return null;
}

// ── Token fetch ───────────────────────────────────────────────────────────────

export async function fetchToken(
  registry: string,
  repository: string,
  scope: string,
  tokenCache: Map<string, TokenCacheEntry>,
  optAuth: Record<string, RegistryAuth>,
): Promise<string | null> {
  const cacheKey = `${registry}/${repository}/${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) {
    return cached.token;
  }

  const probeUrl = `https://${registry}/v2/`;
  let wwwAuth: string | null = null;
  try {
    const probeRes = await fetch(probeUrl, { method: "GET" });
    if (probeRes.status === 401) {
      wwwAuth = probeRes.headers.get("www-authenticate");
    } else if (probeRes.ok) {
      return null;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OciAuthError(`Failed to probe registry ${registry}: ${msg}`);
  }

  if (!wwwAuth) return null;

  const realmMatch = /realm="([^"]+)"/.exec(wwwAuth);
  const serviceMatch = /service="([^"]+)"/.exec(wwwAuth);
  if (!realmMatch) return null;

  const realm = realmMatch[1];
  const service = serviceMatch ? serviceMatch[1] : registry;
  const tokenUrl = new URL(realm);
  tokenUrl.searchParams.set("service", service);
  tokenUrl.searchParams.set("scope", `repository:${repository}:${scope}`);

  const auth = await resolveAuth(registry, optAuth);
  const headers: Record<string, string> = { Accept: "application/json" };
  const cred = resolveCredentialForRegistry(auth, registry);
  if (cred) {
    headers["Authorization"] = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}`;
  }

  const tokenRes = await fetch(tokenUrl.toString(), { headers });
  if (!tokenRes.ok) {
    throw new OciAuthError(`Token fetch failed (${tokenRes.status}) for ${registry}/${repository}`);
  }

  const body = await tokenRes.json() as Record<string, unknown>;
  const rawToken = body["token"] ?? body["access_token"];
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    throw new OciAuthError(`Token response missing valid token field for ${registry}/${repository}`);
  }
  const token: string = rawToken;
  const expiresIn = typeof body["expires_in"] === "number" ? body["expires_in"] : 60;
  const expiresAt = Date.now() + expiresIn * 1000;

  tokenCache.set(cacheKey, { token, expiresAt });
  return token;
}
