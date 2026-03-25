import { z } from "zod";
import { getDb } from "./db.js";
import { events } from "./events.js";
import { createLogger } from "./logger.js";

// ── Speech Config (imported inline to avoid circular deps) ──────────

export const TTSConfigSchema = z.object({
  provider: z.enum(["openai", "system"]).default("openai"),
  defaultVoice: z.string().default("alloy"),
  defaultSpeed: z.number().min(0.25).max(4.0).default(1.0),
  defaultFormat: z.enum(["mp3", "opus", "wav"]).default("mp3"),
  maxTextLength: z.number().default(4096),
});

export const STTConfigSchema = z.object({
  provider: z.enum(["openai", "system"]).default("openai"),
  defaultLanguage: z.string().optional(),
  maxAudioSize: z.number().default(25 * 1024 * 1024), // 25MB
});

export const SpeechConfigSchema = z.object({
  tts: TTSConfigSchema.default({}),
  stt: STTConfigSchema.default({}),
});

const log = createLogger("core:config");

export const GatewayConfigSchema = z.object({
  port: z.number().default(19200),
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
  ssrfAllowlist: z.array(z.string()).default([]),
  workspaceRoots: z.array(z.string()).default([]),
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

export const FederationPeerConfigSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  token: z.string(),
  autoConnect: z.boolean().default(true),
});

export const FederationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  gatewayId: z.string().uuid().optional(),
  gatewayName: z.string().default("nexus"),
  token: z.string().optional(),
  peers: z.array(FederationPeerConfigSchema).default([]),
  maxPeers: z.number().default(10),
  messageQueueSize: z.number().default(1000),
  heartbeatInterval: z.number().default(30000),
  reconnectMaxDelay: z.number().default(30000),
});

export const PluginsConfigSchema = z.object({
  registries: z.array(z.string()).default(["https://github.com/fakoli/fakoli-plugins"]),
  autoUpdate: z.boolean().default(false),
}).default({});

export const ClawhubNexusConfigSchema = z.object({
  enabled: z.boolean().default(false),
  registryUrl: z.string().default("https://clawhub.dev/api/v1"),
  apiKey: z.string().optional(),
}).default({});

export const NexusConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  channels: ChannelsConfigSchema,
  speech: SpeechConfigSchema.default({}),
  federation: FederationConfigSchema.default({}),
  plugins: PluginsConfigSchema,
  clawhub: ClawhubNexusConfigSchema,
});

export type NexusConfig = z.infer<typeof NexusConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
export type SpeechConfig = z.infer<typeof SpeechConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type FederationConfig = z.infer<typeof FederationConfigSchema>;
export type FederationPeerConfig = z.infer<typeof FederationPeerConfigSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type ClawhubNexusConfig = z.infer<typeof ClawhubNexusConfigSchema>;

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
    speech: flat["speech"] ?? {},
    federation: flat["federation"] ?? {},
    plugins: flat["plugins"] ?? {},
    clawhub: flat["clawhub"] ?? {},
  });
}

