import { Command } from "commander";
import readline from "node:readline";
import crypto from "node:crypto";
import { runMigrations, storeCredential, setConfig, getOrCreateAgent, getDataDir } from "@nexus/core";

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function checkEnvironment(): Promise<void> {
  console.log("\nStep 1/5: Check environment");
  const nodeVersion = process.version;
  console.log(`  \u2713 Node.js ${nodeVersion}`);

  // Verify better-sqlite3 is loadable (it's a native dep — if we got here, it works)
  try {
    await import("better-sqlite3");
    console.log("  \u2713 SQLite available");
  } catch {
    console.log("  \u2717 SQLite not available");
    throw new Error("SQLite is required. Run: npm install better-sqlite3");
  }
}

async function chooseProvider(rl: readline.Interface): Promise<"anthropic" | "openai"> {
  console.log("\nStep 2/5: Choose your AI provider");
  console.log("  1. Anthropic (Claude) \u2014 recommended");
  console.log("  2. OpenAI (GPT)");
  const answer = (await prompt(rl, "  > ")).trim();
  return answer === "2" ? "openai" : "anthropic";
}

async function enterApiKey(
  rl: readline.Interface,
  provider: "anthropic" | "openai",
): Promise<string> {
  console.log("\nStep 3/5: Enter your API key");
  if (provider === "anthropic") {
    console.log("  (get one at https://console.anthropic.com/settings/keys)");
  } else {
    console.log("  (get one at https://platform.openai.com/api-keys)");
  }
  const key = (await prompt(rl, "  > ")).trim();
  if (!key) throw new Error("API key cannot be empty.");

  storeCredential(`${provider}.apiKey`, provider, key);
  console.log("  \u2713 Key stored securely");
  return key;
}

async function setupGatewayToken(rl: readline.Interface): Promise<string> {
  console.log("\nStep 4/5: Set gateway security token");
  console.log("  (auto-generate one? Y/n)");
  const answer = (await prompt(rl, "  > ")).trim().toLowerCase();

  let token: string;
  if (answer === "" || answer === "y") {
    token = "nxs_" + crypto.randomBytes(16).toString("hex");
  } else {
    token = (await prompt(rl, "  Enter token: ")).trim();
    if (!token) throw new Error("Token cannot be empty.");
  }

  setConfig("security", { gatewayToken: token });
  console.log(`  \u2713 Token: ${token} (saved)`);
  return token;
}

async function initDatabase(): Promise<void> {
  console.log("\nStep 5/5: Initialize database");
  runMigrations();
  const dataDir = getDataDir();
  console.log(`  \u2713 Database created at ${dataDir}/nexus.db`);
  console.log("  \u2713 Migrations complete");

  getOrCreateAgent("default", { name: "Default Agent" });
  console.log("  \u2713 Default agent created");
}

async function runOnboard(): Promise<void> {
  console.log("Welcome to Nexus! Let's set up your AI assistant.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    await checkEnvironment();
    const provider = await chooseProvider(rl);
    await enterApiKey(rl, provider);
    await setupGatewayToken(rl);
    await initDatabase();

    console.log("\nSetup complete! Start your assistant:");
    console.log("  npx tsx packages/cli/src/index.ts gateway run");
    console.log("\nThen open http://localhost:19200/ui/ in your browser.");
  } catch (err) {
    console.error(`\nOnboarding failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

export const onboardCommand = new Command("onboard")
  .alias("init")
  .description("Interactive setup wizard — configure your AI provider, credentials, and database")
  .action(runOnboard);
