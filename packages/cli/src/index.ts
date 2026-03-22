#!/usr/bin/env bun

import { Command } from "commander";
import { gatewayCommand } from "./commands/gateway.js";
import { configCommand } from "./commands/config.js";
import { sendCommand } from "./commands/send.js";
import { statusCommand } from "./commands/status.js";
import { pluginsCommand } from "./commands/plugins.js";
import { secretsCommand } from "./commands/secrets.js";
import { onboardCommand } from "./commands/onboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { channelsCommand } from "./commands/channels.js";
import { chatCommand } from "./commands/chat.js";
import { quickstartCommand } from "./commands/quickstart.js";

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
program.addCommand(secretsCommand);
program.addCommand(onboardCommand);
program.addCommand(doctorCommand);
program.addCommand(channelsCommand);
program.addCommand(chatCommand);
program.addCommand(quickstartCommand);

program.parseAsync(process.argv);
