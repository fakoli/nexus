/**
 * Slash command registry.
 *
 * Provides registration, lookup, and execution of slash commands.
 * Commands are identified by a leading "/" in the input string.
 */
import { createLogger } from "@nexus/core";

const log = createLogger("agent:commands");

// ── Types ────────────────────────────────────────────────────────────

export interface CommandContext {
  sessionId: string;
  agentId: string;
  setConfig: (key: string, value: unknown) => void;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  category: string;
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<string>;
}

export interface ExecuteResult {
  handled: boolean;
  response?: string;
}

// ── Internal registry ────────────────────────────────────────────────

const commandRegistry = new Map<string, SlashCommand>();

// ── Public API ───────────────────────────────────────────────────────

export function registerCommand(cmd: SlashCommand): void {
  commandRegistry.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandRegistry.set(alias, cmd);
    }
  }
  log.debug({ name: cmd.name, category: cmd.category }, "Command registered");
}

/**
 * Returns the unique set of registered commands (deduplicated — aliases point
 * to the same SlashCommand object, so we use a Set to avoid duplicates).
 */
export function getCommands(): SlashCommand[] {
  return Array.from(new Set(commandRegistry.values()));
}

/**
 * Parses the input string and dispatches to the matching command handler.
 *
 * Input must start with "/" for a command to be recognised. The first
 * whitespace-delimited token after "/" is the command name; the remainder
 * of the string (trimmed) is passed as args.
 *
 * Returns `{ handled: false }` when:
 * - input does not start with "/"
 * - no command (or alias) matches the parsed name
 */
export async function executeSlashCommand(
  input: string,
  ctx: CommandContext,
): Promise<ExecuteResult> {
  if (!input.startsWith("/")) {
    return { handled: false };
  }

  const trimmed = input.slice(1).trimStart();
  const spaceIdx = trimmed.search(/\s/);
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  if (!name) {
    return { handled: false };
  }

  const cmd = commandRegistry.get(name);
  if (!cmd) {
    log.debug({ name }, "Unknown slash command");
    return { handled: false };
  }

  log.info({ command: name, sessionId: ctx.sessionId }, "Executing slash command");

  try {
    const response = await cmd.handler(args, ctx);
    return { handled: true, response };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ command: name, error: message }, "Slash command failed");
    return { handled: true, response: `Error: ${message}` };
  }
}
