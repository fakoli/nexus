import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getDb, runMigrations, getDataDir, getAllConfig, retrieveCredential, getConfig } from "@nexus/core";

const PASS = "\u2713";
const FAIL = "\u2717";

interface Check {
  label: string;
  passed: boolean;
  note: string;
}

function checkDataDir(): Check {
  const dir = getDataDir();
  let passed = false;
  let note = "";
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    passed = true;
    note = `${dir.replace(process.env.HOME ?? "", "~")} (exists, writable)`;
  } catch {
    note = `${dir} (not writable)`;
  }
  return { label: "Data directory", passed, note };
}

function checkDatabase(): Check {
  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, "nexus.db");
  if (!fs.existsSync(dbPath)) {
    return { label: "Database", passed: false, note: "nexus.db not found (run: nexus onboard)" };
  }
  try {
    runMigrations();
    const db = getDb();
    const version = db.pragma("user_version", { simple: true }) as number;
    const tableCount = (
      db.prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }
    ).n;
    return {
      label: "Database",
      passed: true,
      note: `nexus.db (v${version}, ${tableCount} tables)`,
    };
  } catch (err) {
    return {
      label: "Database",
      passed: false,
      note: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkApiKey(): Check {
  const envKey =
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.NEXUS_API_KEY;
  if (envKey) {
    return { label: "API key", passed: true, note: "configured (from environment)" };
  }
  try {
    const stored =
      retrieveCredential("anthropic.apiKey") ?? retrieveCredential("openai.apiKey");
    if (stored) {
      return { label: "API key", passed: true, note: "configured (from vault)" };
    }
  } catch {
    // vault not accessible yet
  }
  return {
    label: "API key",
    passed: false,
    note: "not configured (set with: nexus secrets set anthropic <key>)",
  };
}

function checkGatewayToken(): Check {
  try {
    const config = getAllConfig();
    if (config.security.gatewayToken) {
      return { label: "Gateway token", passed: true, note: "configured" };
    }
  } catch {
    // db not ready
  }
  return {
    label: "Gateway token",
    passed: false,
    note: "not set (run: nexus onboard)",
  };
}

async function checkGatewayReachable(): Promise<Check> {
  let port = 18789;
  try {
    const config = getAllConfig();
    port = config.gateway.port;
  } catch {
    // use default
  }
  const url = `http://localhost:${port}/healthz`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      return { label: "Gateway", passed: true, note: `reachable at ws://localhost:${port}/ws` };
    }
    return {
      label: "Gateway",
      passed: false,
      note: `HTTP ${res.status} from ${url} (run: nexus gateway run)`,
    };
  } catch {
    return {
      label: "Gateway",
      passed: false,
      note: `not reachable at ${url} (run: nexus gateway run)`,
    };
  }
}

function checkChannels(): Check {
  try {
    const channels = getConfig("channels") as unknown[] | undefined;
    if (Array.isArray(channels) && channels.length > 0) {
      return { label: "Channels", passed: true, note: `${channels.length} configured` };
    }
  } catch {
    // db not ready
  }
  return { label: "Channels", passed: false, note: "none configured" };
}

function checkPlugins(): Check {
  try {
    const plugins = getConfig("plugins.installed");
    const count = Array.isArray(plugins) ? plugins.length : 0;
    return { label: "Plugins", passed: true, note: `${count} installed` };
  } catch {
    return { label: "Plugins", passed: true, note: "0 installed" };
  }
}

async function runDoctor(): Promise<void> {
  console.log("Nexus Doctor \u2014 checking your setup...\n");

  const checks: Check[] = [
    checkDataDir(),
    checkDatabase(),
    checkApiKey(),
    checkGatewayToken(),
    await checkGatewayReachable(),
    checkChannels(),
    checkPlugins(),
  ];

  for (const c of checks) {
    const icon = c.passed ? PASS : FAIL;
    console.log(`  ${icon} ${c.label}: ${c.note}`);
  }

  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  console.log(
    `\nResult: ${passed}/${total} checks passed.` +
      (passed < total ? " Fix the \u2717 items above." : " All good!"),
  );

  if (passed < total) process.exit(1);
}

export const doctorCommand = new Command("doctor")
  .alias("check")
  .description("Diagnose your Nexus setup and report any configuration issues")
  .action(runDoctor);
