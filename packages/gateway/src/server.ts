/**
 * Nexus Gateway — Hono HTTP server with WebSocket upgrade.
 *
 * HTTP routes:
 *   GET /healthz     — liveness probe
 *   GET /api/status  — server status & connected client count
 *   GET /ui/         — serves built UI (SPA)
 *   GET /ui/*        — serves static assets from packages/ui/dist
 *   GET /            — redirects to /ui/
 *
 * WebSocket:
 *   /ws — full-duplex RPC + event stream
 *
 * Protocol flow:
 *   1. Client opens WS at /ws.
 *   2. Client sends ConnectParams JSON as first message.
 *   3. Server validates auth, replies with HelloOk or closes with error.
 *   4. Client sends RequestFrames; server replies with ResponseFrames.
 *   5. Server may push EventFrames at any time.
 */
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import type { IncomingMessage, IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";

import {
  runMigrations,
  getOrCreateAgent,
  getOrCreateSession,
  getAllConfig,
  getConfig,
  events,
  createLogger,
  initLogLevel,
  closeDb,
  ChannelsConfigSchema,
  startCronRunner,
  startMemoryMonitor,
  enableHeapSnapshotOnSignal,
} from "@nexus/core";

import {
  registerAdapter,
  startAdapter,
  stopAllAdapters,
  listAdapters,
} from "@nexus/channels";
import { TelegramAdapter } from "@nexus/telegram";
import { DiscordAdapter } from "@nexus/discord";

import {
  ConnectParams,
  RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type HelloOk,
} from "./protocol/frames.js";
import { authenticate } from "./middleware/auth.js";
import { handleChatSend, handleChatHistory } from "./handlers/chat.js";
import { handleSessionsList, handleSessionsCreate } from "./handlers/sessions.js";
import { handleConfigGet, handleConfigSet } from "./handlers/config.js";
import { handleAgentRun } from "./handlers/agent.js";
import { handleAgentStream, setBroadcast } from "./handlers/agent-stream.js";
import {
  handleCronList,
  handleCronCreate,
  handleCronUpdate,
  handleCronDelete,
  handleCronRun,
  handleCronHistory,
} from "./handlers/cron.js";
import {
  handleUsageSummary,
  handleUsageBySession,
  handleUsageByModel,
  handleUsageTimeSeries,
} from "./handlers/usage.js";
import {
  handleMemoryAdd,
  handleMemoryGet,
  handleMemoryUpdate,
  handleMemoryDelete,
  handleMemorySearch,
  handleMemoryList,
} from "./handlers/memory.js";
import {
  handleAgentsList,
  handleAgentsGet,
  handleAgentsCreate,
  handleAgentsUpdate,
  handleAgentsDelete,
  handleAgentsDuplicate,
  handleBootstrapGet,
  handleBootstrapSet,
  handleBootstrapList,
} from "./handlers/agents.js";
import {
  handleSpeechTTS,
  handleSpeechSTT,
  handleSpeechVoices,
} from "./handlers/speech.js";

// ── Plugin system ────────────────────────────────────────────────────
import { listInstalled, loadPlugin, unloadPlugin } from "@nexus/plugins";
import {
  handlePluginsList,
  handlePluginsInstall,
  handlePluginsUninstall,
  handlePluginsSearch,
} from "./handlers/plugins.js";
import {
  handleSkillsList,
  handleSkillsInstall,
  handleSkillsSearch,
} from "./handlers/skills.js";

// ── Federation system ────────────────────────────────────────────────
import {
  handleFederationPeers,
  handleFederationConnect,
  handleFederationDisconnect,
  handleFederationStatus,
} from "./handlers/federation.js";
import {
  startFederation,
  stopFederation,
  handleFederationConnection,
} from "./federation/index.js";
import { FederationConfigSchema } from "./federation/config.js";

const log = createLogger("gateway:server");

const PROTO_VERSION = 1;
const SERVER_NAME = "nexus-gateway";
const SERVER_VERSION = "0.1.0";

// ── Connected-client bookkeeping ────────────────────────────────────

interface ClientState {
  id: string;
  ws: WebSocket;
  sessionId: string;
  agentId: string;
  authed: boolean;
  /** Unix timestamp (ms) of the last received pong from this client. */
  lastPong: number;
}

const clients = new Map<string, ClientState>();
let eventSeq = 0;

// ── RPC dispatch table ──────────────────────────────────────────────

type Handler = (params: Record<string, unknown>) => ResponseFrame | Promise<ResponseFrame>;

const handlers: Record<string, Handler> = {
  "chat.send": handleChatSend,
  "chat.history": handleChatHistory,
  "sessions.list": handleSessionsList,
  "sessions.create": handleSessionsCreate,
  "config.get": handleConfigGet,
  "config.set": handleConfigSet,
  "agent.run": handleAgentRun,
  "agent.stream": handleAgentStream,
  "agents.list": handleAgentsList,
  "agents.get": handleAgentsGet,
  "agents.create": handleAgentsCreate,
  "agents.update": handleAgentsUpdate,
  "agents.delete": handleAgentsDelete,
  "agents.duplicate": handleAgentsDuplicate,
  "agents.bootstrap.get": handleBootstrapGet,
  "agents.bootstrap.set": handleBootstrapSet,
  "agents.bootstrap.list": handleBootstrapList,
  "cron.list": handleCronList,
  "cron.create": handleCronCreate,
  "cron.update": handleCronUpdate,
  "cron.delete": handleCronDelete,
  "cron.run": handleCronRun,
  "cron.history": handleCronHistory,
  "usage.summary": handleUsageSummary,
  "usage.by-session": handleUsageBySession,
  "usage.by-model": handleUsageByModel,
  "usage.timeseries": handleUsageTimeSeries,
  "memory.add": handleMemoryAdd,
  "memory.get": handleMemoryGet,
  "memory.update": handleMemoryUpdate,
  "memory.delete": handleMemoryDelete,
  "memory.search": handleMemorySearch,
  "memory.list": handleMemoryList,
  "speech.tts": handleSpeechTTS,
  "speech.stt": handleSpeechSTT,
  "speech.voices": handleSpeechVoices,
  "plugins.list": handlePluginsList,
  "plugins.install": handlePluginsInstall,
  "plugins.uninstall": handlePluginsUninstall,
  "plugins.search": handlePluginsSearch,
  "skills.list": handleSkillsList,
  "skills.install": handleSkillsInstall,
  "skills.search": handleSkillsSearch,
  "federation.peers": handleFederationPeers,
  "federation.connect": handleFederationConnect,
  "federation.disconnect": handleFederationDisconnect,
  "federation.status": handleFederationStatus,
};

log.info({ methods: Object.keys(handlers) }, "RPC handlers registered");

// ── Broadcast helper ────────────────────────────────────────────────

function broadcast(event: string, payload: Record<string, unknown>): void {
  const frame: EventFrame = { event, payload, seq: ++eventSeq };
  const data = JSON.stringify(frame);
  for (const client of clients.values()) {
    if (client.authed && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

// Wire the streaming handler's broadcast dependency immediately.
setBroadcast(broadcast);

// ── Core-event forwarding ───────────────────────────────────────────

/**
 * Register core-event listeners that forward events to all authed WS clients.
 * Returns an array of unsubscribe functions; call them all in close() to
 * prevent listener leaks across gateway restarts.
 */
function setupEventForwarding(): Array<() => void> {
  const onSessionCreated = (e: { sessionId: string; agentId: string }) =>
    broadcast("session:created", e as unknown as Record<string, unknown>);

  const onSessionMessage = (e: { sessionId: string; role: string; content: string }) =>
    broadcast("session:message", e as unknown as Record<string, unknown>);

  const onConfigChanged = (e: { key: string; value: unknown }) =>
    broadcast("config:changed", { key: e.key, value: e.value as unknown });

  events.on("session:created", onSessionCreated);
  events.on("session:message", onSessionMessage);
  events.on("config:changed", onConfigChanged);

  return [
    () => events.off("session:created", onSessionCreated),
    () => events.off("session:message", onSessionMessage),
    () => events.off("config:changed", onConfigChanged),
  ];
}

// ── Header normalisation ─────────────────────────────────────────────

/**
 * Flatten Node IncomingHttpHeaders (which allow string[] values for set-cookie
 * and similar headers) into a plain Record<string, string> suitable for the
 * WHATWG Request constructor. Multi-value headers are joined with ", ".
 */
function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

// ── MIME type map ────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
};

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// Resolve the dist directory relative to the monorepo root (process.cwd())
// or an explicit env override so the binary can be relocated.
const UI_DIST_PATH =
  process.env.NEXUS_UI_DIST ??
  path.join(process.cwd(), "packages", "ui", "dist");

// ── Hono app (HTTP routes) ──────────────────────────────────────────

function createApp(): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/api/status", (c) =>
    c.json({
      server: SERVER_NAME,
      version: SERVER_VERSION,
      proto: PROTO_VERSION,
      clients: clients.size,
      uptime: process.uptime(),
    }),
  );

  // ── Static UI serving ─────────────────────────────────────────────

  // Redirect bare root → UI index
  app.get("/", (c) => c.redirect("/ui/"));

  // Redirect /ui (no trailing slash) → /ui/
  app.get("/ui", (c) => c.redirect("/ui/"));

  // Serve all /ui/* requests from the built dist directory.
  // Unknown paths fall back to index.html for SPA client-side routing.
  app.get("/ui/*", async (c) => {
    // Strip the leading /ui prefix to get the relative asset path.
    const reqPath = c.req.path.replace(/^\/ui/, "") || "/";
    const safePath = reqPath === "/" ? "/index.html" : reqPath;

    // Prevent path traversal outside dist directory.
    const resolved = path.resolve(UI_DIST_PATH, "." + safePath);
    if (!resolved.startsWith(path.resolve(UI_DIST_PATH))) {
      return c.text("Forbidden", 403);
    }

    let target = resolved;

    // If the exact file doesn't exist, fall back to index.html for SPA routing.
    if (!fs.existsSync(target)) {
      target = path.join(UI_DIST_PATH, "index.html");
    }

    if (!fs.existsSync(target)) {
      return c.text("UI not built — run `pnpm build` in packages/ui", 404);
    }

    const body = fs.readFileSync(target);
    const mime = getMime(target);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": mime },
    });
  });

  return app;
}

