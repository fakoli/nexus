/**
 * Config RPC handlers.
 *
 * - config.get — retrieve a config section.
 * - config.set — update a config section.
 */
import { z } from "zod";
import {
  setConfig,
  getAllConfig,
  NexusConfigSchema,
  createLogger,
} from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:config");

const VALID_SECTIONS = ["gateway", "agent", "security"] as const;

/**
 * Config sections that cannot be modified via RPC — only readable.
 * Prevents authenticated clients from overwriting security credentials
 * or disabling the prompt guard.
 */
const READONLY_SECTIONS = ["security"] as const;

/**
 * Keys within the "security" config section that must never be transmitted
 * over the wire, even to authenticated clients.  Credentials stay server-side.
 */
const SECURITY_REDACT_KEYS: ReadonlySet<string> = new Set([
  "gatewayToken",
  "gatewayPassword",
]);

// ── Param schemas ───────────────────────────────────────────────────

const ConfigGetParams = z.object({
  section: z.enum(VALID_SECTIONS).optional(),
});

const ConfigSetParams = z.object({
  section: z.enum(VALID_SECTIONS),
  value: z.record(z.unknown()),
});

// ── Handlers ────────────────────────────────────────────────────────

export function handleConfigGet(params: Record<string, unknown>): ResponseFrame {
  const parsed = ConfigGetParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { section } = parsed.data;

  if (section) {
    const fullConfig = getAllConfig();
    const raw = fullConfig[section as keyof typeof fullConfig];
    const value = redactSection(section, raw);
    return {
      id: "",
      ok: true,
      payload: { section, value: value ?? {} },
    };
  }

  // Return the full validated config if no section is specified, with
  // credential fields redacted so tokens are never sent over the wire.
  const config = getAllConfig();
  const safeConfig = {
    ...config,
    security: redactSection("security", config.security),
  };
  return {
    id: "",
    ok: true,
    payload: { config: safeConfig },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Return a copy of a config section value with sensitive fields replaced by
 * the string "[REDACTED]".  Only applies to the "security" section.
 */
function redactSection(section: string, value: unknown): unknown {
  if (section !== "security" || typeof value !== "object" || value === null) {
    return value;
  }
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of SECURITY_REDACT_KEYS) {
    if (key in copy) {
      copy[key] = "[REDACTED]";
    }
  }
  return copy;
}

export function handleConfigSet(params: Record<string, unknown>): ResponseFrame {
  const parsed = ConfigSetParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { section, value } = parsed.data;

  // Block writes to read-only sections (e.g. "security") to prevent
  // authenticated clients from overwriting tokens or disabling prompt guard.
  if ((READONLY_SECTIONS as readonly string[]).includes(section)) {
    return {
      id: "",
      ok: false,
      error: { code: "FORBIDDEN", message: `Section "${section}" cannot be modified via RPC` },
    };
  }

  // Validate the value against the appropriate sub-schema.
  const sectionSchema = NexusConfigSchema.shape[section];
  const validated = sectionSchema.safeParse(value);
  if (!validated.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_CONFIG", message: validated.error.message },
    };
  }

  setConfig(section, validated.data);
  log.info({ section }, "Config section updated");

  return {
    id: "",
    ok: true,
    payload: { section, value: redactSection(section, validated.data) },
  };
}
