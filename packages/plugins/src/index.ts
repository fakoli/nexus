// Types
export type {
  PluginManifest,
  PluginNexusMeta,
  MarketplaceEntry,
  MarketplaceRegistry,
  InstalledPlugin,
  UpdateInfo,
  PluginContext,
} from "./types.js";
export { PluginManifestSchema, MarketplaceRegistrySchema, MarketplaceEntrySchema } from "./types.js";

// SDK — what plugin authors use
export {
  definePlugin,
  defineChannelPlugin,
  defineProviderPlugin,
  isPlugin,
  isChannelPlugin,
  isProviderPlugin,
} from "./sdk.js";
export type {
  Plugin,
  ChannelPlugin,
  ProviderPlugin,
  PluginConfig,
  ChannelPluginConfig,
  ProviderPluginConfig,
  ToolDefinition,
  HookDefinition,
} from "./sdk.js";

// Marketplace — discovery
export {
  DEFAULT_REGISTRY_URL,
  fetchRegistry,
  getPluginDetails,
  searchPlugins,
  listAllPlugins,
  githubRawBase,
  githubTarballUrl,
} from "./marketplace.js";

// Registry — installed plugin tracking
export {
  listInstalled,
  isInstalled,
  getInstalledVersion,
  recordInstall,
  uninstallPlugin,
  checkUpdates,
  getPluginsDir,
  getPluginDir,
} from "./registry.js";

// Installer — downloads and installs
export { installPlugin, updatePlugin, readLocalManifest } from "./installer.js";

// Loader — dynamic plugin loading at runtime
export { loadPlugin, unloadPlugin, getLoadedPlugins, getLoadedPlugin } from "./loader.js";
