import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock @nexus/plugins
const mockListInstalled = vi.fn();
const mockSearchPlugins = vi.fn();
const mockInstallPlugin = vi.fn();
const mockUninstallPlugin = vi.fn();
const mockLoadPlugin = vi.fn();
const mockUnloadPlugin = vi.fn();

vi.mock("@nexus/plugins", () => ({
  listInstalled: (...args: unknown[]) => mockListInstalled(...args),
  searchPlugins: (...args: unknown[]) => mockSearchPlugins(...args),
  installPlugin: (...args: unknown[]) => mockInstallPlugin(...args),
  uninstallPlugin: (...args: unknown[]) => mockUninstallPlugin(...args),
  loadPlugin: (...args: unknown[]) => mockLoadPlugin(...args),
  unloadPlugin: (...args: unknown[]) => mockUnloadPlugin(...args),
}));

import {
  handlePluginsList,
  handlePluginsInstall,
  handlePluginsSearch,
} from "../plugins.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePluginsList", () => {
  it("returns empty list when no plugins installed", () => {
    mockListInstalled.mockReturnValue([]);
    const result = handlePluginsList();
    expect(result.ok).toBe(true);
    expect(result.payload?.plugins).toEqual([]);
  });

  it("returns installed plugins", () => {
    const plugins = [
      { id: "plugin-a", name: "Plugin A", version: "1.0.0" },
      { id: "plugin-b", name: "Plugin B", version: "2.0.0" },
    ];
    mockListInstalled.mockReturnValue(plugins);
    const result = handlePluginsList();
    expect(result.ok).toBe(true);
    expect(result.payload?.plugins).toHaveLength(2);
  });
});

describe("handlePluginsInstall", () => {
  it("rejects missing registryUrl", async () => {
    const result = await handlePluginsInstall({ pluginId: "test" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects missing pluginId", async () => {
    const result = await handlePluginsInstall({ registryUrl: "https://r.io" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects empty registryUrl", async () => {
    const result = await handlePluginsInstall({ registryUrl: "", pluginId: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects empty pluginId", async () => {
    const result = await handlePluginsInstall({ registryUrl: "https://r.io", pluginId: "" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("installs and loads plugin on valid params", async () => {
    const manifest = { id: "test-plugin", name: "Test", version: "1.0.0" };
    mockInstallPlugin.mockResolvedValue(manifest);
    mockLoadPlugin.mockResolvedValue(undefined);

    const result = await handlePluginsInstall({
      registryUrl: "https://registry.example.com",
      pluginId: "test-plugin",
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.plugin).toEqual(manifest);
    expect(mockLoadPlugin).toHaveBeenCalledWith("test-plugin");
  });

  it("returns INSTALL_FAILED on error", async () => {
    mockInstallPlugin.mockRejectedValue(new Error("Network error"));
    const result = await handlePluginsInstall({
      registryUrl: "https://registry.example.com",
      pluginId: "bad-plugin",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INSTALL_FAILED");
  });
});

describe("handlePluginsSearch", () => {
  it("accepts empty query (default)", async () => {
    mockSearchPlugins.mockResolvedValue([]);
    const result = await handlePluginsSearch({});
    expect(result.ok).toBe(true);
    expect(result.payload?.results).toEqual([]);
  });

  it("passes query and registries", async () => {
    const results = [{ id: "p1", name: "Plugin 1" }];
    mockSearchPlugins.mockResolvedValue(results);

    const result = await handlePluginsSearch({
      query: "auth",
      registries: ["https://r1.io"],
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.results).toEqual(results);
    expect(mockSearchPlugins).toHaveBeenCalledWith("auth", ["https://r1.io"]);
  });

  it("returns SEARCH_FAILED on error", async () => {
    mockSearchPlugins.mockRejectedValue(new Error("Timeout"));
    const result = await handlePluginsSearch({ query: "test" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SEARCH_FAILED");
  });
});
