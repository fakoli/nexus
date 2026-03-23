/**
 * Plugin and skill RPC handlers.
 *
 * - plugins.list     — list installed plugins
 * - plugins.install  — install a plugin from a registry
 * - plugins.uninstall — uninstall a plugin
 * - plugins.search   — search marketplace registries
 * - skills.list      — list available skills (all tiers)
 * - skills.install   — install a skill from ClawhHub
 * - skills.search    — search ClawhHub for skills
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import {
  listInstalled,
  searchPlugins,
  installPlugin,
  uninstallPlugin,
  loadPlugin,
  unloadPlugin,
} from "@nexus/plugins";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:plugins");

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const PluginsSearchParams = z.object({
  query: z.string().default(""),
  registries: z.array(z.string()).optional(),
});

const PluginsInstallParams = z.object({
  registryUrl: z.string().min(1),
  pluginId: z.string().min(1),
  force: z.boolean().default(false),
});

const PluginsUninstallParams = z.object({
  pluginId: z.string().min(1),
});

const SkillsSearchParams = z.object({
  query: z.string().default(""),
});

const SkillsInstallParams = z.object({
  skillId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Plugin handlers
// ---------------------------------------------------------------------------

export function handlePluginsList(): ResponseFrame {
  const installed = listInstalled();
  return { id: "", ok: true, payload: { plugins: installed } };
}

export async function handlePluginsInstall(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = PluginsInstallParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  try {
    const manifest = await installPlugin(
      parsed.data.registryUrl,
      parsed.data.pluginId,
      { force: parsed.data.force },
    );
    await loadPlugin(manifest.id);
    log.info({ pluginId: manifest.id }, "Plugin installed and loaded via RPC");
    return {
      id: "",
      ok: true,
      payload: { plugin: manifest },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "INSTALL_FAILED", message: msg },
    };
  }
}

export async function handlePluginsUninstall(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = PluginsUninstallParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  try {
    await unloadPlugin(parsed.data.pluginId);
    uninstallPlugin(parsed.data.pluginId);
    log.info({ pluginId: parsed.data.pluginId }, "Plugin uninstalled via RPC");
    return {
      id: "",
      ok: true,
      payload: { pluginId: parsed.data.pluginId },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "UNINSTALL_FAILED", message: msg },
    };
  }
}

export async function handlePluginsSearch(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = PluginsSearchParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  try {
    const results = await searchPlugins(parsed.data.query, parsed.data.registries);
    return {
      id: "",
      ok: true,
      payload: { results },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "SEARCH_FAILED", message: msg },
    };
  }
}
