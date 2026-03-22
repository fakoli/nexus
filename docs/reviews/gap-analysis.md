# Nexus Production Readiness Gap Analysis

**Author:** Claude Code automated audit
**Date:** 2026-03-22
**Scope:** All source files in `packages/` and `extensions/`, compared against `analysis/13-rebuild-blueprint.md`
**Verdict:** Not production-ready. Core loop works; most surrounding infrastructure is absent or not wired together.

---

## How to read this table

- **Status:** Done = implemented and wired; Partial = code exists but has critical gaps; Missing = no implementation at all
- **Priority:** P0 = system cannot function without this; P1 = serious usability gap; P2 = planned feature not yet built

---

## Gap Table

| # | Feature | Status | Details | Priority |
|---|---------|--------|---------|----------|
| 1 | README / Getting Started | Missing | No `README.md` exists at the project root or in any package. `REVIEW.md` is an internal code-review log, not user documentation. `MARKETPLACE.md` covers only the plugin registry format. There is no "how to install", no "how to run", no prerequisite list, no quickstart, and no API reference anywhere in the repository. A new user has zero entry point. | P0 |
| 2 | `nexus onboard` / `nexus init` command | Missing | The blueprint's Phase 1 exit criterion is `nexus init` — an interactive onboarding that creates config, initializes the DB, stores an encrypted API key, and verifies connectivity. No such command exists. The CLI currently has: `gateway run`, `config get/set`, `send`, `status`, `plugins`. A user must read the source code to understand what env vars or config they need to supply before anything works. | P0 |
| 3 | `nexus doctor` command | Missing | The blueprint specifies a 6-check quick-mode `nexus doctor` that validates the environment (API key present, DB writable, gateway reachable, etc.). Not implemented. Users have no way to self-diagnose a broken setup. | P1 |
| 4 | Graceful shutdown / process supervision | Partial | `gateway run` registers `SIGINT`/`SIGTERM` handlers that call `server.close()` and `closeDb()`. This is correct for a clean exit. However: (a) there is no `Dockerfile`, no `systemd` unit file, and no `launchd` plist — the gateway will not survive a system restart or crash; (b) if the gateway panics (unhandled exception outside the WS message loop), the process exits with no restart policy; (c) `server.ts` emits `gateway:started` but there is no health-check endpoint besides `/healthz` (which does exist). Overall: single-process graceful shutdown is present; process supervision is entirely absent. | P1 |
| 5 | Configuration guide (end-to-end) | Missing | The only documented configuration path is `nexus config set <section> <json>`, which requires the user to know the JSON schema by heart. No documentation of available config keys, valid values, or their effect. The config schema lives in `packages/core/src/config.ts` — reading source code is the only option. The `security.gatewayToken` and `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` environment variables are also undocumented. | P0 |
| 6 | Agent execution loop — tool results fed back to LLM | Done | `packages/agent/src/execution-loop.ts` implements the full agentic loop correctly: calls `provider.complete()`, checks `stopReason === "tool_use"`, executes tools via `executeTool()`, appends tool results as `role: "tool"` messages, and loops up to `MAX_TOOL_ROUNDS = 20`. Tool calls and results are persisted to SQLite. The loop is wired into `runAgent()` and exposed via the `agent.run` RPC. **This works correctly.** | — |
| 7 | Streaming responses to UI | Missing | `provider.stream()` is implemented on both Anthropic and OpenAI providers and yields `StreamDelta` events. However, the execution loop exclusively uses `provider.complete()` (non-streaming). The `agent.run` RPC handler in `handlers/agent.ts` does not wire `onText` to push partial tokens over the WebSocket. The UI's `sendMessage` action calls `agent.run` and waits for the full response — the chat window shows nothing until the agent finishes. There is no streaming RPC path (no `agent.stream` method, no `EventFrame` pushes for partial tokens). | P1 |
| 8 | Session switching / persistence across restarts | Done | Sessions are persisted to SQLite. `listSessions`, `createSession`, `getSession`, `getOrCreateSession` are implemented and exposed via the `sessions.list` and `sessions.create` RPC handlers. The UI's `SessionList` component loads sessions and allows selection. Sessions survive gateway restarts because they are database-backed. **This works correctly.** | — |
| 9 | Plugin loader wired into gateway startup | Missing | `packages/plugins/src/loader.ts` implements `loadPlugin(id)` correctly (path-traversal guards, lifecycle hooks, dynamic import). However, `startGateway()` in `server.ts` never calls the loader. Installed plugins stored in the `installed_plugins` SQLite table (or `plugins.installed` config key) are never loaded at startup. Plugins that are "installed" via `nexus plugins install` have their metadata recorded but their code is never executed. The loader is dead code from the gateway's perspective. | P0 |
| 10 | Plugin install — actual tarball download and extraction | Partial | The `@nexus/plugins` package (`packages/plugins/src/installer.ts`) implements the full download-extract-npm-install pipeline. However, the CLI `plugins install` command in `packages/cli/src/commands/plugins.ts` **only records the manifest in config** — it never calls `installPlugin()` from `@nexus/plugins`. The comment says "actual tarball extraction delegated to @nexus/plugins runtime" but no such delegation occurs. Installed plugins have no code on disk. | P0 |
| 11 | Plugin SDK available for plugin authors | Partial | `packages/plugins/src/sdk.ts` defines `definePlugin`, `defineChannelPlugin`, `defineProviderPlugin`, and type guards. It is a clean 3-export surface. However: (a) there is no published npm package — `private: true` in all `package.json` files; (b) no documentation for plugin authors; (c) the contract testing utilities (`createChannelTestSuite`) from the blueprint are absent — only the SDK factories exist. The SDK exists but cannot be consumed externally. | P1 |
| 12 | Telegram adapter wired into the gateway | Partial | `extensions/telegram/src/` implements a working `TelegramAdapter` that long-polls the Telegram API, normalizes messages, and has `sendReply`/`sendMedia`. The `@nexus/channels` router (`router.ts`) and registry (`registry.ts`) exist and are correctly designed. **However:** (a) `TelegramAdapter` does not implement the `ChannelAdapter` interface from `@nexus/channels` — its `start(handler: MessageHandler)` takes a raw function, not `ChannelContext` (documented as W-8 in channels-review.md); (b) there is no code anywhere that registers a Telegram adapter with the channel registry; (c) `startGateway()` never calls `registerAdapter()` or `startAdapter()`. Receiving a Telegram message and getting an AI response requires writing glue code not present in the repository. | P0 |
| 13 | Discord adapter wired into the gateway | Partial | `extensions/discord/src/` implements a `DiscordAdapter` that correctly implements the `ChannelAdapter` interface (fixed in channels-review.md). However, identical to Telegram: `startGateway()` never registers or starts the Discord adapter. No entry point wires channels into the gateway. | P0 |
| 14 | Web UI connects to gateway and is functional | Done (with caveats) | The UI (`packages/ui/src/`) is a complete SolidJS app with chat, session list, config editor, and login prompt. `gateway/client.ts` implements WebSocket connect with exponential backoff, ConnectParams handshake, RPC request/response, and event subscription. `sendMessage` calls `agent.run` correctly. The gateway serves the built UI at `/ui/` from `packages/ui/dist/`. **Caveats:** (a) The UI dist is pre-built (present at `packages/ui/dist/`) so it works today, but there is no `npm run build` integration documented or automated; (b) `StatusBar` is rendered twice in the chat tab (bug from plugins-ui-review.md W); (c) `ConfigEditor` uses direct SolidJS store mutations instead of `setStore`; (d) no loading states for history/session fetch failures. Overall functional for basic chat but with known UI bugs. | — |
| 15 | UI served by gateway (not separate dev server) | Done | `server.ts` serves static files from `packages/ui/dist` at `/ui/*` with SPA fallback. The root `/` redirects to `/ui/`. Path traversal is guarded. A clear error is shown if the dist is missing. This is correctly implemented. | — |
| 16 | Auth enforced on all gateway endpoints | Partial | WebSocket auth is enforced: every RPC call requires a prior successful `ConnectParams` handshake (the `client.authed` flag). Rate limiting is applied to auth attempts. **However:** (a) HTTP endpoints (`/healthz`, `/api/status`, `/ui/*`) have no auth at all — `status` reveals server info; (b) `deviceToken` auth is a documented stub: any non-empty device token is accepted when no `token`/`password` is configured — it provides zero real authentication; (c) any authenticated client can call `config.set { section: "security" }` and replace the gateway token mid-session (W-6 in gateway-cli-review.md). Token/password auth on the WS path is sound; the HTTP surface and device auth are not. | P1 |
| 17 | Deployment: Dockerfile | Missing | No `Dockerfile`, no `docker-compose.yml`, no `.dockerignore`. Cannot be containerized without writing these from scratch. | P1 |
| 18 | Deployment: systemd / launchd unit | Missing | No `nexus.service` systemd unit, no macOS launchd plist, no `Procfile`. The gateway process is not daemonized in any standard way. If the machine reboots, Nexus does not restart. | P1 |
| 19 | Deployment: npm publish config | Missing | All packages have `"private": true`. There is no `publishConfig`, no `files` field, no `prepublish` script. Cannot be installed via `npm install -g nexus`. The only way to run the CLI is from the monorepo source tree using Bun. | P1 |
| 20 | CI pipeline | Missing | No `.github/workflows/`, no `.circleci/`, no `Makefile` with a `ci` target. The blueprint specifies a Linux + macOS CI pipeline with scope detection. Not implemented. | P2 |
| 21 | Tools: only bash and filesystem implemented | Partial | The blueprint's Phase 3 lists 9 core tools to port: `web_fetch`, `web_search`, `memory`, `cron`, `browser`, `message`, `sessions_send`, `image`, `canvas`. Phase 6 targets 82 tools total. Only 2 tools exist: `bash` and `filesystem` (read/write/list). No web search, no memory tool, no browser tool. The agent cannot fetch URLs, search the web, or store memories via tools. | P1 |
| 22 | Skills system (3-tier hierarchy) | Missing | The blueprint's Phase 3 requires a skills loading system (bundled > managed > workspace, frontmatter parser, env var injection). No `skills` module exists anywhere in the repository. The `cron_jobs` table exists in the DB schema but there is no scheduler. `memory_notes` table exists but has no query layer. These are schema stubs only. | P1 |
| 23 | Memory / vector search module | Missing | The blueprint's Phase 3 requires a `memory` module backed by `sqlite-vec`. The `memory_notes` table is created in the migration but has no implementation beyond the schema. `sqlite-vec` is not in any `package.json`. No embedding pipeline exists. The agent has no long-term memory capability. | P1 |
| 24 | Cron / scheduled agent runs | Missing | The `cron_jobs` and (blueprint) `cron_run_log` tables exist in schema but there is no scheduler implementation, no CLI commands for managing cron jobs, and no runtime loop that fires them. The table is dead. | P2 |
| 25 | Additional LLM providers (Google, OpenRouter, Ollama) | Missing | Blueprint Phase 6 specifies Google, OpenRouter, and Ollama providers. Only Anthropic and OpenAI are implemented. The provider resolver knows only two names. | P2 |
| 26 | Context compaction / history limiting | Missing | The blueprint's Phase 2 requires a separate `history-manager.ts` for compaction when the token budget is exceeded. `context-builder.ts` loads up to `maxHistoryMessages = 100` with no token counting. For long sessions, the context window will overflow and the provider call will fail with a token-limit error. No compaction logic exists. | P1 |
| 27 | Prompt guard enforcement | Partial | `SecurityConfigSchema` has a `promptGuard` field (`"enforce" | "warn" | "off"`). The config is read by `getAllConfig()`. However, no code in the agent pipeline reads `config.security.promptGuard` or applies any prompt injection detection before sending to the LLM. The field is stored and retrievable but has no effect. | P1 |
| 28 | OS keychain integration for master key | Missing | The blueprint specifies the master key be stored in the OS keychain (macOS Keychain, Linux secret-tool). `crypto.ts` uses three strategies: passphrase-based PBKDF2, a hex key file at `NEXUS_MASTER_KEY` env path, or an ephemeral random key (with a warning). No OS keychain integration exists. On every restart without `NEXUS_MASTER_KEY`, a new random key is generated and all previously encrypted credentials become unreadable. | P0 |
| 29 | `nexus secrets` / credential management CLI | Missing | There is no `nexus secrets set <provider> <key>`, no `nexus secrets rotate`, no `nexus secrets list`. The only way to store an API key is to set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as environment variables, or call `storeCredential()` directly. The encrypted credential store exists but has no CLI surface. | P1 |
| 30 | Sandbox for bash tool (Docker/SSH) | Missing | Blueprint Phase 3 requires a Docker or SSH sandbox backend for code execution. `bash.ts` runs commands directly in the gateway process with only a regex blocklist. The blocklist is insufficient for adversarial inputs (eval, base64, aliases). No containment boundary exists. | P1 |
| 31 | Filesystem tool path allowlist | Missing | `tools/filesystem.ts` `write_file` accepts any absolute path and creates directories recursively. An agent could write to `/etc/cron.d/` or `~/.ssh/authorized_keys`. The `agent.workspace` config field exists but no tool checks it. | P1 |
| 32 | `gateway.bind` setting actually used | Partial | The config has `bind: "loopback" | "lan" | "all"` but `startGateway()` calls `httpServer.listen(port)` without a bind address — it always binds to all interfaces (`0.0.0.0`). The CLI `send` and `status` commands also connect to `0.0.0.0` when `bind !== "loopback"`, which is not a valid client address (W-3 in gateway-cli-review.md). | P1 |
| 33 | `gateway.verbose` wired to logger level | Missing | `GatewayConfigSchema` has `verbose: boolean`. The gateway `run` CLI command reads `opts.verbose`. But `logger.ts` has a hardcoded `"info"` level — there is no code that sets the log level to `"debug"` when `verbose: true`. The flag has no effect. | P2 |
| 34 | `config.get` credential redaction | Done | `handlers/config.ts` correctly redacts `gatewayToken` and `gatewayPassword` with `"[REDACTED]"` before transmitting the config to clients (fixed in gateway-cli-review.md C-3). | — |
| 35 | `nexus send` CLI command works | Done | The `send` command correctly performs the ConnectParams handshake, waits for HelloOk, then sends the `chat.send` RPC. Fixed in gateway-cli-review.md C-5. Note: `send` stores messages but does not call `agent.run` — it stores a user message but does not trigger an AI response. | — |
| 36 | Web UI tool call visualization / tool cards | Missing | The blueprint Phase 5 specifies "message rendering, tool cards." The `MessageBubble` renders markdown text only. Tool use messages (`role: "tool_use"`, `role: "tool_result"`) are stored in the DB but the UI has no special rendering for them — they appear as raw JSON text. | P2 |
| 37 | Mobile-responsive UI | Missing | Blueprint Phase 5 exit criterion: "Mobile-responsive." The UI uses hardcoded pixel values and inline styles throughout. No responsive CSS, no media queries. The UI is desktop-only. | P2 |
| 38 | TOML config file support | Missing | The blueprint specifies `~/.nexus/config.toml` as the primary user-facing config format. The implementation stores config exclusively in SQLite, with no TOML file reading or writing. The blueprint explicitly says "TOML file takes precedence on startup." | P2 |
| 39 | `@nexus/channels` adapter registration at gateway startup | Missing | Even if a user writes their own `TelegramChannelAdapter` wrapper (as W-8 in channels-review.md recommends), there is no hook in `startGateway()` to call `registerAdapter()` or `startAdapter()`. The channels package is entirely decoupled from the gateway. A developer must fork `server.ts` to add channels. | P0 |
| 40 | Duplicate marketplace.ts / dead code | Partial | `packages/cli/src/commands/marketplace.ts` (211 LOC) is a near-duplicate of the registry fetch logic in `plugins.ts` and is never imported by any other file. It is dead code. (W-1 in gateway-cli-review.md.) Not a blocking issue, but bloat. | P2 |

