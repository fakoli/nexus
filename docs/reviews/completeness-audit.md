# Nexus Completeness Audit

Audited: 2026-03-22
Scope: All source files across all packages and extensions.

---

## Summary

| Category | Count |
|---|---|
| Stub / placeholder code | 4 |
| TODO / FIXME markers | 1 |
| Dead code (exported, never consumed) | 3 |
| Broken / mis-wired logic | 5 |
| Unwired features | 5 |
| Missing UI states | 2 |
| Hardcoded values / magic strings | 4 |
| Missing / duplicate type definitions | 2 |

---

## Findings

---

### `packages/gateway/src/middleware/auth.ts`

- **Issue**: Device-token authentication is a stub. The comment on line 81 reads *"placeholder, validates presence only"*. It accepts any non-empty `deviceToken` string when no `token`/`password` is configured; it never queries the `paired_devices` table or verifies any hash.
- **Impact**: Paired-device auth provides no actual security. Any client can supply a random string as `deviceToken` and get through when the server has no token/password set (the default local configuration). The entire pairing flow (`paired_devices` table, `PairedDevice` type, `ensurePairingTable()`) is therefore orphaned.
- **Fix**: Implement the `paired_devices` lookup: hash the incoming `deviceToken`, query `SELECT token_hash FROM paired_devices WHERE id = ?`, and compare with `timingSafeEqual`. Update `last_seen_at` on success.

---

### `packages/ui/src/stores/actions.ts` — `saveConfig`

- **Issue**: The `config.set` RPC call passes the config data under the key `"data"` (line 103: `{ section, data }`), but the gateway handler's `ConfigSetParams` Zod schema (in `packages/gateway/src/handlers/config.ts`, line 36–39) expects the key `"value"`.
- **Impact**: `config.set` always fails with `INVALID_PARAMS` because the Zod parse finds `value` missing. The Config Editor's Save button is permanently broken at runtime.
- **Fix**: Change line 103 of `actions.ts` from `{ section, data }` to `{ section, value: data }`.

---

### `packages/ui/src/stores/app.ts` — `config:changed` event handler

- **Issue**: The server broadcasts `config:changed` as `{ key: string, value: unknown }` (a single flat key, e.g. `"gateway"`, with its whole section value). The UI handler on lines 80–85 attempts to destructure `payload` as `{ gateway?, agent?, security? }` — a multi-section shape that never arrives. The conditions `if (p.gateway)`, `if (p.agent)`, `if (p.security)` will never be true.
- **Impact**: Live config updates pushed by the server are silently dropped. The Config Editor never reflects server-side changes from other clients or CLI updates without a manual reload.
- **Fix**: Change the handler to `const { key, value } = payload; if (key === "gateway") setStore("config", "gateway", value); /* etc. */`.

---

### `packages/ui/src/components/sessions/SessionList.tsx` — "New Session" button

- **Issue**: The "+ New Session" button (line 30) only clears local store state (`session.id = ""`, `messages = []`) and navigates to the chat tab. It never calls `sessions.create` on the gateway to create a persisted server-side session.
- **Impact**: After clicking "+ New Session", `store.session.id` is empty. The first `agent.run` request will send `sessionId: ""`, which the gateway will reject with `SESSION_NOT_FOUND`. The user effectively cannot start a new conversation from the UI.
- **Fix**: Add `sessions.create` to `RequestMethod` in `gateway/types.ts`, add a `createSession` action in `stores/actions.ts` that calls `gateway.request("sessions.create", { agentId: "default" })` and stores the returned session id, and wire it to the button.

---

### `packages/ui/src/App.tsx` — Logs tab

- **Issue**: The "Logs" tab renders a hardcoded `<div>Logs view — coming soon.</div>` placeholder (lines 12–17). The `TabBar` component exposes the tab as a first-class navigation item.
- **Impact**: Navigating to Logs shows a placeholder with no functionality. Not a crash, but a visibly incomplete feature that ships in the current state.
- **Fix**: Either implement a real log viewer (subscribe to gateway events, display them), or remove the "logs" entry from `TABS` in `TabBar.tsx` until the view is ready.

---