// ── WebSocket message handling ──────────────────────────────────────

async function handleWsMessage(client: ClientState, raw: string): Promise<void> {
  // First message must be ConnectParams for auth.
  if (!client.authed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendError(client.ws, "", "PARSE_ERROR", "Invalid JSON");
      client.ws.close(4400, "Invalid JSON");
      return;
    }

    const connectResult = ConnectParams.safeParse(parsed);
    if (!connectResult.success) {
      sendError(client.ws, "", "INVALID_CONNECT", connectResult.error.message);
      client.ws.close(4400, "Invalid ConnectParams");
      return;
    }

    const authResult = authenticate(connectResult.data, client.id);
    if (!authResult.ok) {
      sendError(client.ws, "", "AUTH_FAILED", authResult.error ?? "Authentication failed");
      client.ws.close(4401, "Auth failed");
      return;
    }

    // Auth succeeded — ensure default agent & session exist.
    const agentId = "default";
    getOrCreateAgent(agentId);
    const sessionId = uuid();
    getOrCreateSession(sessionId, agentId);

    client.authed = true;
    client.sessionId = sessionId;
    client.agentId = agentId;

    const hello: HelloOk = {
      proto: PROTO_VERSION,
      server: { name: SERVER_NAME, version: SERVER_VERSION },
      session: { id: sessionId, agentId },
    };
    client.ws.send(JSON.stringify(hello));
    log.info({ clientId: client.id, sessionId }, "Client authenticated");
    return;
  }

  // Subsequent messages are RPC requests.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(client.ws, "", "PARSE_ERROR", "Invalid JSON");
    return;
  }

  const frameResult = RequestFrame.safeParse(parsed);
  if (!frameResult.success) {
    sendError(client.ws, "", "INVALID_FRAME", frameResult.error.message);
    return;
  }

  const { id, method, params } = frameResult.data;
  const handler = handlers[method];

  if (!handler) {
    sendError(client.ws, id, "METHOD_NOT_FOUND", `Unknown method: ${method}`);
    return;
  }

  try {
    const response = await handler(params);
    response.id = id;
    client.ws.send(JSON.stringify(response));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(client.ws, id, "INTERNAL_ERROR", msg);
  }
}

