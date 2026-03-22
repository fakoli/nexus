import { Command } from "commander";
import { runMigrations, getConfig, setConfig, createLogger } from "@nexus/core";
import {
  installPlugin,
  uninstallPlugin as dbUninstallPlugin,
  listInstalled,
} from "@nexus/plugins";

const log = createLogger("cli:plugins");

const DEFAULT_REGISTRY = "";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  nexusVersion?: string;
  main: string;
  installedAt?: number;
  registryUrl?: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords?: string[];
  tarball: string;
  homepage?: string;
}

export interface RegistryIndex {
  version: string;
  updatedAt: string;
  plugins: RegistryEntry[];
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getInstalledPlugins(): PluginManifest[] {
  return listInstalled().map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: "",
    main: "index.js",
    installedAt: p.installedAt * 1000,
    registryUrl: p.registryUrl,
  }));
}

function getRegistries(): string[] {
  const raw = getConfig("plugins.registries");
  if (!Array.isArray(raw)) return DEFAULT_REGISTRY ? [DEFAULT_REGISTRY] : [];
  const list = (raw as string[]).filter((url) => url !== "");
  if (list.length === 0) return DEFAULT_REGISTRY ? [DEFAULT_REGISTRY] : [];
  return list;
}

function saveRegistries(urls: string[]): void {
  setConfig("plugins.registries", urls);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function printTable(rows: string[][], headers: string[]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");

  console.log(fmt(headers));
  console.log(divider);
  for (const row of rows) {
    console.log(fmt(row));
  }
}

function printPluginDetail(p: PluginManifest | RegistryEntry): void {
  const lines: [string, string][] = [
    ["ID", p.id],
    ["Name", p.name],
    ["Version", p.version],
    ["Description", p.description],
  ];
  if (p.author) lines.push(["Author", p.author]);
  if (p.homepage) lines.push(["Homepage", p.homepage]);
  if (p.keywords?.length) lines.push(["Keywords", p.keywords.join(", ")]);
  if ("installedAt" in p && p.installedAt) {
    lines.push(["Installed", new Date(p.installedAt).toISOString()]);
  }
  if ("registryUrl" in p && p.registryUrl) {
    lines.push(["Registry", p.registryUrl]);
  }

  const labelWidth = Math.max(...lines.map(([k]) => k.length));
  for (const [key, val] of lines) {
    console.log(`${key.padEnd(labelWidth)}  ${val}`);
  }
}

// ── Registry fetch ────────────────────────────────────────────────────────────

async function fetchRegistryIndex(url: string): Promise<RegistryIndex> {
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

  const registryJsonUrl = url.endsWith("/registry.json")
    ? url
    : url.replace(/\/$/, "") + "/registry.json";

  let res: Response;
  try {
    res = await fetch(registryJsonUrl);
  } catch (err) {
    throw new Error(
      `Cannot reach registry at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `Registry at ${url} returned HTTP ${res.status}. Is the URL correct?`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Registry at ${url} did not return valid JSON.`);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !("plugins" in data) ||
    !Array.isArray((data as Record<string, unknown>).plugins)
  ) {
    throw new Error(
      `Registry at ${url} has an unexpected format. Expected { plugins: [...] }.`,
    );
  }

  return data as RegistryIndex;
}

// ── Root command ──────────────────────────────────────────────────────────────

export const pluginsCommand = new Command("plugins").description(
  "Manage Nexus plugins and marketplace registries",
);

// ── plugins list ──────────────────────────────────────────────────────────────

pluginsCommand
  .command("list")
  .description("List installed plugins")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    runMigrations();
    const plugins = getInstalledPlugins();

    if (opts.json) {
      console.log(JSON.stringify(plugins, null, 2));
      return;
    }

    if (plugins.length === 0) {
      console.log("No plugins installed.");
      console.log(`\nBrowse available plugins: nexus plugins search <query>`);
      return;
    }

    console.log(`Installed plugins (${plugins.length}):\n`);
    printTable(
      plugins.map((p) => [p.id, p.name, p.version, p.description]),
      ["ID", "Name", "Version", "Description"],
    );
  });

// ── plugins search ────────────────────────────────────────────────────────────

