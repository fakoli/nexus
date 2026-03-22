import { z } from "zod";
import { getDb } from "./db.js";
import { events } from "./events.js";
import { createLogger } from "./logger.js";

const log = createLogger("core:config");

export const GatewayConfigSchema = z.object({
  port: z.number().default(18789),
  bind: z.enum(["loopback", "lan", "all"]).default("loopback"),
  verbose: z.boolean().default(false),
});

export const AgentConfigSchema = z.object({
  defaultProvider: z.string().default("anthropic"),
  defaultModel: z.string().default("claude-sonnet-4-6"),
  workspace: z.string().optional(),
  thinkLevel: z.enum(["off", "low", "medium", "high"]).default("low"),
});

export const SecurityConfigSchema = z.object({
  gatewayToken: z.string().optional(),
  gatewayPassword: z.string().optional(),
  dmPolicy: z.enum(["pairing", "open", "deny"]).default("pairing"),
  promptGuard: z.enum(["enforce", "warn", "off"]).default("enforce"),
});

export const ChannelsConfigSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().default(false),
    token: z.string().optional(),
  }).default({}),
  discord: z.object({
    enabled: z.boolean().default(false),
    token: z.string().optional(),
  }).default({}),
}).default({});

export const NexusConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  channels: ChannelsConfigSchema,
});

export type NexusConfig = z.infer<typeof NexusConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

export function getConfig(key: string): unknown {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

export function setConfig(key: string, value: unknown): void {
  const db = getDb();
  const json = JSON.stringify(value);
  db.prepare(
    "INSERT INTO config (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, json);
  events.emit("config:changed", { key, value });
  log.info({ key }, "Config updated");
}

export function getAllConfig(): NexusConfig {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM config").all() as Array<{
    key: string;
    value: string;
  }>;
  const flat: Record<string, unknown> = {};
  for (const row of rows) {
    flat[row.key] = JSON.parse(row.value);
  }

  return NexusConfigSchema.parse({
    gateway: flat["gateway"] ?? {},
    agent: flat["agent"] ?? {},
    security: flat["security"] ?? {},
    channels: flat["channels"] ?? {},
  });
}

