# Nexus — Agent Instructions

This file is the authoritative guide for AI coding agents working on the Nexus codebase.

---

## Project Overview

Nexus is a self-hosted AI gateway. It exposes a WebSocket RPC API that multiplexes multiple AI provider conversations, persists sessions and messages in a local SQLite database, and serves a SolidJS web UI. External clients (browser, CLI, Telegram, Discord) all connect through the same gateway.

---

## Repository Layout

```
nexus/
  packages/
    core/src/         — db, sessions, messages, config, agents, crypto, events, rate-limit, audit, logger
    agent/src/        — execution-loop, context-builder, tool-executor, tools/, providers/
    gateway/src/      — server.ts (Hono + WebSocket), handlers/, protocol/, middleware/
    cli/src/          — Commander.js CLI; commands: gateway, config, send, status, plugins
    plugins/src/      — plugin loader, marketplace registry client
    ui/src/           — SolidJS SPA; stores, components, gateway WebSocket client
  extensions/
    telegram/         — Telegram channel adapter
    discord/          — Discord channel adapter
  docs/               — architecture, API reference, configuration, channels, plugins, deployment
  .github/            — CI workflow, issue templates
```

---

## Build and Test Commands

```bash
npm install           # install all workspace dependencies
npm run build         # tsc --build (compile all packages)
npm test              # vitest run (run all unit tests)
npm run typecheck     # tsc --noEmit (type-check without emitting)
npm run lint          # eslint
npm run lint:fix      # eslint --fix

# Start the gateway locally
npx tsx packages/cli/src/index.ts gateway run

# Run the UI dev server (inside packages/ui)
cd packages/ui && npx vite
```

---

## Coding Conventions

### TypeScript

- `strict: true` is enabled. No `any`, no non-null assertions (`!`).
- Use `import type` for type-only imports (enforced by ESLint rule `consistent-type-imports`).
- Add explicit return types to all exported functions.
- Keep files under **200 lines**. Split larger files.
- Use named exports. No default exports except where a framework requires it.

### Zod Validation

Every value that crosses a trust boundary must be validated with Zod before use:

- WebSocket frames — `RequestFrame`, `ResponseFrame`, `ConnectParams` in `packages/gateway/src/protocol/frames.ts`
- RPC handler params — each handler file defines its own param schemas
- Config — `NexusConfigSchema` and sub-schemas in `packages/core/src/config.ts`
- CLI args — validated via Commander.js + Zod in command files

Pattern:
```typescript
const parsed = MySchema.safeParse(rawInput);
if (!parsed.success) {
  return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
}
const { field1, field2 } = parsed.data;
```

### SQLite / WAL

- The database is opened once per process via `getDb()` in `packages/core/src/db.ts`.
- WAL mode is enabled in migrations. Never disable it.
- All schema changes go through the migration system in `packages/core/src/migrations/`.
- Use parameterised `db.prepare(...).run(...)` calls. Never interpolate user input into SQL.
- The only allowed interpolation is for internal integer constants (e.g. `PRAGMA user_version`), guarded with `Math.trunc()`.

### Provider Abstraction

- All AI providers implement the `Provider` interface in `packages/agent/src/providers/base.ts`.
- Add new providers in `packages/agent/src/providers/<name>.ts` and register them in `packages/agent/src/providers/resolver.ts`.
- The execution loop in `packages/agent/src/execution-loop.ts` must never import a provider directly — it always goes through the resolver.

### Channel Adapter Interface

Channel adapters (Telegram, Discord) live in `extensions/`. They:

1. Connect to the Nexus gateway WebSocket at `ws://localhost:<port>/ws`.
2. Send `ConnectParams` as the first message.
3. On receiving `HelloOk`, store the `session.id`.
4. Forward incoming channel messages as `chat.send` RPC calls.
5. Broadcast agent responses back to the originating channel.

### Error Handling

- Never let `JSON.parse` or Zod `.parse()` throw unhandled. Always use `.safeParse()` or `try/catch`.
- `catch (err: unknown)` — narrow with `err instanceof Error` before accessing `.message`.
- Never silently swallow errors; log them with the `createLogger` factory and re-throw or return an error response.

### Logging

- Import `createLogger` from `@nexus/core`.
- Pass a namespaced string: `createLogger("gateway:sessions")`.
- Use structured log objects: `log.info({ sessionId, agentId }, "Session created")`.
- `console.*` is forbidden everywhere except CLI command files (enforced by ESLint).

### Events

- The in-process event bus is `events` from `packages/core/src/events.ts`.
- Events are typed via `NexusEvents`. Add new event types there if needed.
- The gateway forwards core events to all authenticated WebSocket clients via `broadcast()`.

---

## Key Files

| File | Purpose |
|---|---|
| `packages/core/src/db.ts` | SQLite connection, WAL setup, migration runner |
| `packages/core/src/config.ts` | Config schemas and get/set helpers |
| `packages/core/src/sessions.ts` | Session and message CRUD |
| `packages/core/src/events.ts` | Typed in-process event bus |
| `packages/agent/src/execution-loop.ts` | Agent turn loop (user message → tool calls → response) |
| `packages/agent/src/providers/base.ts` | Provider interface and shared types |
| `packages/agent/src/tool-executor.ts` | Tool registration and dispatch |
| `packages/gateway/src/server.ts` | Hono HTTP server + WebSocket RPC server |
| `packages/gateway/src/protocol/frames.ts` | Zod schemas for all WS message types |
| `packages/gateway/src/handlers/` | One file per RPC method group |
| `packages/cli/src/index.ts` | CLI entry point (Commander.js) |
| `packages/plugins/src/` | Plugin loader and marketplace client |

---

## Do Not

- Do not modify `packages/core/src/db.ts` schema outside of a migration file.
- Do not call provider APIs directly from gateway handlers — always go through `@nexus/agent`.
- Do not add `console.log` to non-CLI code.
- Do not use `as` casts to bypass the type system — use Zod or `typeof`/`instanceof` guards.
- Do not commit `.env` files or credentials.
- Do not modify files in `node_modules/` or compiled output directories (`dist/`).