function sendError(ws: WebSocket, id: string, code: string, message: string): void {
  const frame: ResponseFrame = { id, ok: false, error: { code, message } };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

// ── Public entry point ──────────────────────────────────────────────

export interface GatewayHandle {
  close(): Promise<void>;
  port: number;
}

// ── Plugin loader (runs after migrations) ────────────────────────────

async function loadInstalledPlugins(): Promise<string[]> {
  const installed = listInstalled();
  const loaded: string[] = [];
  for (const entry of installed) {
    try {
      await loadPlugin(entry.id);
      loaded.push(entry.id);
      log.info({ pluginId: entry.id, version: entry.version }, "Plugin loaded at startup");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ pluginId: entry.id, err: msg }, "Failed to load plugin at startup");
    }
  }
  return loaded;
}

async function unloadAllPlugins(pluginIds: string[]): Promise<void> {
  for (const id of pluginIds) {
    try {
      await unloadPlugin(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ pluginId: id, err: msg }, "Failed to unload plugin on shutdown");
    }
  }
}

// ── Channel startup ──────────────────────────────────────────────────

/**
 * Register and start all enabled channel adapters based on stored config.
 * Errors for individual channels are logged but do not abort startup.
 */
async function startChannels(): Promise<void> {
  const raw = getConfig("channels");
  const result = ChannelsConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    log.warn({ err: result.error.message }, "Invalid channels config — skipping channel startup");
    return;
  }
  const channelsCfg = result.data;

  if (channelsCfg.telegram.enabled) {
    const token = channelsCfg.telegram.token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      log.warn("Telegram enabled but no token configured — skipping");
    } else {
      try {
        registerAdapter(new TelegramAdapter({ token }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Failed to register Telegram adapter");
      }
    }
  }

  if (channelsCfg.discord.enabled) {
    const token = channelsCfg.discord.token ?? process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      log.warn("Discord enabled but no token configured — skipping");
    } else {
      try {
        registerAdapter(new DiscordAdapter({ token }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Failed to register Discord adapter");
      }
    }
  }

  const ids = listAdapters();
  for (const id of ids) {
    try {
      await startAdapter(id);
      log.info({ channelId: id }, "Channel adapter started");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ channelId: id, err: msg }, "Failed to start channel adapter");
    }
  }
}

