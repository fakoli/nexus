/**
 * `nexus channels` — manage channel adapter configuration.
 *
 * Commands:
 *   nexus channels list              — show configured channels and their status
 *   nexus channels enable <channel>  — enable a channel
 *   nexus channels disable <channel> — disable a channel
 */
import { Command } from "commander";
import { runMigrations, getConfig, setConfig, ChannelsConfigSchema } from "@nexus/core";
import type { ChannelsConfig } from "@nexus/core";

const VALID_CHANNELS = ["telegram", "discord"] as const;
type ValidChannel = (typeof VALID_CHANNELS)[number];

function loadChannelsConfig(): ChannelsConfig {
  const raw = getConfig("channels");
  const result = ChannelsConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    console.error("Corrupt channels config — resetting to defaults.");
    return ChannelsConfigSchema.parse({});
  }
  return result.data;
}

function saveChannelsConfig(cfg: ChannelsConfig): void {
  setConfig("channels", cfg);
}

export const channelsCommand = new Command("channels")
  .description("Manage channel adapters (Telegram, Discord, …)");

channelsCommand
  .command("list")
  .description("Show all channels and whether they are enabled")
  .action(() => {
    runMigrations();
    const cfg = loadChannelsConfig();

    const rows = VALID_CHANNELS.map((id) => {
      const entry = cfg[id];
      const status = entry.enabled ? "enabled" : "disabled";
      const tokenSet = "token" in entry && entry.token ? "(token set)" : "(no token)";
      return `  ${id.padEnd(12)} ${status}  ${tokenSet}`;
    });

    console.log("Channels:");
    for (const row of rows) {
      console.log(row);
    }
  });

channelsCommand
  .command("enable <channel>")
  .description("Enable a channel adapter")
  .option("--token <token>", "Bot/API token for the channel")
  .action((channel: string, opts: { token?: string }) => {
    runMigrations();

    if (!VALID_CHANNELS.includes(channel as ValidChannel)) {
      console.error(
        `Unknown channel: "${channel}". Valid channels: ${VALID_CHANNELS.join(", ")}`,
      );
      process.exit(1);
    }

    const id = channel as ValidChannel;
    const cfg = loadChannelsConfig();
    cfg[id] = {
      ...cfg[id],
      enabled: true,
      ...(opts.token ? { token: opts.token } : {}),
    };
    saveChannelsConfig(cfg);
    console.log(`Channel "${id}" enabled.`);
  });

channelsCommand
  .command("disable <channel>")
  .description("Disable a channel adapter")
  .action((channel: string) => {
    runMigrations();

    if (!VALID_CHANNELS.includes(channel as ValidChannel)) {
      console.error(
        `Unknown channel: "${channel}". Valid channels: ${VALID_CHANNELS.join(", ")}`,
      );
      process.exit(1);
    }

    const id = channel as ValidChannel;
    const cfg = loadChannelsConfig();
    cfg[id] = { ...cfg[id], enabled: false };
    saveChannelsConfig(cfg);
    console.log(`Channel "${id}" disabled.`);
  });
