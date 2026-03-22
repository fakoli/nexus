import path from "node:path";
import fs from "node:fs";
import { getDb, getDataDir, createLogger } from "@nexus/core";
import { fetchRegistry } from "./marketplace.js";
import type { InstalledPlugin, UpdateInfo } from "./types.js";

const log = createLogger("plugins:registry");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Directory where all installed plugins live: ~/.nexus/plugins/ */
export function getPluginsDir(): string {
  const dir = path.join(getDataDir(), "plugins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Full path of a specific plugin's installation directory */
export function getPluginDir(pluginId: string): string {
  return path.join(getPluginsDir(), pluginId);
}

// ---------------------------------------------------------------------------
// DB row → domain object
// ---------------------------------------------------------------------------

interface PluginRow {
  id: string;
  name: string;
  version: string;
  registry_url: string;
  install_path: string;
  installed_at: number;
  updated_at: number;
}

function rowToInstalledPlugin(row: PluginRow): InstalledPlugin {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    registryUrl: row.registry_url,
    installPath: row.install_path,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all plugins currently recorded as installed in the database.
 */
export function listInstalled(): InstalledPlugin[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, name, version, registry_url, install_path, installed_at, updated_at FROM installed_plugins ORDER BY installed_at DESC",
    )
    .all() as PluginRow[];
  return rows.map(rowToInstalledPlugin);
}

/**
 * Check whether a plugin is installed by its id.
 */
export function isInstalled(pluginId: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM installed_plugins WHERE id = ?")
    .get(pluginId) as { id: string } | undefined;
  return row !== undefined;
}

/**
 * Return the installed version of a plugin, or null if not installed.
 */
export function getInstalledVersion(pluginId: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT version FROM installed_plugins WHERE id = ?")
    .get(pluginId) as { version: string } | undefined;
  return row?.version ?? null;
}

/**
 * Record a newly installed plugin in the database.
 * This is called internally by the installer — external callers should use
 * `installPlugin` from installer.ts instead.
 */
export function recordInstall(plugin: Omit<InstalledPlugin, "installedAt" | "updatedAt">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO installed_plugins (id, name, version, registry_url, install_path, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       registry_url = excluded.registry_url,
       install_path = excluded.install_path,
       updated_at = excluded.updated_at`,
  ).run(plugin.id, plugin.name, plugin.version, plugin.registryUrl, plugin.installPath);
  log.info({ pluginId: plugin.id, version: plugin.version }, "Plugin recorded in registry");
}

/**
 * Remove a plugin from the database record AND delete its install directory.
 */
export function uninstallPlugin(pluginId: string): void {
  if (!isInstalled(pluginId)) {
    throw new Error(`Plugin "${pluginId}" is not installed`);
  }

  const version = getInstalledVersion(pluginId);
  const installPath = getPluginDir(pluginId);

  // Remove from filesystem
  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true, force: true });
    log.info({ pluginId, installPath }, "Plugin directory removed");
  }

  // Remove from DB
  const db = getDb();
  db.prepare("DELETE FROM installed_plugins WHERE id = ?").run(pluginId);
  log.info({ pluginId, version }, "Plugin uninstalled");
}

/**
 * Compare installed versions of all plugins against the upstream registries and
 * return a list of UpdateInfo objects — one per plugin that has an update available
 * (or all plugins when `all` is true).
 */
export async function checkUpdates(all = false): Promise<UpdateInfo[]> {
  const installed = listInstalled();
  if (installed.length === 0) return [];

  // Group by registry so we make one fetch per registry
  const byRegistry = new Map<string, InstalledPlugin[]>();
  for (const p of installed) {
    const list = byRegistry.get(p.registryUrl) ?? [];
    list.push(p);
    byRegistry.set(p.registryUrl, list);
  }

  const updates: UpdateInfo[] = [];

  for (const [registryUrl, plugins] of byRegistry) {
    let registry;
    try {
      registry = await fetchRegistry(registryUrl);
    } catch (err) {
      log.warn({ registryUrl, error: String(err) }, "Could not fetch registry for update check");
      continue;
    }

    for (const installed of plugins) {
      const entry = registry.plugins.find((e) => e.id === installed.id);
      if (!entry) continue;

      const hasUpdate = entry.version !== installed.version;
      if (all || hasUpdate) {
        updates.push({
          pluginId: installed.id,
          installedVersion: installed.version,
          latestVersion: entry.version,
          hasUpdate,
          registryUrl,
          entry,
        });
      }
    }
  }

  return updates;
}