---

## Dimension Summary

| Dimension | Score | Verdict |
|-----------|-------|---------|
| README / Documentation | 0/10 | No README exists anywhere. Zero documentation for users or contributors. |
| Error recovery / graceful shutdown | 4/10 | Single-process graceful shutdown is implemented. No process supervision, no restart policy, no Dockerfile. |
| Configuration (user-facing) | 2/10 | Config schema exists in code. No onboarding wizard, no documented keys, no TOML support, ephemeral master key on restart. |
| Agent runtime (tool loop) | 7/10 | Execution loop correctly feeds tool results to LLM. Only 2 tools exist. No streaming to UI. No compaction. Prompt guard is a no-op. |
| Session management | 7/10 | SQLite-backed, survives restarts, switchable via UI and API. Minor: session lock on concurrent agent runs is not implemented. |
| Plugin system | 2/10 | Loader and installer exist but are not wired into gateway startup. CLI install only records metadata, never downloads code. |
| Channel integration (Telegram/Discord) | 2/10 | Adapters exist; neither is registered or started by the gateway. TelegramAdapter does not implement the ChannelAdapter interface. |
| Web UI | 6/10 | Functional for basic chat. Served by the gateway. Known bugs: double StatusBar, direct store mutations, no streaming, no tool cards. |
| Security | 4/10 | Token/password WS auth works. Device token auth is a stub. HTTP endpoints unauthed. Prompt guard is a no-op. Master key is ephemeral on restart. Bash sandbox is regex-only. |
| Deployment | 0/10 | No Dockerfile, no systemd unit, no npm publish config, no CI. Cannot be deployed or installed by anyone outside the dev machine. |
| Blueprint coverage (Phases 1-6) | ~35% | Phase 1 (Foundation): ~70% done. Phase 2 (Agent Core): ~65% done. Phase 3 (Tools & Skills): ~15% done. Phase 4 (Channels & Plugins): ~20% done. Phase 5 (Web UI): ~60% done. Phase 6 (Platform & Polish): ~5% done. |

