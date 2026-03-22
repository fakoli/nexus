import { Command } from "commander";
import { runMigrations, getAllConfig, getDataDir } from "@nexus/core";
import WebSocket from "ws";

export const statusCommand = new Command("status")
  .description("Show Nexus gateway status and configuration summary")
  .action(async () => {
    runMigrations();
    const config = getAllConfig();
    const dataDir = getDataDir();

    console.log("Nexus Status");
    console.log("============");
    console.log(`Data directory : ${dataDir}`);
    console.log(`Gateway port   : ${config.gateway.port}`);
    console.log(`Gateway bind   : ${config.gateway.bind}`);
    console.log(`Default model  : ${config.agent.defaultModel}`);
    console.log(`DM policy      : ${config.security.dmPolicy}`);
    console.log(`Prompt guard   : ${config.security.promptGuard}`);

    // Check gateway connectivity
    const host = config.gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    const url = `ws://${host}:${config.gateway.port}/ws`;

    const connected = await checkConnection(url);
    console.log(`Gateway status : ${connected ? "running" : "not reachable"}`);
  });

function checkConnection(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 2000 });
    ws.on("open", () => {
      ws.close();
      resolve(true);
    });
    ws.on("error", () => resolve(false));
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 3000);
    ws.on("close", () => clearTimeout(timer));
  });
}