export function startGateway(portOverride?: number): GatewayHandle {
  runMigrations();

  // ── Wire verbose logging from config ──────────────────────────────
  initLogLevel().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "Failed to initialise log level from config");
  });

  // ── Start cron runner ───────────────────────────────────────────────
  const cronRunner = startCronRunner();

  // ── Load installed plugins ──────────────────────────────────────────
  const pluginLoadPromise = loadInstalledPlugins().then((ids) => {
    if (ids.length > 0) {
      log.info({ plugins: ids }, `Loaded ${ids.length} plugin(s)`);
    }
    return ids;
  });

  // ── Start channel adapters ──────────────────────────────────────────
  const channelStartPromise = startChannels().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, "Channel startup encountered an error");
  });

  const config = getAllConfig();
  const port = portOverride ?? config.gateway.port;
  const bindSetting = config.gateway.bind;
  const host = bindSetting === "loopback" ? "127.0.0.1" : "0.0.0.0";

  const app = createApp();
  const eventUnsubs = setupEventForwarding();

  // ── Diagnostics ─────────────────────────────────────────────────────
  const stopMemoryMonitor = startMemoryMonitor();
  const stopHeapSnapshot = enableHeapSnapshotOnSignal();

  // Create a raw Node HTTP server so we can handle both Hono and WS.
  const httpServer = createServer(async (req, res) => {
    const response = await app.fetch(
      new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method,
        headers: flattenHeaders(req.headers),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // ── Federation WebSocket endpoint ───────────────────────────────────
  const federationWss = new WebSocketServer({ server: httpServer, path: "/ws/federation" });
  const fedRaw = getConfig("federation");
  const fedResult = FederationConfigSchema.safeParse(fedRaw ?? {});
  const fedConfig = fedResult.success ? fedResult.data : FederationConfigSchema.parse({});

  if (fedConfig.enabled) {
    startFederation(fedConfig);
    log.info("Federation enabled and started");
  }

  federationWss.on("connection", (ws: WebSocket) => {
    if (!fedConfig.enabled) {
      ws.close(4403, "Federation not enabled");
      return;
    }
    handleFederationConnection(
      ws,
      fedConfig.gatewayId ?? "",
      fedConfig.gatewayName,
      fedConfig.token,
      fedConfig.maxPeers,
    );
  });

  // ── Heartbeat: ping every 30 s ──────────────────────────────────────
  const PING_INTERVAL_MS = 30_000;
  const heartbeatInterval = setInterval(() => {
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }, PING_INTERVAL_MS);

  // ── Stale-client sweep: terminate clients silent for > 90 s ─────────
  const STALE_THRESHOLD_MS = 90_000;
  const SWEEP_INTERVAL_MS = 60_000;
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [clientId, client] of clients) {
      if (now - client.lastPong > STALE_THRESHOLD_MS) {
        log.warn({ clientId }, "Terminating stale WS client (no pong)");
        client.ws.terminate();
        clients.delete(clientId);
      }
    }
  }, SWEEP_INTERVAL_MS);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Always use a UUID so that two simultaneous connections from the same IP
    // get distinct map entries (using remoteAddress caused the second connection
    // to silently overwrite the first, leaking the first socket).
    const clientId = uuid();
    const remoteAddr = req.socket.remoteAddress ?? "unknown";
    const client: ClientState = {
      id: clientId,
      ws,
      sessionId: "",
      agentId: "",
      authed: false,
      lastPong: Date.now(),
    };
    clients.set(clientId, client);
    log.info({ clientId, remoteAddr }, "WS connected");

    ws.on("pong", () => {
      client.lastPong = Date.now();
    });

    ws.on("message", (data) => {
      // handleWsMessage is async; attach a .catch() so that any unhandled
      // rejection sends an error frame instead of crashing the process.
      handleWsMessage(client, data.toString()).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ clientId, err: msg }, "Unhandled error in WS message handler");
        sendError(client.ws, "", "INTERNAL_ERROR", "Unexpected server error");
      });
    });

    ws.on("close", () => {
      clients.delete(clientId);
      log.info({ clientId }, "WS disconnected");
    });

    ws.on("error", (err) => {
      log.error({ clientId, err: err.message }, "WS error");
      clients.delete(clientId);
    });
  });

  httpServer.listen(port, host, () => {
    events.emit("gateway:started", { port });
    log.info({ port, host, bind: bindSetting }, "Nexus gateway listening");
  });

  return {
    port,
    async close() {
      // Stop heartbeat and stale-client sweep intervals.
      clearInterval(heartbeatInterval);
      clearInterval(sweepInterval);

      // Stop diagnostics.
      stopMemoryMonitor();
      stopHeapSnapshot();

      // Unsubscribe core-event listeners.
      for (const unsub of eventUnsubs) {
        unsub();
      }

      // Stop cron runner before draining other subsystems.
      cronRunner.stop();

      // Wait for channel and plugin startup to settle before tearing down.
      await channelStartPromise;
      await stopAllAdapters();

      // Unload plugins before closing DB
      const loadedIds = await pluginLoadPromise;
      await unloadAllPlugins(loadedIds);

      // Stop federation before closing client connections.
      if (fedConfig.enabled) {
        stopFederation();
      }
      federationWss.close();

      for (const client of clients.values()) {
        client.ws.close(1001, "Server shutting down");
      }
      clients.clear();
      wss.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
      closeDb();
      events.emit("gateway:stopped", undefined);
      log.info("Gateway stopped");
    },
  };
}
