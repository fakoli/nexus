/**
 * Barrel export for the slash command framework.
 *
 * Importing this module also registers all built-in command handlers as a
 * side-effect (via the handlers module).
 */
export {
  registerCommand,
  getCommands,
  executeSlashCommand,
} from "./registry.js";
export type { SlashCommand, CommandContext, ExecuteResult } from "./registry.js";

// Side-effect import — registers all 24 built-in commands.
import "./handlers.js";