### `packages/ui/src/components/shared/Toast.tsx` — component never mounted

- **Issue**: The `Toast` component default-exports a `<Toast />` component that renders the toast list and manages cleanup. `ConfigEditor` imports and calls `showToast()` (which works because `showToast` uses a module-level signal), but the `<Toast />` component itself is never mounted anywhere in `App.tsx` or `index.tsx`.
- **Impact**: Toast notifications are never rendered in the DOM. The Config Editor calls `showToast(...)` on save success/failure but nothing is ever displayed to the user.
- **Fix**: Import `Toast` in `App.tsx` and render `<Toast />` once at the root level, e.g. at the bottom of the `<div id="app">` tree.

---

### `packages/cli/src/commands/marketplace.ts` — dead file (never imported by CLI)

- **Issue**: `packages/cli/src/commands/marketplace.ts` exports `listRegistries`, `saveRegistries`, `addRegistry`, `removeRegistry`, `validateRegistry`, `searchRegistries`, `lookupPlugin`, and `DEFAULT_REGISTRY_URL`. None of these are imported by `packages/cli/src/commands/plugins.ts` or `packages/cli/src/index.ts`. The `plugins.ts` command re-implements the same logic inline (its own `fetchRegistryIndex`, `getRegistries`, `saveRegistries`, etc.).
- **Impact**: `marketplace.ts` is dead code at the CLI layer. Its functions are tested (`plugins-commands.test.ts` imports them directly) but are never called at runtime. The two parallel implementations will diverge. The CLI `plugins` command duplicates registry fetch/search/validation logic already present in `marketplace.ts`.
- **Fix**: Refactor `plugins.ts` to import from `marketplace.ts` (or remove `marketplace.ts` and keep the inline implementation). One authoritative implementation should remain.

---

### `packages/plugins/src/marketplace.ts` and `packages/cli/src/commands/marketplace.ts` — duplicate `DEFAULT_REGISTRY_URL` pointing to non-existent repo

- **Issue**: Both files define `DEFAULT_REGISTRY_URL = "https://github.com/fakoli/fakoli-plugins"`. This GitHub repository does not exist (it is a placeholder invented during development). The same URL appears in `packages/plugins/src/marketplace.ts` line 16, `packages/cli/src/commands/plugins.ts` line 6, and `packages/cli/src/commands/marketplace.ts` line 16.
- **Impact**: Any invocation of `nexus plugins search`, `nexus plugins install`, or `fetchRegistry(DEFAULT_REGISTRY_URL)` will receive an HTTP 404 (or network failure) from GitHub, and the operation will fail. No plugins can be discovered or installed without explicitly adding a working registry URL.
- **Fix**: Either point to a real registry URL, or change the default to `""` (empty) so the system gracefully informs the user that no registry is configured rather than attempting a network call to a dead URL.

---

### `packages/plugins/src/loader.ts` — plugin tools and hooks never wired into the agent

- **Issue**: `loadPlugin()` validates and calls `onLoad(ctx)`, but after loading it does nothing with `plugin.tools` or `plugin.hooks`. The `PluginConfig` interface defines `tools?: ToolDefinition[]` and `hooks?: HookDefinition[]`, but `loadPlugin` never calls `registerTool()` from `@nexus/agent` for each tool, and never subscribes hooks to the event bus.
- **Impact**: Installing and loading a tool plugin is silently a no-op. The agent never receives the plugin's tools in its `getToolDefinitions()` list. The plugin's declared tools cannot be invoked during agent runs. Channel plugins (type `"channel-plugin"`) are loaded but never passed to `registerAdapter()` in `@nexus/channels`.
- **Fix**: After a successful `onLoad`, iterate `plugin.tools` and call `registerTool(...)` for each. For `ChannelPlugin` instances, call `registerAdapter()` and `startAdapter()` from `@nexus/channels`. For `ProviderPlugin` instances, register the provider in the resolver. For hooks, subscribe each `HookDefinition` to the core `events` bus. Mirror this in `unloadPlugin`.

---

### `packages/gateway/src/server.ts` — `@nexus/channels` never started

