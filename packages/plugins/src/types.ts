import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas (used for validation at runtime)
// ---------------------------------------------------------------------------

export const PluginNexusMetaSchema = z.object({
  minVersion: z.string(),
  type: z.enum(["channel", "provider", "tool", "skill"]),
  capabilities: z.array(z.string()).optional(),
});

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "Plugin id must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "Version must be semver"),
  description: z.string(),
  author: z.string().min(1),
  repository: z.string().url(),
  main: z.string().min(1),
  nexus: PluginNexusMetaSchema,
  dependencies: z.record(z.string()).optional(),
});

export const MarketplaceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  author: z.string(),
  repository: z.string(),
  path: z.string(),
  downloads: z.number().optional(),
  verified: z.boolean().optional(),
});

export const MarketplaceRegistrySchema = z.object({
  version: z.number(),
  plugins: z.array(MarketplaceEntrySchema),
});

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export type PluginNexusMeta = z.infer<typeof PluginNexusMetaSchema>;

/**
 * The nexus-plugin.json manifest that lives at the root of each plugin package.
 */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * A single entry in a marketplace registry's plugin list.
 */
export type MarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>;

/**
 * The full registry.json file fetched from a GitHub-hosted marketplace.
 */
export type MarketplaceRegistry = z.infer<typeof MarketplaceRegistrySchema>;

/**
 * A record of an installed plugin stored in the database.
 */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  registryUrl: string;
  installPath: string;
  installedAt: number;
  updatedAt: number;
}

/**
 * Result of a version check against the upstream registry.
 */
export interface UpdateInfo {
  pluginId: string;
  installedVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  registryUrl: string;
  entry: MarketplaceEntry;
}

/**
 * Minimal sandboxed context passed into each loaded plugin.
 */
export interface PluginContext {
  pluginId: string;
  dataDir: string;
  log: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}
