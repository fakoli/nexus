/**
 * Capability schema definitions for the Wasm agent sandbox.
 *
 * Defines what resources and actions a sandboxed agent is permitted to access.
 * Profiles provide ready-made presets (minimal, standard, trusted).
 */
import { z } from "zod";

export const NetworkCapabilitySchema = z.object({
  allowedHosts: z.array(z.string()).default([]),
});

export const FilesystemCapabilitySchema = z.object({
  allowedPaths: z.record(z.string(), z.string()).default({}), // host path → guest path
  readOnly: z.boolean().default(true),
});

export const MemoryCapabilitySchema = z.object({
  maxPages: z.number().min(1).default(256), // 256 pages = 16 MB
});

export const ToolCapabilitySchema = z.object({
  allowed: z.array(z.string()).default(["*"]),
  denied: z.array(z.string()).default([]),
});

export const AgentCapabilitiesSchema = z.object({
  network: NetworkCapabilitySchema.default({}),
  filesystem: FilesystemCapabilitySchema.default({}),
  memory: MemoryCapabilitySchema.default({}),
  tools: ToolCapabilitySchema.default({}),
  timeoutMs: z.number().min(1000).default(30000),
});

export type NetworkCapability = z.infer<typeof NetworkCapabilitySchema>;
export type FilesystemCapability = z.infer<typeof FilesystemCapabilitySchema>;
export type MemoryCapability = z.infer<typeof MemoryCapabilitySchema>;
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

// ── Predefined profiles ─────────────────────────────────────────────

export const CAPABILITY_PROFILES = {
  minimal: AgentCapabilitiesSchema.parse({
    network: { allowedHosts: [] },
    filesystem: { allowedPaths: {}, readOnly: true },
    tools: { allowed: [], denied: ["*"] },
  }),
  standard: AgentCapabilitiesSchema.parse({
    network: { allowedHosts: ["api.openai.com", "api.anthropic.com"] },
    tools: { allowed: ["memory", "web_search"], denied: [] },
  }),
  trusted: AgentCapabilitiesSchema.parse({
    network: { allowedHosts: ["*"] },
    filesystem: { readOnly: false },
    tools: { allowed: ["*"], denied: [] },
  }),
} as const;

// ── Policy helpers ──────────────────────────────────────────────────

export function isToolAllowed(capabilities: AgentCapabilities, toolName: string): boolean {
  const { allowed, denied } = capabilities.tools;
  if (denied.includes("*") || denied.includes(toolName)) return false;
  if (allowed.includes("*") || allowed.includes(toolName)) return true;
  return false;
}

export function isHostAllowed(capabilities: AgentCapabilities, host: string): boolean {
  const { allowedHosts } = capabilities.network;
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.includes(host);
}
