import { createLogger } from "@nexus/core";
import {
  MarketplaceRegistrySchema,
  PluginManifestSchema,
  type MarketplaceEntry,
  type MarketplaceRegistry,
  type PluginManifest,
} from "./types.js";
import { DEFAULT_REGISTRIES } from "./defaults.js";

const log = createLogger("plugins:marketplace");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_REGISTRY_URL = DEFAULT_REGISTRIES[0] ?? "";

/**
 * Convert a GitHub repository URL into a raw-content base URL pointing at the
 * default branch root.
 *
 * https://github.com/owner/repo  →  https://raw.githubusercontent.com/owner/repo/HEAD
 */
export function githubRawBase(repoUrl: string): string {
  // Normalise — strip trailing slash, optional .git suffix
  const cleaned = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) {
    throw new Error(`Not a valid GitHub repository URL: ${repoUrl}`);
  }
  return `https://raw.githubusercontent.com/${match[1]}/HEAD`;
}

/**
 * Convert a GitHub repository URL + in-repo path into a GitHub API tarball
 * download URL for the HEAD of the default branch.
 *
 * https://github.com/owner/repo  →  https://api.github.com/repos/owner/repo/tarball/HEAD
 */
export function githubTarballUrl(repoUrl: string, subPath?: string): string {
  const cleaned = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) {
    throw new Error(`Not a valid GitHub repository URL: ${repoUrl}`);
  }
  // subPath not used in the tarball URL itself — caller filters after extraction
  void subPath;
  return `https://api.github.com/repos/${match[1]}/tarball/HEAD`;
}

// ---------------------------------------------------------------------------
// Registry fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the `registry.json` file from the root of a GitHub-hosted marketplace
 * repository and return the parsed, validated registry.
 */
export async function fetchRegistry(repoUrl: string): Promise<MarketplaceRegistry> {
  const base = githubRawBase(repoUrl);
  const url = `${base}/registry.json`;
  log.info({ url }, "Fetching marketplace registry");

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "nexus-marketplace/1.0" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch registry from ${url}: HTTP ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();
  const parsed = MarketplaceRegistrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid registry format at ${url}: ${parsed.error.message}`);
  }

  log.info({ repoUrl, count: parsed.data.plugins.length }, "Registry loaded");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Plugin manifest fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the `nexus-plugin.json` manifest for a specific plugin within a registry
 * repository.
 */
export async function getPluginDetails(
  repoUrl: string,
  pluginPath: string,
): Promise<PluginManifest> {
  const base = githubRawBase(repoUrl);
  // pluginPath is the in-repo path, e.g. "plugins/my-plugin"
  const manifestPath = pluginPath.replace(/\/$/, "") + "/nexus-plugin.json";
  const url = `${base}/${manifestPath}`;
  log.info({ url }, "Fetching plugin manifest");

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "nexus-marketplace/1.0" },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch plugin manifest from ${url}: HTTP ${res.status} ${res.statusText}`,
    );
  }

  const raw = await res.json();
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid plugin manifest at ${url}: ${parsed.error.message}`);
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search across one or more registry URLs for plugins matching a query string.
 * The search is case-insensitive and checks id, name, description, and author.
 */
export async function searchPlugins(
  query: string,
  registryUrls: string[] = [...DEFAULT_REGISTRIES],
): Promise<MarketplaceEntry[]> {
  const activeUrls = registryUrls.filter((url) => url !== "");
  if (activeUrls.length === 0) {
    log.warn("No plugin registry configured. Add one with: nexus plugins registry add <url>");
    return [];
  }

  const q = query.toLowerCase().trim();

  const results = await Promise.allSettled(activeUrls.map((url) => fetchRegistry(url)));

  const entries: MarketplaceEntry[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      log.warn({ registryUrl: activeUrls[i], error: String(result.reason) }, "Registry fetch failed — skipping");
      continue;
    }
    for (const plugin of result.value.plugins) {
      if (
        !q ||
        plugin.id.toLowerCase().includes(q) ||
        plugin.name.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q) ||
        plugin.author.toLowerCase().includes(q)
      ) {
        entries.push(plugin);
      }
    }
  }

  return entries;
}

/**
 * List all plugins across the given registries without filtering.
 */
export async function listAllPlugins(
  registryUrls: string[] = [...DEFAULT_REGISTRIES],
): Promise<MarketplaceEntry[]> {
  return searchPlugins("", registryUrls);
}
