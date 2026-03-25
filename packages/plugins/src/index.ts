// Types
export type {
  PluginManifest,
  PluginNexusMeta,
  MarketplaceEntry,
  MarketplaceRegistry,
  InstalledPlugin,
  UpdateInfo,
  PluginContext,
  SkillManifest,
  SkillDefinition,
  SkillSource,
} from "./types.js";
export {
  PluginManifestSchema,
  MarketplaceRegistrySchema,
  MarketplaceEntrySchema,
  SkillManifestSchema,
  SkillDefinitionSchema,
  SkillSourceSchema,
} from "./types.js";

// SDK — what plugin authors use
export {
  definePlugin,
  defineChannelPlugin,
  defineProviderPlugin,
  defineSkillPlugin,
  isPlugin,
  isChannelPlugin,
  isProviderPlugin,
  isSkillPlugin,
} from "./sdk.js";
export type {
  Plugin,
  ChannelPlugin,
  ProviderPlugin,
  SkillPlugin,
  PluginConfig,
  ChannelPluginConfig,
  ProviderPluginConfig,
  SkillPluginConfig,
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

// Skills — 3-tier skill loading system
export { loadSkills, getSkill, listSkills, installSkill } from "./skills.js";

// Defaults — registry URLs and ClawhHub constants
export { DEFAULT_REGISTRIES, CLAWHUB_DEFAULT_URL } from "./defaults.js";

// ClawhHub — skills marketplace integration
export {
  searchClawhubSkills,
  installClawhubSkill,
  syncClawhubSkills,
  getClawhubSkillDetails,
  configureClawhub,
  ClawhubConfigSchema,
} from "./clawhub.js";
export type { ClawhubConfig, ClawhubSkillEntry } from "./clawhub.js";
