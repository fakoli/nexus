import type { PluginContext } from "./types.js";

// ---------------------------------------------------------------------------
// Plugin shape definitions — the public API that plugin authors use
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, ctx: PluginContext): Promise<unknown>;
}

export interface HookDefinition {
  event: string;
  handler(payload: unknown, ctx: PluginContext): Promise<void> | void;
}

export interface PluginConfig {
  /** Unique identifier — must match PluginManifest.id */
  id: string;
  name: string;
  version: string;
  tools?: ToolDefinition[];
  hooks?: HookDefinition[];
  /** Called once after the plugin is loaded and context is ready */
  onLoad?(ctx: PluginContext): Promise<void> | void;
  /** Called once before the plugin is unloaded */
  onUnload?(ctx: PluginContext): Promise<void> | void;
}

export interface Plugin extends PluginConfig {
  readonly _type: "plugin";
}

export interface ChannelPluginConfig extends PluginConfig {
  /** The channel identifier, e.g. "telegram" */
  channelId: string;
  /** Start listening / accepting messages */
  connect(ctx: PluginContext): Promise<void>;
  /** Stop the channel gracefully */
  disconnect(ctx: PluginContext): Promise<void>;
}

export interface ChannelPlugin extends ChannelPluginConfig {
  readonly _type: "channel-plugin";
}

export interface ProviderPluginConfig extends PluginConfig {
  /** Provider name, e.g. "gemini" */
  providerId: string;
  /** List models this provider exposes */
  listModels(): Promise<string[]>;
}

export interface ProviderPlugin extends ProviderPluginConfig {
  readonly _type: "provider-plugin";
}

// ---------------------------------------------------------------------------
// Factory functions — definePlugin / defineChannelPlugin / defineProviderPlugin
// ---------------------------------------------------------------------------

/**
 * Define a generic plugin. Plugin authors call this as their default export.
 *
 * @example
 * export default definePlugin({
 *   id: "my-tool-plugin",
 *   name: "My Tool",
 *   version: "1.0.0",
 *   tools: [{ name: "my_tool", description: "...", inputSchema: {}, execute: async () => {} }],
 * });
 */
export function definePlugin(config: PluginConfig): Plugin {
  return { ...config, _type: "plugin" };
}

/**
 * Define a channel plugin that wires a messaging platform into Nexus.
 *
 * @example
 * export default defineChannelPlugin({
 *   id: "my-telegram",
 *   name: "Telegram",
 *   version: "1.0.0",
 *   channelId: "telegram",
 *   connect: async (ctx) => { ... },
 *   disconnect: async (ctx) => { ... },
 * });
 */
export function defineChannelPlugin(config: ChannelPluginConfig): ChannelPlugin {
  return { ...config, _type: "channel-plugin" };
}

/**
 * Define a provider plugin that adds a new LLM provider to Nexus.
 *
 * @example
 * export default defineProviderPlugin({
 *   id: "my-gemini",
 *   name: "Gemini",
 *   version: "1.0.0",
 *   providerId: "gemini",
 *   listModels: async () => ["gemini-pro"],
 * });
 */
export function defineProviderPlugin(config: ProviderPluginConfig): ProviderPlugin {
  return { ...config, _type: "provider-plugin" };
}

/** Type guard — narrows an unknown export to Plugin */
export function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Plugin)._type === "plugin"
  );
}

/** Type guard — narrows an unknown export to ChannelPlugin */
export function isChannelPlugin(value: unknown): value is ChannelPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ChannelPlugin)._type === "channel-plugin"
  );
}

/** Type guard — narrows an unknown export to ProviderPlugin */
export function isProviderPlugin(value: unknown): value is ProviderPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ProviderPlugin)._type === "provider-plugin"
  );
}
