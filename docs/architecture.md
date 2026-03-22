# Nexus Architecture

## System Overview

Nexus is a monorepo of six core packages plus two channel extension packages. All packages are TypeScript ESM modules and share a single `node_modules` tree via npm workspaces.

```
┌─────────────────────────────────────────────────────────────┐
│                          Clients                            │
│  Browser  ·  nexus CLI  ·  Telegram bot  ·  Discord bot    │
└──────────────┬──────────────────────────┬───────────────────┘
               │ HTTP + WebSocket          │ WebSocket (adapter)
┌──────────────▼──────────────────────────▼───────────────────┐
│                      @nexus/gateway                          │
│                                                             │
│  Hono HTTP server                                           │
│    GET  /healthz          liveness probe                    │
│    GET  /api/status       server status                     │
│    GET  /ui/*             SPA static assets                 │
│    GET  /                 redirect → /ui/                   │
│                                                             │
│  WebSocket server (path: /ws)                               │
│    Auth middleware (token / password / device token)        │
│    RPC dispatch:                                            │
│      chat.send / chat.history                               │
│      sessions.list / sessions.create                        │
│      config.get / config.set                                │
│      agent.run                                              │
│    Event broadcast → all authenticated clients              │
└──────────────┬──────────────────────────────────────────────┘
               │ imports
┌──────────────▼──────────────────────────────────────────────┐
│                       @nexus/core                            │
│                                                             │
│  SQLite (WAL mode)  via better-sqlite3                      │
│    Tables: sessions, messages, agents, config,              │
│            audit_log, rate_limits, paired_devices           │
│                                                             │
│  Modules:                                                   │
│    db.ts        — connection singleton, migration runner    │
│    sessions.ts  — Session + Message CRUD                    │
│    agents.ts    — Agent CRUD                                │
│    config.ts    — Zod-validated key-value config store      │
│    crypto.ts    — master key derivation, encryption helpers │
│    events.ts    — typed in-process EventEmitter bus         │
│    audit.ts     — append-only audit log                     │
│    rate-limit.ts — per-client rate limiting                 │
│    logger.ts    — pino structured logger factory            │
└──────────────┬──────────────────────────────────────────────┘
               │ imports
┌──────────────▼──────────────────────────────────────────────┐
│                      @nexus/agent                            │
│                                                             │
│  execution-loop.ts   — multi-turn agent loop                │
│  context-builder.ts  — assemble message context for provider│
│  tool-executor.ts    — tool registry + dispatch             │
│  providers/          — Anthropic, OpenAI, base interface    │
│  tools/              — bash, filesystem                     │
└──────────────┬──────────────────────────────────────────────┘
               │ imports
┌──────────────▼──────────────────────────────────────────────┐
│                      @nexus/plugins                          │
│                                                             │
│  Plugin loader (dynamic import from registry paths)         │
│  Marketplace client (fetch registry.json, install, update)  │
└─────────────────────────────────────────────────────────────┘

Additional packages:
  @nexus/ui       — SolidJS SPA, built to packages/ui/dist/
  @nexus/cli      — Commander.js entry point, thin wrappers around gateway WS API

Extensions (independent workspace packages):
  @nexus/telegram — Telegram Bot API adapter
  @nexus/discord  — Discord Gateway adapter
```

---

## Module Responsibilities

### `@nexus/core`

The persistence and utilities layer. All other packages depend on it; it depends on nothing inside the monorepo.

- **`db.ts`** — Opens the SQLite file at `~/.nexus/nexus.db` (or `NEXUS_DB_PATH`). Runs migrations on startup. Enables WAL mode and `PRAGMA synchronous = NORMAL` for durability/performance balance.
- **`sessions.ts`** — `createSession`, `getSession`, `listSessions`, `appendMessage`, `getMessages`, `getMessageCount`. JSON metadata fields are always parsed before returning.
- **`config.ts`** — `getConfig`, `setConfig`, `getAllConfig`. Config is stored as JSON in the `config` table. `NexusConfigSchema` validates the full config object on every read.
- **`events.ts`** — Typed `EventEmitter` bus. Events: `session:created`, `session:message`, `config:changed`, `gateway:started`, `gateway:stopped`. The gateway subscribes and forwards these to WebSocket clients.
- **`crypto.ts`** — Master key derivation from `NEXUS_MASTER_KEY` env var or key file. Used for encrypting sensitive config values at rest.

### `@nexus/agent`

The AI execution layer. Stateless — all session state is read from and written to `@nexus/core`.

- **`execution-loop.ts`** — Runs a single agent turn: loads context, calls provider, handles tool use, appends messages, repeats until `end_turn` or `max_tokens`.
- **`context-builder.ts`** — Converts `Message[]` from the database into the provider-specific message array format.
- **`tool-executor.ts`** — Maintains a registry of available tools. Dispatches tool call requests from the provider response.
- **`providers/base.ts`** — `Provider` interface: `complete(messages, tools, options) → ProviderResponse`.
- **`providers/anthropic.ts`** — Anthropic Claude via the `@anthropic-ai/sdk`.
- **`providers/openai.ts`** — OpenAI GPT via the `openai` SDK.
- **`providers/resolver.ts`** — Resolves a provider name string to a `Provider` instance.

### `@nexus/gateway`

The network layer. Exposes HTTP and WebSocket endpoints; delegates all business logic to `@nexus/core` and `@nexus/agent`.

- **`server.ts`** — Hono app + raw Node HTTP server + `ws` WebSocket server. Manages a `Map<clientId, ClientState>` of connected clients.
- **`protocol/frames.ts`** — Zod schemas for `ConnectParams`, `HelloOk`, `RequestFrame`, `ResponseFrame`, `EventFrame`.
- **`middleware/auth.ts`** — Validates `ConnectParams` credentials against config.
- **`handlers/`** — One file per method group. Each handler validates params with Zod, calls core or agent functions, and returns a `ResponseFrame`.

### `@nexus/cli`

The command-line interface. Connects to a running gateway over WebSocket for most commands. `gateway run` starts the gateway in-process.

---

## Data Flow: Agent Turn

```
Client                 Gateway                  Agent                  Core
  │                       │                       │                      │
  │── agent.run ─────────>│                       │                      │
  │   {sessionId,         │── runAgent() ────────>│                      │
  │    message}           │                       │── getMessages() ────>│
  │                       │                       │<─ Message[] ─────────│
  │                       │                       │── contextBuilder     │
  │                       │                       │── provider.complete()│
  │                       │                       │   (Anthropic/OpenAI) │
  │                       │                       │── appendMessage() ──>│
  │                       │                       │   (assistant msg)    │
  │                       │                       │── toolExecutor()     │
  │                       │                       │   [if tool_use]      │
  │                       │                       │── appendMessage() ──>│
  │                       │                       │   (tool_result)      │
  │                       │                       │── provider.complete()│
  │                       │                       │   (repeat until done)│
  │<─ ResponseFrame ──────│<─ AgentResult ────────│                      │
  │   {content, usage}    │                       │                      │
```

---

## Database Schema

Core tables (created by migrations in `packages/core/src/migrations/`):

| Table | Purpose |
|---|---|
| `agents` | Agent definitions (id, name, system_prompt, config_json) |
| `sessions` | Conversation sessions (id, agent_id, channel, peer_id, state) |
| `messages` | All messages (session_id, role, content, metadata_json, seq) |
| `config` | Key-value config store (key, value_json, updated_at) |
| `audit_log` | Append-only audit events (event, actor, target, data_json) |
| `rate_limits` | Per-client request counters (client_id, window_start, count) |
| `paired_devices` | Paired device tokens for channel auth |
