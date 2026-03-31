/**
 * nexus container — OCI/Wasm container management commands.
 *
 * Subcommands:
 *   run      — Pull and run an OCI Wasm image
 *   stop     — Stop a running container
 *   list     — List all containers
 *   inspect  — Detailed info for a container
 *   logs     — Retrieve captured log lines
 *   remove   — Stop and remove a container
 */
import { Command } from "commander";
import { LifecycleManager, ContainerConfigSchema } from "@nexus/container";

function getManager(): LifecycleManager {
  return new LifecycleManager({ maxLogLines: 10000 });
}

// ── Shared singleton for the session ──────────────────────────────────────────

let _manager: LifecycleManager | null = null;

function mgr(): LifecycleManager {
  if (!_manager) _manager = getManager();
  return _manager;
}

// ── run ───────────────────────────────────────────────────────────────────────

const runCmd = new Command("run")
  .description("Pull and run an OCI Wasm image")
  .argument("<image>", "OCI image reference (e.g. ghcr.io/org/plugin:1.2.3)")
  .option("--env <KEY=VAL>", "Environment variable (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
  .option("--volume <host:guest>", "Volume mount (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
  .option("--host <hostname>", "Allowed outbound hostname (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
  .option("--memory <pages>", "Memory limit in 64 KiB pages", (v) => parseInt(v, 10))
  .option("--timeout <ms>", "Per-call timeout in ms", (v) => parseInt(v, 10))
  .action(async (image: string, opts: {
    env: string[];
    volume: string[];
    host: string[];
    memory?: number;
    timeout?: number;
  }) => {
    const env: Record<string, string> = {};
    for (const e of opts.env) {
      const eqIdx = e.indexOf("=");
      if (eqIdx === -1) { console.error(`Invalid env: ${e}`); process.exit(1); }
      env[e.slice(0, eqIdx)] = e.slice(eqIdx + 1);
    }

    const volumes = opts.volume.map((v) => {
      const colonIdx = v.lastIndexOf(":");
      if (colonIdx === -1) { console.error(`Invalid volume (expected host:guest): ${v}`); process.exit(1); }
      return { hostPath: v.slice(0, colonIdx), guestPath: v.slice(colonIdx + 1) };
    });

    const configResult = ContainerConfigSchema.safeParse({
      image,
      env,
      volumes,
      allowedHosts: opts.host,
      ...(opts.memory !== undefined ? { memoryLimitPages: opts.memory } : {}),
      ...(opts.timeout !== undefined ? { timeoutMs: opts.timeout } : {}),
    });

    if (!configResult.success) {
      console.error(`Invalid config: ${configResult.error.message}`);
      process.exit(1);
    }

    try {
      const result = await mgr().start(configResult.data);
      console.log(`Container started: ${result.containerId}`);
      console.log(`Status: ${result.state.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start container: ${msg}`);
      process.exit(1);
    }
  });

// ── stop ─────────────────────────────────────────────────────────────────────

const stopCmd = new Command("stop")
  .description("Stop a running container")
  .argument("<id>", "Container ID")
  .action(async (id: string) => {
    try {
      await mgr().stop(id);
      console.log(`Container stopped: ${id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to stop container: ${msg}`);
      process.exit(1);
    }
  });

// ── list ─────────────────────────────────────────────────────────────────────

const listCmd = new Command("list")
  .description("List all containers")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    const ids = mgr().listContainerIds();
    if (opts.json) {
      const containers = ids.map((id) => ({ containerId: id, state: mgr().getState(id) }));
      console.log(JSON.stringify(containers, null, 2));
      return;
    }
    if (ids.length === 0) {
      console.log("No containers running.");
      return;
    }
    for (const id of ids) {
      const state = mgr().getState(id);
      console.log(`  ${id}  [${state.status}]`);
    }
  });

// ── inspect ───────────────────────────────────────────────────────────────────

const inspectCmd = new Command("inspect")
  .description("Detailed info for a container")
  .argument("<id>", "Container ID")
  .action(async (id: string) => {
    const entry = mgr().getManagedEntry(id);
    if (!entry) {
      console.error(`Container not found: ${id}`);
      process.exit(1);
    }
    try {
      const inspect = await entry.container.inspect();
      const healthState = mgr().getHealthState(id);
      console.log(JSON.stringify({ ...inspect, healthState }, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Inspect failed: ${msg}`);
      process.exit(1);
    }
  });

// ── logs ──────────────────────────────────────────────────────────────────────

const logsCmd = new Command("logs")
  .description("Retrieve captured log lines for a container")
  .argument("<id>", "Container ID")
  .option("-n, --lines <n>", "Number of lines to show", (v) => parseInt(v, 10), 100)
  .action(async (id: string, opts: { lines: number }) => {
    try {
      const logs = await mgr().getLogs(id, opts.lines);
      if (logs.length === 0) {
        console.log("No logs captured.");
        return;
      }
      for (const entry of logs) {
        console.log(`[${entry.timestamp}] [${entry.stream}] ${entry.message}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Logs failed: ${msg}`);
      process.exit(1);
    }
  });

// ── remove ────────────────────────────────────────────────────────────────────

const removeCmd = new Command("remove")
  .description("Stop and remove a container")
  .argument("<id>", "Container ID")
  .action(async (id: string) => {
    try {
      await mgr().stop(id);
      console.log(`Container removed: ${id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Remove failed: ${msg}`);
      process.exit(1);
    }
  });

// ── Export ────────────────────────────────────────────────────────────────────

export const containerCommand = new Command("container")
  .description("OCI/Wasm container management")
  .addCommand(runCmd)
  .addCommand(stopCmd)
  .addCommand(listCmd)
  .addCommand(inspectCmd)
  .addCommand(logsCmd)
  .addCommand(removeCmd);