---

## P0 Blockers (System Cannot Function Without These)

These issues prevent Nexus from being usable as a personal AI assistant even in a developer context:

1. **No README / no onboarding path** (#1, #5) — A user cannot start without reading source code.
2. **Master key is ephemeral** (#28) — Every gateway restart generates a new random master key. Any API keys stored via `storeCredential()` become unreadable after restart. In practice this means the encrypted credential store is non-functional unless `NEXUS_MASTER_KEY` is set manually.
3. **Plugin loader not called at startup** (#9) — Installed plugins are never loaded.
4. **Plugin CLI install does not download code** (#10) — `nexus plugins install` records a manifest entry only. No code is ever placed on disk.
5. **Channel adapters not wired into gateway** (#12, #13, #39) — Telegram and Discord adapters exist but are never started. No messages from external channels can reach the agent.

---

## What Actually Works Today

If a developer sets `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in their environment and runs `bun run packages/cli/src/index.ts gateway run`:

- The gateway starts, runs SQLite migrations, and listens on port 18789.
- A WebSocket client can connect, perform the ConnectParams handshake, and receive HelloOk.
- `agent.run` calls the LLM (Anthropic or OpenAI), executes bash and filesystem tools if requested, and returns the full response.
- The web UI (at `/ui/`) loads, connects over WebSocket, and can send messages and receive AI responses.
- Sessions are persisted across gateway restarts.
- The plugin CLI commands list, search, and record installations (but no code is downloaded or run).
- `nexus config get/set` reads and writes config to SQLite.
- `nexus status` reports gateway reachability.

In short: the core chat loop via the web UI works if the user manually supplies an API key. Everything else requires significant additional work.
