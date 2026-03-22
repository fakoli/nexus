/**
 * nexus chat — interactive terminal chat with the Nexus gateway.
 *
 * Usage:  nexus chat [--session <id>] [--port <port>]
 */
import { Command } from "commander";
import readline from "node:readline";
import { runMigrations, getAllConfig } from "@nexus/core";
import WebSocket from "ws";

// ── ANSI helpers ─────────────────────────────────────────────────────
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const SP    = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

function spinner(label: string): NodeJS.Timeout {
  let i = 0;
  process.stdout.write("\n");
  return setInterval(() => { process.stdout.write(`\r${dim(SP[i++ % SP.length])} ${label}`); }, 80);
}
function stopSpinner(t: NodeJS.Timeout): void { clearInterval(t); process.stdout.write("\r\x1b[2K"); }

// ── WS connect + handshake ────────────────────────────────────────────
interface GatewayConn { ws: WebSocket; sessionId: string }

function connect(url: string, token: string | undefined): Promise<GatewayConn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const params: Record<string, unknown> = {
      client: { name: "nexus-cli-chat", version: "0.1.0", platform: process.platform },
    };
    if (token) params.token = token;

    ws.once("open",  () => ws.send(JSON.stringify(params)));
    ws.once("error", reject);
    ws.once("message", (raw: WebSocket.Data) => {
      try {
        const f = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (typeof f.proto === "number" && f.session) {
          resolve({ ws, sessionId: (f.session as { id: string }).id });
        } else {
          reject(new Error((f.error as { message?: string } | undefined)?.message ?? "Auth failed"));
        }
      } catch (e) { reject(e); }
    });
    setTimeout(() => reject(new Error("Connection timed out")), 5000);
  });
}

// ── Built-in slash-command handler ───────────────────────────────────
async function handleSlash(
  input: string,
  conn: GatewayConn,
  rpc: (m: string, p: Record<string, unknown>) => Promise<string>,
  setModel: (m: string) => void,
): Promise<boolean> {
  if (input === "/exit" || input === "/quit") { conn.ws.close(); process.exit(0); }

  if (input === "/new") {
    const res = await rpc("sessions.create", { agentId: "default" });
    try {
      const p = JSON.parse(res) as { session?: { id: string } };
      if (p.session?.id) { conn.sessionId = p.session.id; console.log(dim(`\nNew session: ${conn.sessionId}\n`)); }
    } catch { console.log(res); }
    return true;
  }

  if (input === "/sessions") {
    const t = spinner("Fetching sessions...");
    console.log(dim("\nSessions:\n") + await rpc("sessions.list", {}) + "\n");
    stopSpinner(t);
    return true;
  }

  if (input.startsWith("/model ")) {
    setModel(input.slice(7).trim());
    console.log(dim(`\nModel set.\n`));
    return true;
  }

  if (input === "/help") {
    console.log(dim("\n  /new               start a new session"));
    console.log(dim("  /sessions          list sessions"));
    console.log(dim("  /model <name>      switch model"));
    console.log(dim("  /exit | Ctrl+C     quit\n"));
    return true;
  }

  return false;
}

// ── Main chat loop ────────────────────────────────────────────────────
async function runChat(opts: { session?: string; port?: number }): Promise<void> {
  runMigrations();
  const config = getAllConfig();
  const port  = opts.port ?? config.gateway.port;
  const host  = config.gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
  const url   = `ws://${host}:${port}/ws`;
  const token = config.security.gatewayToken ?? process.env.NEXUS_GATEWAY_TOKEN;

  console.log(bold("\nNexus Chat") + dim(" — type /help for commands\n"));

  let conn: GatewayConn;
  try { conn = await connect(url, token); }
  catch (err) {
    console.error(red("Cannot connect: ") + (err instanceof Error ? err.message : String(err)));
    console.error(dim("  Run: nexus gateway run"));
    process.exit(1);
  }

  if (opts.session) conn.sessionId = opts.session;
  console.log(dim(`session: ${conn.sessionId}\n`));

  let pendingResolve: ((t: string) => void) | null = null;
  let responseBuffer = "";
  let usageInfo = "";
  let currentModel: string | undefined;
  let reqN = 0;

  conn.ws.on("message", (raw: WebSocket.Data) => {
    let f: Record<string, unknown>;
    try { f = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }

    if (typeof f.event === "string") {                     // EventFrame
      const p = f.payload as Record<string, unknown> | undefined;
      if (f.event === "agent:delta" && p) {
        if (p.type === "text" && typeof p.text === "string") {
          responseBuffer += p.text;
          process.stdout.write(p.text);
        } else if (p.type === "done") {
          const u = p.usage as { inputTokens?: number; outputTokens?: number } | undefined;
          if (u) usageInfo = `(tokens: in=${u.inputTokens ?? "?"} out=${u.outputTokens ?? "?"})`;
          pendingResolve?.(responseBuffer); pendingResolve = null;
        }
        if (p.error) { pendingResolve?.(""); pendingResolve = null; }
      }
    } else if (typeof f.id === "string" && pendingResolve) {  // ResponseFrame
      const payload = f.ok === false
        ? `ERROR: ${(f.error as { message?: string } | undefined)?.message ?? JSON.stringify(f)}`
        : JSON.stringify(f.payload ?? {}, null, 2);
      pendingResolve(payload); pendingResolve = null;
    }
  });

  conn.ws.on("close", () => process.exit(0));

  function rpc(method: string, params: Record<string, unknown>): Promise<string> {
    return new Promise((res) => {
      reqN++; pendingResolve = res; responseBuffer = ""; usageInfo = "";
      conn.ws.send(JSON.stringify({ id: `r${reqN}`, method, params }));
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.on("SIGINT", () => { conn.ws.close(); process.exit(0); });

  function ask(): void {
    rl.question(cyan("you > "), async (line: string) => {
      const input = line.trim();
      if (!input) { ask(); return; }

      // Multi-line continuation
      let full = input;
      while (full.endsWith("\\")) {
        full = full.slice(0, -1) + "\n";
        const more = await new Promise<string>((r) => rl.question(cyan("... "), r));
        full += more.trim();
      }

      if (await handleSlash(full, conn, rpc, (m) => { currentModel = m; })) { ask(); return; }

      // Send to agent
      const t = spinner("Thinking...");
      process.stdout.write(`\n${green("ai > ")}`);
      const streamParams: Record<string, unknown> = { sessionId: conn.sessionId, message: full };
      if (currentModel) streamParams.model = currentModel;
      await rpc("agent.stream", streamParams);
      stopSpinner(t);
      process.stdout.write("\n");
      if (usageInfo) console.log(dim(usageInfo));
      process.stdout.write("\n");
      ask();
    });
  }

  ask();
}

export const chatCommand = new Command("chat")
  .description("Interactive terminal chat with the Nexus AI assistant")
  .option("-s, --session <id>", "resume a specific session ID")
  .option("-p, --port <port>", "gateway port (overrides config)", parseInt)
  .action(async (opts: { session?: string; port?: number }) => { await runChat(opts); });