pluginsCommand
  .command("search <query>")
  .description("Search marketplace registries for plugins")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts: { json?: boolean }) => {
    runMigrations();
    const registries = getRegistries();
    if (registries.length === 0) {
      console.log("No plugin registry configured. Add one with: nexus plugins registry add <url>");
      return;
    }
    const term = query.toLowerCase();
    const results: (RegistryEntry & { _registry: string })[] = [];

    for (const url of registries) {
      log.info({ url }, "Searching registry");
      let index: RegistryIndex;
      try {
        index = await fetchRegistryIndex(url);
      } catch (err) {
        console.error(`Warning: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const entry of index.plugins) {
        const haystack = [entry.id, entry.name, entry.description, ...(entry.keywords ?? [])]
          .join(" ")
          .toLowerCase();
        if (haystack.includes(term)) {
          results.push({ ...entry, _registry: url });
        }
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`No plugins found matching "${query}".`);
      console.log("\nTip: add more registries with: nexus plugins registry add <url>");
      return;
    }

    console.log(`Found ${results.length} plugin(s) matching "${query}":\n`);
    printTable(
      results.map((p) => [p.id, p.version, p.description]),
      ["ID", "Version", "Description"],
    );
    console.log(`\nInstall with: nexus plugins install <id>`);
  });

// ── plugins install ───────────────────────────────────────────────────────────

pluginsCommand
  .command("install <id>")
  .description("Install a plugin from the marketplace")
  .option("--json", "Output result as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    runMigrations();
    const registries = getRegistries();
    if (registries.length === 0) {
      console.log("No plugin registry configured. Add one with: nexus plugins registry add <url>");
      return;
    }
    let found: (RegistryEntry & { _registry: string }) | undefined;

    for (const url of registries) {
      log.info({ url, id }, "Looking up plugin in registry");
      let index: RegistryIndex;
      try {
        index = await fetchRegistryIndex(url);
      } catch (err) {
        console.error(`Warning: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      const entry = index.plugins.find((p) => p.id === id);
      if (entry) {
        found = { ...entry, _registry: url };
        break;
      }
    }

    if (!found) {
      console.error(
        `Plugin "${id}" not found in any configured registry.\n` +
          `Run "nexus plugins search ${id}" to check spelling, or\n` +
          `add a registry with "nexus plugins registry add <url>".`,
      );
      process.exit(1);
    }

    const installed = getInstalledPlugins();
    const existing = installed.find((p) => p.id === id);
    if (existing) {
      console.error(
        `Plugin "${id}" is already installed (version ${existing.version}).\n` +
          `To upgrade, run: nexus plugins update ${id}`,
      );
      process.exit(1);
    }

    // Download tarball, extract to plugins dir, install deps, record in SQLite
    let manifest: { id: string; name: string; version: string };
    try {
      console.log(`Installing ${id} from ${found._registry} ...`);
      manifest = await installPlugin(found._registry, id);
    } catch (err) {
      console.error(
        `Failed to install plugin "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ id: manifest.id, name: manifest.name, version: manifest.version, registryUrl: found._registry }));
    } else {
      console.log(`Installed plugin: ${manifest.name} v${manifest.version}`);
      console.log(`  ID       : ${manifest.id}`);
      console.log(`  Registry : ${found._registry}`);
    }
  });

// ── plugins update ────────────────────────────────────────────────────────────

pluginsCommand
  .command("update [id]")
  .description("Update installed plugin(s). Omit <id> to update all.")
  .option("--json", "Output results as JSON")
  .action(async (id: string | undefined, opts: { json?: boolean }) => {
    runMigrations();
    const installed = getInstalledPlugins();

    if (installed.length === 0) {
      console.log("No plugins installed.");
      return;
    }

    const targets = id ? installed.filter((p) => p.id === id) : installed;

    if (targets.length === 0) {
      console.error(`Plugin "${id}" is not installed.`);
      process.exit(1);
    }

    const results: { id: string; from: string; to: string; status: "updated" | "up-to-date" | "error"; error?: string }[] = [];

    for (const plugin of targets) {
      const registryUrl = plugin.registryUrl ?? getRegistries()[0];
      // Check remote version first to skip unnecessary downloads
      let index: RegistryIndex;
      try {
        index = await fetchRegistryIndex(registryUrl);
      } catch (err) {
        results.push({
          id: plugin.id,
          from: plugin.version,
          to: plugin.version,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const remote = index.plugins.find((p) => p.id === plugin.id);
      if (!remote) {
        results.push({
          id: plugin.id,
          from: plugin.version,
          to: plugin.version,
          status: "error",
          error: `Plugin "${plugin.id}" not found in registry ${registryUrl}`,
        });
        continue;
      }

      if (remote.version === plugin.version) {
        results.push({ id: plugin.id, from: plugin.version, to: plugin.version, status: "up-to-date" });
        continue;
      }

      // Download + extract new version, overwriting the existing install
      const prevVersion = plugin.version;
      try {
        await installPlugin(registryUrl, plugin.id, { force: true });
        results.push({ id: plugin.id, from: prevVersion, to: remote.version, status: "updated" });
      } catch (err) {
        results.push({
          id: plugin.id,
          from: prevVersion,
          to: prevVersion,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const r of results) {
      if (r.status === "updated") {
        console.log(`Updated ${r.id}: ${r.from} -> ${r.to}`);
      } else if (r.status === "up-to-date") {
        console.log(`${r.id}: already up to date (${r.from})`);
      } else {
        console.error(`${r.id}: error — ${r.error}`);
      }
    }
  });

// ── plugins uninstall ─────────────────────────────────────────────────────────

pluginsCommand
  .command("uninstall <id>")
  .description("Remove an installed plugin")
  .option("--json", "Output result as JSON")
  .action((id: string, opts: { json?: boolean }) => {
    runMigrations();
    const installed = getInstalledPlugins();
    const target = installed.find((p) => p.id === id);

    if (!target) {
      console.error(
        `Plugin "${id}" is not installed.\n` +
          `Run "nexus plugins list" to see installed plugins.`,
      );
      process.exit(1);
    }

    try {
      dbUninstallPlugin(id);
    } catch (err) {
      console.error(`Failed to uninstall plugin: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ uninstalled: target.id, version: target.version }));
    } else {
      console.log(`Uninstalled plugin: ${target.name} (${target.id}) v${target.version}`);
    }
  });

