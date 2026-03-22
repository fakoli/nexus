/**
 * marketplace.ts
 *
 * Registry management helpers extracted for testability and reuse.
 * The `nexus plugins registry` sub-commands delegate to these functions.
 *
 * Registry storage format (persisted via @nexus/core setConfig/getConfig):
 *   key: "plugins.registries"  value: string[]  (array of URL strings)
 *   key: "plugins.installed"   value: PluginManifest[]
 *
 * Default registry: https://github.com/fakoli/fakoli-plugins
 */

import { getConfig, setConfig, runMigrations } from "@nexus/core";

export const DEFAULT_REGISTRY_URL = "https://github.com/fakoli/fakoli-plugins";

// ── Types (re-exported for consumers) ────────────────────────────────────────

export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  tarball: string;
}

export interface RegistryIndex {
  /** Schema version of the registry format (e.g. "1") */
  version: string;
  /** ISO-8601 timestamp of the last registry update */
  updatedAt: string;
  plugins: RegistryPlugin[];
}

// ── Registry config helpers ───────────────────────────────────────────────────

/**
 * Return the list of configured registry URLs.
 * Falls back to [DEFAULT_REGISTRY_URL] if nothing has been persisted.
 */
export function listRegistries(): string[] {
  runMigrations();
  const raw = getConfig("plugins.registries");
  if (!Array.isArray(raw) || raw.length === 0) return [DEFAULT_REGISTRY_URL];
  return raw as string[];
}

/**
 * Persist the given registry URL list.
 * Passing an empty array resets to [DEFAULT_REGISTRY_URL].
 */
export function saveRegistries(urls: string[]): void {
  runMigrations();
  setConfig("plugins.registries", urls.length > 0 ? urls : [DEFAULT_REGISTRY_URL]);
}

/**
 * Add a registry URL.  Returns false if it was already present (no-op).
 * Does NOT validate connectivity — call validateRegistry() first if needed.
 */
export function addRegistry(url: string): boolean {
  const normalized = normalizeUrl(url);
  const existing = listRegistries();
  if (existing.some((r) => normalizeUrl(r) === normalized)) return false;
  saveRegistries([...existing, url]);
  return true;
}

/**
 * Remove a registry URL.
 * Returns false if the URL was not configured.
 * If removing the last registry the default is restored.
 */
export function removeRegistry(url: string): boolean {
  const normalized = normalizeUrl(url);
  const existing = listRegistries();
  const filtered = existing.filter((r) => normalizeUrl(r) !== normalized);
  if (filtered.length === existing.length) return false;
  saveRegistries(filtered.length > 0 ? filtered : [DEFAULT_REGISTRY_URL]);
  return true;
}

// ── Network helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the registry.json URL for a given registry base URL.
 * Handles both bare repo URLs and URLs that already end with /registry.json.
 */
export function resolveRegistryJsonUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/registry.json")) return baseUrl;
  return baseUrl.replace(/\/$/, "") + "/registry.json";
}

/**
 * Fetch and parse the registry index from the given base URL.
 * Throws a descriptive Error on any failure so callers can surface it.
 */
export async function validateRegistry(url: string): Promise<RegistryIndex> {
  // Reject non-HTTP(S) schemes to prevent SSRF via file://, ftp://, etc.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid registry URL: ${url}`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(
      `Unsafe registry URL scheme "${parsedUrl.protocol}" — only http: and https: are allowed.`,
    );
  }

  const jsonUrl = resolveRegistryJsonUrl(url);

  let res: Response;
  try {
    res = await fetch(jsonUrl);
  } catch (err) {
    throw new Error(
      `Cannot reach registry at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `Registry at ${url} returned HTTP ${res.status}. ` +
        `Check the URL and ensure registry.json is publicly accessible.`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Registry at ${url} returned invalid JSON.`);
  }

  if (!isRegistryIndex(data)) {
    throw new Error(
      `Registry at ${url} has an unexpected format. ` +
        `Expected { version, updatedAt, plugins: [...] }.`,
    );
  }

  return data;
}

/**
 * Search all configured registries for plugins matching `query`.
 * Results are de-duplicated by plugin ID (first registry wins).
 */
export async function searchRegistries(
  query: string,
  registryUrls?: string[],
): Promise<(RegistryPlugin & { registryUrl: string })[]> {
  const urls = registryUrls ?? listRegistries();
  const term = query.toLowerCase();
  const seen = new Set<string>();
  const results: (RegistryPlugin & { registryUrl: string })[] = [];

  for (const url of urls) {
    let index: RegistryIndex;
    try {
      index = await validateRegistry(url);
    } catch {
      // Skip unreachable registries during search
      continue;
    }

    for (const plugin of index.plugins) {
      if (seen.has(plugin.id)) continue;
      const haystack = [plugin.id, plugin.name, plugin.description, ...(plugin.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(term)) {
        seen.add(plugin.id);
        results.push({ ...plugin, registryUrl: url });
      }
    }
  }

  return results;
}

/**
 * Look up a single plugin by ID across all configured registries.
 * Returns undefined if not found.
 */
export async function lookupPlugin(
  id: string,
  registryUrls?: string[],
): Promise<(RegistryPlugin & { registryUrl: string }) | undefined> {
  const urls = registryUrls ?? listRegistries();

  for (const url of urls) {
    let index: RegistryIndex;
    try {
      index = await validateRegistry(url);
    } catch {
      continue;
    }

    const found = index.plugins.find((p) => p.id === id);
    if (found) return { ...found, registryUrl: url };
  }

  return undefined;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function isRegistryIndex(data: unknown): data is RegistryIndex {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.version === "string" && Array.isArray(obj.plugins);
}
