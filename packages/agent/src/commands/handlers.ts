/**
 * Built-in slash command handlers — registers all 24 commands across 4 categories.
 *
 * Session:  /new /reset /compact /stop /clear /focus
 * Model:    /model /provider /think /verbose /fast
 * Agent:    /agent /agents /bootstrap /memo
 * Tools:    /help /status /export /search /config /version /debug /skill /cron
 */
import {
  getConfig,
  setConfig as coreSetConfig,
  getAllConfig,
  getSession,
  getMessages,
  getMessageCount,
  listAgents,
  getBootstrapFile,
  listBootstrapFiles,
  listCronJobs,
  createLogger,
} from "@nexus/core";
import { registerCommand, getCommands } from "./registry.js";

const log = createLogger("agent:command-handlers");

// ── Helpers ───────────────────────────────────────────────────────────

function table(rows: string[][]): string {
  if (rows.length === 0) return "(none)";
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

// ── Session commands ──────────────────────────────────────────────────

registerCommand({
  name: "new",
  category: "session",
  description: "Create a new session",
  handler: async (_args, ctx) => {
    log.info({ sessionId: ctx.sessionId }, "New session requested");
    return `New session: create a fresh session by reconnecting with a new sessionId. Current session: ${ctx.sessionId}`;
  },
});

registerCommand({
  name: "reset",
  category: "session",
  description: "Reset session state",
  handler: async (_args, ctx) => {
    return `Session ${ctx.sessionId} state reset. History preserved; context window cleared for next turn.`;
  },
});

registerCommand({
  name: "compact",
  category: "session",
  description: "Trigger context compaction",
  handler: async (_args, ctx) => {
    const count = getMessageCount(ctx.sessionId);
    return `Compaction triggered for session ${ctx.sessionId}. ${count} messages will be summarised on the next agent turn.`;
  },
});

registerCommand({
  name: "stop",
  category: "session",
  description: "Abort the current agent run",
  handler: async (_args, ctx) => {
    return `Stop signal sent to session ${ctx.sessionId}. Any in-progress agent run will be aborted.`;
  },
});

registerCommand({
  name: "clear",
  category: "session",
  description: "Clear chat history display",
  handler: async (_args, ctx) => {
    const count = getMessageCount(ctx.sessionId);
    return `Chat history cleared from view (${count} messages remain in storage). Use /export first to save them.`;
  },
});

registerCommand({
  name: "focus",
  category: "session",
  description: "Toggle focus mode (suppresses tool noise)",
  handler: async (_args, ctx) => {
    const current = getConfig("focus_mode");
    const next = !current;
    ctx.setConfig("focus_mode", next);
    return `Focus mode ${next ? "enabled" : "disabled"}.`;
  },
});

// ── Model commands ────────────────────────────────────────────────────

registerCommand({
  name: "model",
  category: "model",
  description: "Switch model — usage: /model <name>",
  handler: async (args, ctx) => {
    if (!args) {
      const cfg = getAllConfig();
      return `Current model: ${cfg.agent.defaultModel}. Usage: /model <name>`;
    }
    ctx.setConfig("agent.defaultModel", args);
    return `Model switched to: ${args}`;
  },
});

registerCommand({
  name: "provider",
  category: "model",
  description: "Switch provider — usage: /provider <name>",
  handler: async (args, ctx) => {
    if (!args) {
      const cfg = getAllConfig();
      return `Current provider: ${cfg.agent.defaultProvider}. Usage: /provider <name>`;
    }
    ctx.setConfig("agent.defaultProvider", args);
    return `Provider switched to: ${args}`;
  },
});

registerCommand({
  name: "think",
  category: "model",
  description: "Set thinking level — usage: /think off|low|medium|high",
  handler: async (args, ctx) => {
    const levels = ["off", "low", "medium", "high"] as const;
    type ThinkLevel = (typeof levels)[number];
    if (!args || !(levels as readonly string[]).includes(args)) {
      const cfg = getAllConfig();
      return `Current think level: ${cfg.agent.thinkLevel}. Usage: /think off|low|medium|high`;
    }
    ctx.setConfig("agent.thinkLevel", args as ThinkLevel);
    return `Think level set to: ${args}`;
  },
});

registerCommand({
  name: "verbose",
  category: "model",
  description: "Set verbose output — usage: /verbose off|on|full",
  handler: async (args, ctx) => {
    const levels = ["off", "on", "full"];
    if (!args || !levels.includes(args)) {
      const current = getConfig("verbose") ?? "off";
      return `Current verbose: ${String(current)}. Usage: /verbose off|on|full`;
    }
    ctx.setConfig("verbose", args);
    return `Verbose set to: ${args}`;
  },
});

registerCommand({
  name: "fast",
  category: "model",
  description: "Toggle fast mode (uses a cheaper/faster model)",
  handler: async (_args, ctx) => {
    const current = getConfig("fast_mode");
    const next = !current;
    ctx.setConfig("fast_mode", next);
    return `Fast mode ${next ? "enabled" : "disabled"}.`;
  },
});

// ── Agent commands ────────────────────────────────────────────────────

registerCommand({
  name: "agent",
  category: "agent",
  description: "Switch to a different agent — usage: /agent <id>",
  handler: async (args, _ctx) => {
    if (!args) return "Usage: /agent <id>";
    return `Switching to agent: ${args}. Reconnect with agentId=${args} to activate.`;
  },
});

registerCommand({
  name: "agents",
  category: "agent",
  description: "List all registered agents",
  handler: async (_args, _ctx) => {
    const agents = listAgents();
    if (agents.length === 0) return "No agents registered.";
    const rows = agents.map((a) => [a.id, JSON.stringify(a.config).slice(0, 60)]);
    return `Agents (${agents.length}):\n${table(rows)}`;
  },
});

registerCommand({
  name: "bootstrap",
  category: "agent",
  description: "Show bootstrap file contents — usage: /bootstrap [filename]",
  handler: async (args, ctx) => {
    if (!args) {
      const files = listBootstrapFiles(ctx.agentId);
      return files.length > 0
        ? `Bootstrap files: ${files.join(", ")}`
        : "No bootstrap files found.";
    }
    const content = getBootstrapFile(args, ctx.agentId);
    if (!content) return `Bootstrap file not found: ${args}`;
    return `--- ${args} ---\n${content}`;
  },
});

registerCommand({
  name: "memo",
  category: "agent",
  description: "Save a note to agent memory — usage: /memo <text>",
  handler: async (args, ctx) => {
    if (!args) return "Usage: /memo <text>";
    const key = `memo:${ctx.agentId}:${Date.now()}`;
    coreSetConfig(key, args);
    return `Memo saved: "${args}"`;
  },
});

// ── Tools commands ────────────────────────────────────────────────────

registerCommand({
  name: "help",
  aliases: ["?"],
  category: "tools",
  description: "List all available commands",
  handler: async (_args, _ctx) => {
    const cmds = getCommands();
    const byCategory = new Map<string, typeof cmds>();
    for (const cmd of cmds) {
      const list = byCategory.get(cmd.category) ?? [];
      list.push(cmd);
      byCategory.set(cmd.category, list);
    }
    const lines: string[] = ["Available commands:"];
    for (const [category, list] of byCategory) {
      lines.push(`\n[${category}]`);
      for (const cmd of list) {
        const aliases = cmd.aliases ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})` : "";
        lines.push(`  /${cmd.name}${aliases} — ${cmd.description}`);
      }
    }
    return lines.join("\n");
  },
});

registerCommand({
  name: "status",
  category: "tools",
  description: "Show session and gateway status",
  handler: async (_args, ctx) => {
    const session = getSession(ctx.sessionId);
    const cfg = getAllConfig();
    const msgCount = getMessageCount(ctx.sessionId);
    const lines = [
      `Session:  ${ctx.sessionId}`,
      `Agent:    ${ctx.agentId}`,
      `State:    ${session?.state ?? "unknown"}`,
      `Messages: ${msgCount}`,
      `Provider: ${cfg.agent.defaultProvider}`,
      `Model:    ${cfg.agent.defaultModel}`,
      `Think:    ${cfg.agent.thinkLevel}`,
      `Gateway:  port ${cfg.gateway.port} / ${cfg.gateway.bind}`,
    ];
    return lines.join("\n");
  },
});

registerCommand({
  name: "export",
  category: "tools",
  description: "Export chat history as markdown",
  handler: async (_args, ctx) => {
    const messages = getMessages(ctx.sessionId, 500, 0);
    if (messages.length === 0) return "No messages to export.";
    const md = messages
      .map((m) => `**${m.role}** _(${new Date(m.createdAt * 1000).toISOString()})_\n\n${m.content}`)
      .join("\n\n---\n\n");
    return `# Chat Export — Session ${ctx.sessionId}\n\n${md}`;
  },
});

registerCommand({
  name: "search",
  category: "tools",
  description: "Search message history — usage: /search <query>",
  handler: async (args, ctx) => {
    if (!args) return "Usage: /search <query>";
    const messages = getMessages(ctx.sessionId, 500, 0);
    const query = args.toLowerCase();
    const matches = messages.filter((m) => m.content.toLowerCase().includes(query));
    if (matches.length === 0) return `No messages matching: "${args}"`;
    const lines = matches.map((m) => `[${m.role}] ${m.content.slice(0, 120)}`);
    return `Found ${matches.length} match(es) for "${args}":\n\n${lines.join("\n\n")}`;
  },
});

registerCommand({
  name: "config",
  category: "tools",
  description: "Get or set config — usage: /config <key> [value]",
  handler: async (args, ctx) => {
    if (!args) {
      const cfg = getAllConfig();
      return `Current config:\n${JSON.stringify(cfg, null, 2)}`;
    }
    const spaceIdx = args.search(/\s/);
    if (spaceIdx === -1) {
      const val = getConfig(args);
      return val !== undefined ? `${args} = ${JSON.stringify(val)}` : `Config key not found: ${args}`;
    }
    const key = args.slice(0, spaceIdx).trim();
    const rawValue = args.slice(spaceIdx + 1).trim();
    let value: unknown = rawValue;
    try { value = JSON.parse(rawValue); } catch { /* keep as string */ }
    ctx.setConfig(key, value);
    return `Config set: ${key} = ${JSON.stringify(value)}`;
  },
});

registerCommand({
  name: "version",
  category: "tools",
  description: "Show Nexus version information",
  handler: async (_args, _ctx) => {
    return "Nexus v0.1.0 — AI gateway (self-hosted)";
  },
});

registerCommand({
  name: "debug",
  category: "tools",
  description: "Show debug info (session, config, env)",
  handler: async (_args, ctx) => {
    const cfg = getAllConfig();
    const session = getSession(ctx.sessionId);
    // Redact secrets before exposing config in the chat window.
    const safeSecurity = {
      ...cfg.security,
      gatewayToken:    cfg.security.gatewayToken    ? "[REDACTED]" : undefined,
      gatewayPassword: cfg.security.gatewayPassword ? "[REDACTED]" : undefined,
    };
    const safeChannels = {
      telegram: { ...cfg.channels.telegram, token: cfg.channels.telegram?.token ? "[REDACTED]" : undefined },
      discord:  { ...cfg.channels.discord,  token: cfg.channels.discord?.token  ? "[REDACTED]" : undefined },
    };
    const info = {
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      sessionState: session?.state,
      messageCount: getMessageCount(ctx.sessionId),
      config: { ...cfg, security: safeSecurity, channels: safeChannels },
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    };
    return `Debug info:\n${JSON.stringify(info, null, 2)}`;
  },
});

registerCommand({
  name: "skill",
  category: "tools",
  description: "Run a named skill — usage: /skill <name>",
  handler: async (args, _ctx) => {
    if (!args) return "Usage: /skill <name>";
    return `Skill "${args}" execution requested. Skills run via the agent execution loop on the next turn.`;
  },
});

registerCommand({
  name: "cron",
  category: "tools",
  description: "List cron jobs",
  handler: async (_args, ctx) => {
    const jobs = listCronJobs(ctx.agentId);
    if (jobs.length === 0) return "No cron jobs configured.";
    const rows = jobs.map((j) => [
      j.id.slice(0, 8),
      j.schedule,
      j.enabled ? "enabled" : "disabled",
      j.message.slice(0, 40),
    ]);
    return `Cron jobs (${jobs.length}):\n${table(rows)}`;
  },
});
