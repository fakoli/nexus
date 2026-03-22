import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createLogger } from "@nexus/core";
import { fetchRegistry, getPluginDetails, githubTarballUrl } from "./marketplace.js";
import { recordInstall, getPluginDir, getPluginsDir, isInstalled } from "./registry.js";
import { PluginManifestSchema } from "./types.js";
import type { PluginManifest } from "./types.js";

const log = createLogger("plugins:installer");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read and validate the nexus-plugin.json from a directory on disk.
 * Throws if the file is missing or fails validation.
 */
export function readLocalManifest(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, "nexus-plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found at ${manifestPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Download a tarball from the given URL into a temp file and return the temp
 * file path.
 */
async function downloadTarball(url: string, destDir: string): Promise<string> {
  const tmpFile = path.join(destDir, "_download.tar.gz");
  log.info({ url }, "Downloading plugin tarball");

  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "nexus-marketplace/1.0" },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to download tarball from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Empty response body from ${url}`);
  }

  const writeStream = createWriteStream(tmpFile);
  // Node 18+ ReadableStream → Node stream conversion
  const nodeStream = res.body as unknown as NodeJS.ReadableStream;
  await pipeline(nodeStream, writeStream);

  log.info({ tmpFile }, "Tarball downloaded");
  return tmpFile;
}

/**
 * Extract a tarball into `extractDir`, then find the sub-folder that matches
 * `inRepoPath` and move it to `destDir`.
 *
 * GitHub tarballs unpack as  <owner>-<repo>-<sha>/<in-repo-tree>
 */
async function extractPlugin(
  tarballPath: string,
  inRepoPath: string,
  destDir: string,
): Promise<void> {
  // Dynamically import tar so it can be mocked in tests
  const tar = await import("tar");

  const tmpExtract = tarballPath + "_extracted";
  fs.mkdirSync(tmpExtract, { recursive: true });

  await tar.extract({ file: tarballPath, cwd: tmpExtract, strip: 0 });

  // Find the extracted root folder (GitHub SHA-prefixed dir)
  const entries = fs.readdirSync(tmpExtract);
  if (entries.length === 0) {
    throw new Error("Tarball extracted to empty directory");
  }
  const rootDir = path.resolve(tmpExtract, entries[0]);

  // Guard against path traversal: resolve the candidate path and ensure it
  // stays inside rootDir.
  const pluginSrcDir = path.resolve(rootDir, inRepoPath);
  if (!pluginSrcDir.startsWith(rootDir + path.sep) && pluginSrcDir !== rootDir) {
    throw new Error(
      `Path traversal detected: plugin path "${inRepoPath}" resolves outside the tarball root`,
    );
  }

  if (!fs.existsSync(pluginSrcDir)) {
    throw new Error(
      `Plugin path "${inRepoPath}" not found inside extracted tarball. ` +
        `Available: ${fs.readdirSync(rootDir).join(", ")}`,
    );
  }

  // Move to final destination
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.cpSync(pluginSrcDir, destDir, { recursive: true });
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.unlinkSync(tarballPath);

  log.info({ destDir }, "Plugin extracted");
}

/**
 * Run `npm install --production` inside the plugin directory to install its
 * declared dependencies.
 */
function installDependencies(pluginDir: string): void {
  const manifestPath = path.join(pluginDir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    log.info({ pluginDir }, "No package.json found — skipping dependency install");
    return;
  }

  log.info({ pluginDir }, "Installing plugin dependencies");
  try {
    execSync("npm install --production --prefer-offline", {
      cwd: pluginDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    log.info({ pluginDir }, "Plugin dependencies installed");
  } catch (err) {
    throw new Error(`Failed to install dependencies in ${pluginDir}: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install a plugin from a marketplace registry.
 *
 * Steps:
 *  1. Fetch the registry to find the entry for `pluginId`.
 *  2. Fetch the plugin's nexus-plugin.json manifest from GitHub.
 *  3. Download the repo tarball from the GitHub API.
 *  4. Extract the plugin's subdirectory to ~/.nexus/plugins/<id>/.
 *  5. Validate the on-disk manifest.
 *  6. Run `npm install` for the plugin's own dependencies.
 *  7. Record the installation in the SQLite database.
 */
export async function installPlugin(
  registryUrl: string,
  pluginId: string,
  { force = false }: { force?: boolean } = {},
): Promise<PluginManifest> {
  if (isInstalled(pluginId) && !force) {
    throw new Error(
      `Plugin "${pluginId}" is already installed. Pass { force: true } to reinstall.`,
    );
  }

  // 1. Find the entry in the registry
  const registry = await fetchRegistry(registryUrl);
  const entry = registry.plugins.find((p) => p.id === pluginId);
  if (!entry) {
    throw new Error(`Plugin "${pluginId}" not found in registry at ${registryUrl}`);
  }

  // 2. Fetch the manifest from GitHub (validates before downloading)
  const manifest = await getPluginDetails(entry.repository, entry.path);
  if (manifest.id !== pluginId) {
    throw new Error(
      `Manifest id mismatch: registry says "${pluginId}" but manifest says "${manifest.id}"`,
    );
  }

  // 3. Prepare install directory
  const pluginsDir = getPluginsDir();
  const destDir = getPluginDir(pluginId);

  // 4. Download tarball
  const tarballUrl = githubTarballUrl(entry.repository);
  const tarballPath = await downloadTarball(tarballUrl, pluginsDir);

  // 5. Extract the plugin's subdirectory
  await extractPlugin(tarballPath, entry.path, destDir);

  // 6. Validate the manifest on disk (re-validate after extraction)
  const diskManifest = readLocalManifest(destDir);

  // 7. Install npm dependencies
  installDependencies(destDir);

  // 8. Record in DB
  recordInstall({
    id: diskManifest.id,
    name: diskManifest.name,
    version: diskManifest.version,
    registryUrl,
    installPath: destDir,
  });

  log.info({ pluginId, version: diskManifest.version }, "Plugin installed successfully");
  return diskManifest;
}

/**
 * Update an already-installed plugin to the latest version in the registry.
 * Equivalent to `installPlugin(..., { force: true })`.
 */
export async function updatePlugin(
  registryUrl: string,
  pluginId: string,
): Promise<PluginManifest> {
  if (!isInstalled(pluginId)) {
    throw new Error(`Plugin "${pluginId}" is not installed — use installPlugin instead`);
  }
  return installPlugin(registryUrl, pluginId, { force: true });
}