- **Issue**: The gateway server imports nothing from `@nexus/channels`. No channel adapter is ever registered or started when the gateway boots. The entire channels package (`@nexus/channels`, `extensions/discord`, `extensions/telegram`) exists but has no entry point that starts it alongside the gateway.
- **Impact**: Discord and Telegram extensions can never receive or route inbound messages unless the operator writes custom startup code. There is no CLI command to enable/configure channels. `routeInbound` is never called in production.
- **Fix**: Add channel startup logic to the gateway server or CLI. At minimum, the `gateway run` command should load any configured channel adapters from the database (e.g. channels stored in `config`) and start them. Alternatively, document that channel adapters must be registered externally via the plugin system once that is wired (see the loader issue above).

---

### `extensions/discord/src/adapter.ts` — capabilities declare `media: false` but `DiscordRestClient` has no media send method

- **Issue**: `DiscordAdapter.capabilities.media = false` and `DiscordAdapter.capabilities.reactions = false`. This is consistent with what is implemented. However, `DiscordRestClient` exposes `editMessage` and `deleteMessage`, which the `ChannelAdapter` interface lists as optional methods (`editMessage?`, `deleteMessage?`). `DiscordAdapter` does not expose or delegate these methods — they are only accessible directly on `rest`.
- **Impact**: Gateway code that checks `adapter.editMessage` or `adapter.deleteMessage` (if ever added) will find them `undefined` even though the underlying REST client supports them.
- **Fix**: Optionally expose `editMessage` and `deleteMessage` on `DiscordAdapter` by delegating to `this.rest`, or document explicitly that they are intentionally not exposed.

---

### `packages/agent/src/providers/openai.ts` — `log` used but never defined

- **Issue**: Line 118 calls `log.warn(...)` (`log.warn({ toolName: tc.function.name }, "Could not parse tool arguments JSON")`), but there is no `const log = createLogger(...)` anywhere in the file. The `createLogger` import is also absent.
- **Impact**: This line throws `ReferenceError: log is not defined` at runtime whenever the OpenAI provider receives a malformed tool-call JSON string. The error happens inside a catch block, which means the original parse failure is replaced by a crash.
- **Fix**: Add `import { createLogger } from "@nexus/core";` and `const log = createLogger("agent:providers:openai");` at the top of the file.

---

### `packages/ui/src/gateway/types.ts` — `RequestMethod` missing `sessions.create`

- **Issue**: `RequestMethod` (line 12–18) lists `"chat.send"`, `"chat.history"`, `"agent.run"`, `"sessions.list"`, `"config.get"`, `"config.set"`. The gateway server also registers `"sessions.create"` (server.ts line 79). The UI type does not include it, so TypeScript will reject any call to `gateway.request("sessions.create", ...)`.
- **Impact**: The sessions.create RPC method cannot be type-safely called from the UI. This also blocks the fix for the "New Session" issue above.
- **Fix**: Add `"sessions.create"` to the `RequestMethod` union type.

---

### `packages/core/src/config.ts` — `setConfigSection` is a thin alias that adds no value

- **Issue**: `setConfigSection(section, value)` (line 75–77) simply calls `setConfig(section, value)` with no added logic, validation, or documentation differentiating it from `setConfig`.
- **Impact**: Minor dead-weight, but consumers who use `setConfigSection` get no schema validation. The gateway's `handleConfigSet` validates with Zod before calling `setConfigSection`, but the CLI's `config set` command does the same — so validation is scattered at call sites rather than enforced centrally.
- **Fix**: Either delete `setConfigSection` and have callers call `setConfig` directly, or have it accept a typed section name and apply the relevant Zod schema internally.

---

### `packages/ui/src/components/config/ConfigEditor.tsx` — direct mutation of Solid store

- **Issue**: Lines 61, 63, 69, 77, 82, 84, 92, 94, 98 directly assign to `store.config.gateway.port = ...`, `store.config.agent.defaultProvider = ...`, etc. Solid's `createStore` does not permit direct mutation outside of `setStore` — these assignments bypass the reactive system.
- **Impact**: Changes typed in the Config Editor inputs do not update the store's reactive graph. The `doSave` handler then reads back `{ ...store.config[s] }` which may contain stale values. Config saves either submit empty/default values or the most recently committed store state, not whatever the user typed.
- **Fix**: Use `setStore("config", section, "field", value)` in each `onInput`/`onChange` handler instead of direct assignment.

