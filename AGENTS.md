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
    cli/src/          — Commander.js CLI; commands: quickstart, chat, gateway, config, send, status, plugins
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

# One-command quickstart (setup + gateway + TUI chat)
npx tsx packages/cli/src/index.ts quickstart

# Interactive TUI chat (requires gateway already running)
npx tsx packages/cli/src/index.ts chat

# Start the gateway locally (port 19200)
npx tsx packages/cli/src/index.ts gateway run

# Convenience shell script (starts gateway, prints UI URL)
bash scripts/start.sh

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

## Parallel Agent Team Workflow

Nexus is developed using multi-agent teams — multiple Claude Code agents (Sonnet 4.6) running in parallel, each responsible for a specific feature area.

### Deployment Rules

1. **Max 5 concurrent agents** — 8 caused OOM. Stay at 5 or fewer.
2. **Use Sonnet 4.6** for all coding and testing agents.
3. **Wave-based execution** — coding agents run first, QA agents run after they complete.
4. **Verify after each wave** — always run `npm test`, `npm run typecheck`, `cd packages/ui && npx vite build` before committing.
5. **Clean stale artifacts** — run `find . -path "*/src/*.js" -not -path "*/node_modules/*" -delete` before tests (vitest picks up compiled files over source).

### File Ownership (Conflict Avoidance)

Each agent owns specific directories. No two agents should create files in the same directory.

| Owner | Directories |
|-------|-----------|
| Security agent | `packages/core/src/security/` |
| Backend agent 1 | `packages/core/src/bootstrap.ts`, `packages/agent/src/providers/`, `packages/gateway/src/handlers/agents.ts` |
| Backend agent 2 | `packages/core/src/cron*.ts`, `packages/core/src/usage.ts`, `packages/gateway/src/handlers/cron.ts`, `packages/gateway/src/handlers/usage.ts` |
| UX agent | `packages/ui/src/design/`, `packages/ui/src/components/layout/`, all new UI views |
| QA agents | `**/__tests__/` only |

### Shared File Protocol

These files are touched by multiple agents and need ordering:

| File | Rule |
|------|------|
| `packages/core/src/index.ts` | Append-only — each agent adds their exports at the end |
| `packages/core/src/config.ts` | Security agent goes first, then backend agents |
| `packages/core/src/db.ts` | Only one agent writes each migration version |
| `packages/gateway/src/server.ts` | Each agent adds handler imports + dispatch entries in their own section |
| `packages/ui/src/App.tsx` | UX agent is sole modifier |
| `packages/ui/src/stores/app.ts` | UX agent defines store shape; backend agents add actions only |
| `packages/ui/src/gateway/types.ts` | UX agent is sole modifier |

### Sprint Cadence

Each sprint adds ~100-150 tests and ~30-50 source files:

| Sprint | Focus | Tests Added |
|--------|-------|-------------|
| Sprint 1 | Security core, config expansion, agent bootstrap, cron, analytics, design system | +147 (703 total) |
| Sprint 2 | Slash commands, agent UI, tool cards, session tuning, focus mode | +101 (804 total) |
| Sprint 3 | More providers, cron UI, analytics dashboard, debug tools, plugin manager | +174 (978 total) |
| Sprint 4 | Production hardening: gateway.bind, prompt guard wiring, web_fetch tool, memory module, E2E tests | Planned |

### Agent Prompt Template

When deploying an agent, use this structure:
```
You are Agent [ROLE] on the Nexus project at `/path/to/nexus/`.

YOUR JOB: [one-line description]

Read first: [list of files to read for context]

Create these files: [list with descriptions]
Modify these files: [list with what to change]
Write tests: [list of test files]

Keep files under [N] LOC. Use [patterns from existing code].
Don't touch files owned by other agents: [list].
```

---

## Do Not

- Do not modify `packages/core/src/db.ts` schema outside of a migration file.
- Do not call provider APIs directly from gateway handlers — always go through `@nexus/agent`.
- Do not add `console.log` to non-CLI code.
- Do not use `as` casts to bypass the type system — use Zod or `typeof`/`instanceof` guards.
- Do not commit `.env` files or credentials.
- Do not modify files in `node_modules/` or compiled output directories (`dist/`).
