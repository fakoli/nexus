import { Command } from "commander";
import { runMigrations, getAllConfig, createLogger } from "@nexus/core";

const log = createLogger("cli:gateway");

export const gatewayCommand = new Command("gateway")
  .description("Manage the Nexus gateway server");

gatewayCommand
  .command("run")
  .description("Start the gateway server")
  .option("-p, --port <port>", "listen port", parseInt)
  .option("-b, --bind <bind>", "bind mode: loopback | lan | all")
  .option("-v, --verbose", "enable verbose logging")
  .action(async (opts: { port?: number; bind?: string; verbose?: boolean }) => {
    // Gateway registers multiple listeners (channels, plugins, events) — raise the limit
    process.setMaxListeners(20);
    log.info("Initializing gateway...");
    runMigrations();

    const config = getAllConfig();
    const port = opts.port ?? config.gateway.port;
    const bind = opts.bind ?? config.gateway.bind;
    const verbose = opts.verbose ?? config.gateway.verbose;

    log.info({ port, bind, verbose }, "Starting gateway");

    // Dynamic import to avoid loading gateway for non-gateway commands
    const { startGateway } = await import("@nexus/gateway");
    const server = startGateway(port);

    const shutdown = async () => {
      log.info("Shutting down gateway...");
      await server.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