---

### `packages/cli/src/commands/plugins.ts` — install command records metadata only, never downloads files

- **Issue**: The `plugins install` command (lines 253–319) finds the plugin in the registry, builds a `PluginManifest`, pushes it to the `plugins.installed` JSON array in the core config, and exits. A comment on line 295 reads *"actual tarball extraction delegated to @nexus/plugins runtime"* — but `@nexus/plugins` is never imported or called. The tarball download and extraction from `packages/plugins/src/installer.ts` is never invoked.
- **Impact**: `nexus plugins install <id>` only writes a metadata record; no code is downloaded, no `node_modules` are installed, and `loadPlugin()` will immediately fail with "main entry not found" because the plugin directory does not exist on disk.
- **Fix**: Import `installPlugin` from `@nexus/plugins` (or replicate the download/extract logic) and call it during `plugins install`. The install command should also record the install in the `installed_plugins` SQLite table (via `recordInstall`) rather than in the config JSON, since the `@nexus/plugins` loader queries the database.

---

### `packages/cli/src/commands/plugins.ts` — install/uninstall uses config JSON, loader uses SQLite

- **Issue**: The CLI `plugins install/uninstall/update` commands persist installed plugin records in `config["plugins.installed"]` (a JSON array). The `@nexus/plugins` loader (`loader.ts`, `registry.ts`) queries the `installed_plugins` SQLite table. These are two completely separate storage backends for the same concern.
- **Impact**: Plugins "installed" via the CLI will not be found by `isInstalled()` or `loadPlugin()` (which check the SQLite DB). Plugins installed via the `@nexus/plugins` installer will not appear in `nexus plugins list` (which reads the config JSON). The two subsystems are invisible to each other.
- **Fix**: Standardise on SQLite (`installed_plugins` table) as the single source of truth. Update the CLI commands to call `recordInstall` / `uninstallPlugin` from `@nexus/plugins/registry`.

---

### `packages/ui/src/gateway/client.ts` — hardcoded fallback URL in module constant

- **Issue**: `const GATEWAY_URL = "ws://localhost:18789/ws"` (line 12) is a module-level constant that becomes the default for `createGatewayClient`. It is also hardcoded in `stores/app.ts` line 57 and `LoginPrompt.tsx` line 5. Three separate locations define the same magic string.
- **Impact**: If the default port changes in `core/config.ts` (`GatewayConfigSchema.port.default(18789)`), all three UI locations must be updated manually. Minor maintenance risk and no runtime impact as long as port stays 18789.
- **Fix**: Derive the UI default from a single constant, ideally injected as a Vite env variable (`import.meta.env.VITE_GATEWAY_URL`) with the hardcoded value as the fallback in one place only.

---

## Non-Issues Verified

The following were checked and are correctly implemented:

- All core CRUD operations (`agents`, `sessions`, `messages`, `audit_log`, `config`, `credentials`, `rate_limits`) are fully implemented with no stubs.
- The agent runtime, execution loop, context builder, and provider resolver are complete.
- Discord and Telegram extensions are fully implemented (Gateway WS, REST client, long-polling, heartbeat, resume). They cannot be started from the gateway, but the code itself is complete.
- The channels package (router, allowlist, pairing, reply dispatch) is fully implemented.
- The gateway WebSocket protocol, auth middleware, and all RPC handlers (`chat.send`, `chat.history`, `sessions.list`, `sessions.create`, `config.get`, `config.set`, `agent.run`) are complete and wired.
- The plugins marketplace fetch and installer (tarball download, extraction, dependency install) are complete; the disconnect is in the CLI command not calling them.
- All Zod schemas are defined and exported properly.
- The `@nexus/plugins` SDK (`definePlugin`, `defineChannelPlugin`, `defineProviderPlugin`, type guards) is complete.
- Markdown renderer in the UI handles XSS correctly.
- The UI login flow, connection management, and WebSocket reconnect/backoff are complete.
