#!/usr/bin/env bun

import { Command } from "commander";
import { gatewayCommand } from "./commands/gateway.js";
import { configCommand } from "./commands/config.js";
import { sendCommand } from "./commands/send.js";
import { statusCommand } from "./commands/status.js";
import { pluginsCommand } from "./commands/plugins.js";

const pkg = await import("../package.json");

const program = new Command()
  .name("nexus")
  .description("Nexus AI gateway CLI")
  .version(pkg.version);

program.addCommand(gatewayCommand);
program.addCommand(configCommand);
program.addCommand(sendCommand);
program.addCommand(statusCommand);
program.addCommand(pluginsCommand);

program.parseAsync(process.argv);