// ── plugins info ──────────────────────────────────────────────────────────────

pluginsCommand
  .command("info <id>")
  .description("Show detailed plugin information")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    runMigrations();

    // First check installed
    const installed = getInstalledPlugins();
    const local = installed.find((p) => p.id === id);

    if (local) {
      if (opts.json) {
        console.log(JSON.stringify(local, null, 2));
      } else {
        console.log(`Plugin info (installed):\n`);
        printPluginDetail(local);
      }
      return;
    }

    // Fall through to registry lookup
    const registries = getRegistries();
    for (const url of registries) {
      let index: RegistryIndex;
      try {
        index = await fetchRegistryIndex(url);
      } catch {
        continue;
      }

      const entry = index.plugins.find((p) => p.id === id);
      if (entry) {
        if (opts.json) {
          console.log(JSON.stringify({ ...entry, registryUrl: url }, null, 2));
        } else {
          console.log(`Plugin info (from registry: ${url}):\n`);
          printPluginDetail(entry);
          console.log(`\nInstall with: nexus plugins install ${id}`);
        }
        return;
      }
    }

    console.error(
      `Plugin "${id}" not found locally or in any configured registry.\n` +
        `Try: nexus plugins search ${id}`,
    );
    process.exit(1);
  });

// ── plugins registry ──────────────────────────────────────────────────────────

const registryCommand = new Command("registry").description(
  "Manage marketplace registries",
);

registryCommand
  .command("add <url>")
  .description("Add a marketplace registry (validates by fetching registry.json)")
  .action(async (url: string) => {
    runMigrations();

    // Validate the URL is reachable and has a valid registry.json
    console.log(`Validating registry at ${url} ...`);
    let index: RegistryIndex;
    try {
      index = await fetchRegistryIndex(url);
    } catch (err) {
      console.error(
        `Cannot add registry: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const registries = getRegistries();
    const normalized = url.replace(/\/$/, "");

    if (registries.some((r) => r.replace(/\/$/, "") === normalized)) {
      console.log(`Registry already configured: ${url}`);
      return;
    }

    registries.push(url);
    saveRegistries(registries);

    console.log(`Registry added: ${url}`);
    console.log(
      `  Contains ${index.plugins.length} plugin(s)` +
        (index.updatedAt ? `, last updated ${index.updatedAt}` : ""),
    );
  });

registryCommand
  .command("list")
  .description("List configured registries")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    runMigrations();
    const registries = getRegistries();

    if (opts.json) {
      console.log(JSON.stringify(registries, null, 2));
      return;
    }

    console.log(`Configured registries (${registries.length}):\n`);
    registries.forEach((url, i) => {
      const tag = url === DEFAULT_REGISTRY ? " (default)" : "";
      console.log(`  ${i + 1}. ${url}${tag}`);
    });
  });

registryCommand
  .command("remove <url>")
  .description("Remove a registry")
  .action((url: string) => {
    runMigrations();
    const registries = getRegistries();
    const normalized = url.replace(/\/$/, "");
    const filtered = registries.filter((r) => r.replace(/\/$/, "") !== normalized);

    if (filtered.length === registries.length) {
      console.error(
        `Registry "${url}" is not configured.\n` +
          `Run "nexus plugins registry list" to see configured registries.`,
      );
      process.exit(1);
    }

    saveRegistries(filtered);
    console.log(`Registry removed: ${url}`);
  });

pluginsCommand.addCommand(registryCommand);
