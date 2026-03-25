import path from "node:path";
import fs from "node:fs";
import { createLogger, getDataDir, events } from "@nexus/core";
import { registerTool } from "@nexus/agent";
import { readLocalManifest } from "./installer.js";
import { getPluginDir, isInstalled } from "./registry.js";
import { isPlugin, isChannelPlugin, isProviderPlugin, isSkillPlugin } from "./sdk.js";
import type { Plugin, ChannelPlugin, ProviderPlugin, SkillPlugin } from "./sdk.js";
import type { PluginContext } from "./types.js";

const log = createLogger("plugins:loader");

// ---------------------------------------------------------------------------
// Loaded plugin registry (in-memory, per-process)
// ---------------------------------------------------------------------------

type LoadedPlugin = Plugin | ChannelPlugin | ProviderPlugin | SkillPlugin;

const loadedPlugins = new Map<string, LoadedPlugin>();

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

function makePluginContext(pluginId: string): PluginContext {
  const pluginDataDir = path.join(getDataDir(), "plugin-data", pluginId);
  fs.mkdirSync(pluginDataDir, { recursive: true });

  const pluginLog = createLogger(`plugin:${pluginId}`);

  return {
    pluginId,
    dataDir: pluginDataDir,
    log: {
      info: (msg, data) => pluginLog.info(data ?? {}, msg),
      warn: (msg, data) => pluginLog.warn(data ?? {}, msg),
      error: (msg, data) => pluginLog.error(data ?? {}, msg),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dynamically load a plugin by its id.
 *
 * - The plugin must be installed (present in ~/.nexus/plugins/<id>/).
 * - Its manifest is read and validated.
 * - Its main entry point is dynamically imported.
 * - The default export must be the result of `definePlugin`,
 *   `defineChannelPlugin`, or `defineProviderPlugin`.
 * - `onLoad` is called with a sandboxed PluginContext.
 *
 * Returns the loaded plugin object.
 */
export async function loadPlugin(pluginId: string): Promise<LoadedPlugin> {
  if (loadedPlugins.has(pluginId)) {
    log.info({ pluginId }, "Plugin already loaded — returning cached instance");
    return loadedPlugins.get(pluginId)!;
  }

  if (!isInstalled(pluginId)) {
    throw new Error(`Plugin "${pluginId}" is not installed`);
  }

  const pluginDir = getPluginDir(pluginId);
  const manifest = readLocalManifest(pluginDir);

  // Resolve main entry point — guard against path traversal via manifest.main
  const mainEntry = path.resolve(pluginDir, manifest.main);
  if (!mainEntry.startsWith(pluginDir + path.sep) && mainEntry !== pluginDir) {
    throw new Error(
      `Plugin "${pluginId}" manifest.main "${manifest.main}" resolves outside the plugin directory`,
    );
  }
  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `Plugin "${pluginId}" main entry "${manifest.main}" not found at ${mainEntry}`,
    );
  }

  log.info({ pluginId, mainEntry }, "Loading plugin");

  // Dynamic import — using a file:// URL to work correctly on all platforms
  const fileUrl = `file://${mainEntry}`;
  let mod: unknown;
  try {
    mod = await import(fileUrl);
  } catch (err) {
    throw new Error(`Failed to import plugin "${pluginId}" from ${mainEntry}: ${String(err)}`);
  }

  // Validate exported shape
  const defaultExport = (mod as { default?: unknown }).default;
  if (
    !isPlugin(defaultExport) &&
    !isChannelPlugin(defaultExport) &&
    !isProviderPlugin(defaultExport) &&
    !isSkillPlugin(defaultExport)
  ) {
    throw new Error(
      `Plugin "${pluginId}" default export must be the result of definePlugin, ` +
        `defineChannelPlugin, defineProviderPlugin, or defineSkillPlugin. Got: ${JSON.stringify(defaultExport)}`,
    );
  }

  const plugin = defaultExport as LoadedPlugin;
  const ctx = makePluginContext(pluginId);

  // Call lifecycle hook
  if (plugin.onLoad) {
    try {
      await plugin.onLoad(ctx);
    } catch (err) {
      throw new Error(`Plugin "${pluginId}" onLoad hook threw: ${String(err)}`);
    }
  }

  // Wire tools into the agent tool registry
  if (plugin.tools?.length) {
    for (const tool of plugin.tools) {
      registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: (input) => tool.execute(input, ctx) as Promise<string>,
      });
      log.info({ pluginId, tool: tool.name }, "Plugin tool registered");
    }
  }

  // Subscribe hooks to the core events bus
  if (plugin.hooks?.length) {
    for (const hook of plugin.hooks) {
      events.on(hook.event as Parameters<typeof events.on>[0], (payload: unknown) => {
        void hook.handler(payload, ctx);
      });
      log.info({ pluginId, event: hook.event }, "Plugin hook subscribed");
    }
  }

  loadedPlugins.set(pluginId, plugin);
  log.info({ pluginId, type: plugin._type }, "Plugin loaded");
  return plugin;
}

/**
 * Unload a previously loaded plugin, calling its `onUnload` hook.
 */
export async function unloadPlugin(pluginId: string): Promise<void> {
  const plugin = loadedPlugins.get(pluginId);
  if (!plugin) {
    log.warn({ pluginId }, "Plugin is not loaded — nothing to unload");
    return;
  }

  const ctx = makePluginContext(pluginId);
  if (plugin.onUnload) {
    try {
      await plugin.onUnload(ctx);
    } catch (err) {
      log.error({ pluginId, error: String(err) }, "Plugin onUnload hook threw");
    }
  }

  loadedPlugins.delete(pluginId);
  log.info({ pluginId }, "Plugin unloaded");
}

/**
 * Return all currently loaded plugins.
 */
export function getLoadedPlugins(): LoadedPlugin[] {
  return Array.from(loadedPlugins.values());
}

/**
 * Return a loaded plugin by id, or undefined if not loaded.
 */
export function getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
  return loadedPlugins.get(pluginId);
}
