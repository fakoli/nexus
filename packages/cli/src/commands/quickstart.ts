/**
 * nexus quickstart — one command to get started with Nexus.
 *
 * 1. Checks if already initialized (DB + gateway token).
 * 2. If not, runs the onboard flow.
 * 3. Starts the gateway in the background.
 * 4. Launches `nexus chat` for immediate interaction.
 * 5. On exit, reminds user the gateway is still running.
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { getDataDir, getAllConfig, runMigrations } from "@nexus/core";

// ── ANSI helpers ─────────────────────────────────────────────────────
const C = {
  cyan:  (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim:   (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:  (s: string) => `\x1b[1m${s}\x1b[0m`,
  yellow:(s: string) => `\x1b[33m${s}\x1b[0m`,
};

// ── Initialization check ─────────────────────────────────────────────
function isInitialized(): boolean {
  const dataDir = getDataDir();
  const dbPath  = path.join(dataDir, "nexus.db");
  if (!fs.existsSync(dbPath)) return false;
  try {
    runMigrations();
    const config = getAllConfig();
    return Boolean(config.security.gatewayToken);
  } catch {
    return false;
  }
}

// ── Check if gateway is already up ───────────────────────────────────
async function isGatewayUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Wait for gateway to become ready ─────────────────────────────────
async function waitForGateway(port: number, maxMs = 8000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isGatewayUp(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── Run onboard in-process by spawning it as a sub-command ───────────
function runOnboard(cliEntry: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, "onboard"], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Onboard exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// ── Start gateway in background ───────────────────────────────────────
function startGatewayBackground(cliEntry: string, port: number): ChildProcess {
  const child = spawn(process.execPath, [cliEntry, "gateway", "run", "--port", String(port)], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: false, // keep it as a child so it dies if parent dies ungracefully
  });
  // Allow the process to keep running if parent exits normally (user typed /exit)
  child.unref();
  return child;
}

// ── Launch chat ───────────────────────────────────────────────────────
function launchChat(cliEntry: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, "chat", "--port", String(port)], {
      stdio: "inherit",
    });
    child.on("close", () => resolve());
    child.on("error", reject);
  });
}

// ── Main quickstart flow ──────────────────────────────────────────────
async function runQuickstart(): Promise<void> {
  console.log(C.bold("\nNexus Quickstart\n"));

  // Locate the CLI entry point (same file being executed)
  const cliEntry = process.argv[1];

  // Step 1 — check initialization
  const alreadySetup = isInitialized();
  if (!alreadySetup) {
    console.log(C.yellow("Nexus is not yet set up. Starting onboard wizard...\n"));
    try {
      await runOnboard(cliEntry);
    } catch (err) {
      console.error("Onboard failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    console.log();
  } else {
    console.log(C.green("  Setup already complete.\n"));
  }

  // Reload config after potential onboard
  runMigrations();
  const config = getAllConfig();
  const port = config.gateway.port;

  // Step 2 — ensure gateway is running
  const alreadyUp = await isGatewayUp(port);
  let gatewayChild: ChildProcess | null = null;

  if (alreadyUp) {
    console.log(C.green(`  Gateway already running on port ${port}.\n`));
  } else {
    console.log(C.dim(`  Starting gateway on port ${port}...`));
    gatewayChild = startGatewayBackground(cliEntry, port);

    const ready = await waitForGateway(port);
    if (!ready) {
      console.error(C.yellow("  Gateway did not start in time. Try: nexus gateway run"));
      process.exit(1);
    }
    console.log(C.green(`  Gateway started (pid ${gatewayChild.pid ?? "?"})\n`));
  }

  // Step 3 — launch interactive chat
  console.log(C.dim("  Launching chat...\n"));
  try {
    await launchChat(cliEntry, port);
  } catch (err) {
    console.error("Chat failed:", err instanceof Error ? err.message : String(err));
  }

  // Step 4 — reminder on exit
  console.log();
  if (gatewayChild !== null) {
    console.log(C.yellow("  The Nexus gateway is still running in the background."));
    console.log(C.dim(`  Port ${port}. To stop it, find the process with: lsof -ti :${port} | xargs kill`));
  } else {
    console.log(C.dim("  The Nexus gateway continues to run independently."));
  }
  console.log();
}

// ── Command export ────────────────────────────────────────────────────
export const quickstartCommand = new Command("quickstart")
  .alias("start")
  .description("Set up Nexus, start the gateway, and open an interactive chat session")
  .action(async () => {
    await runQuickstart();
  });
