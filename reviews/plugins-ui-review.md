# Code Review: packages/plugins/src & packages/ui/src

**Reviewer:** Claude Code (automated review)
**Date:** 2026-03-22
**Scope:** All source files under `packages/plugins/src/` and `packages/ui/src/` excluding `__tests__` directories.
**Verdict:** REQUEST_CHANGES (critical issues fixed inline; warnings remain)

---

## Summary per File

### packages/plugins/src/types.ts
Clean. Zod schemas are well-defined and derive TypeScript types correctly. `PluginManifest.id` is constrained to `/^[a-z0-9-]+$/` which prevents path traversal via plugin IDs. `MarketplaceEntrySchema.path` has no pattern constraint (warning — see below). All types exported correctly.

### packages/plugins/src/sdk.ts
Clean. API is minimal and readable. Factory functions (`definePlugin`, `defineChannelPlugin`, `defineProviderPlugin`) and type guards are correct. `_type` discriminant pattern is sound. No `any` usage; casts are narrow and justified. 138 LOC — within limit.

### packages/plugins/src/marketplace.ts
Mostly clean. `fetchRegistry` validates responses with Zod before returning. `searchPlugins` uses `Promise.allSettled` and gracefully skips failed registries. Error messages are informative. `githubRawBase` / `githubTarballUrl` have proper regex guards.

**Warning:** `pluginPath` in `getPluginDetails` is used directly in a URL without path normalization. A registry with a crafted `path` value like `../../other-repo-file` would allow fetching arbitrary file paths within the GitHub raw domain — low severity since the registry itself is trusted, but worth restricting with a path validation check.

### packages/plugins/src/installer.ts — CRITICAL (fixed)
**[FIXED] Path traversal in `extractPlugin`:** `inRepoPath` (sourced from `MarketplaceEntry.path`, a remote registry value) was passed directly to `path.join(rootDir, inRepoPath)`. A registry with a crafted entry like `path: "../../"` would allow the extracted content to be copied to an arbitrary filesystem location outside the plugins directory.

Fix applied: resolved `pluginSrcDir` via `path.resolve` and asserted it starts with `rootDir + path.sep`.

**Warning:** `installDependencies` runs `npm install` inside the plugin directory. The `package.json` scripts field is not sandboxed — a malicious plugin could run arbitrary commands via npm lifecycle hooks (e.g., `postinstall`). Consider running with `--ignore-scripts` for untrusted plugins.

### packages/plugins/src/registry.ts
Clean. All SQL queries use parameterized statements — no injection risk. `getPluginDir` produces a safe path because `pluginId` is validated by the Zod regex. `uninstallPlugin` removes the DB record and filesystem directory. `checkUpdates` correctly groups by registry and uses a single fetch per registry. No unused imports. 181 LOC — within limit.

### packages/plugins/src/loader.ts — CRITICAL (fixed)
**[FIXED] Path traversal via `manifest.main`:** `path.resolve(pluginDir, manifest.main)` was called without checking the result stays within `pluginDir`. A plugin manifest with `"main": "/etc/passwd"` or `"main": "../../other-plugin/index.js"` would resolve to a path outside the plugin directory. The module would then be dynamically imported from that path.

Fix applied: added a bounds check — throws if `mainEntry` does not start with `pluginDir + path.sep`.

**Warning:** Dynamic `import(fileUrl)` executes arbitrary plugin code. There is no sandbox (Worker, vm context, etc.). This is architectural — plugins run in the same process with full Node.js capabilities. Document this limitation explicitly in the SDK README.

### packages/ui/src/utils/markdown.ts — CRITICAL (fixed)
**[FIXED] `javascript:` scheme XSS via link URLs:** The renderer correctly escapes `&`, `<`, `>`, and `"` in step 3, so attribute-breaking via double-quotes was not possible. However, `javascript:alert(1)` contains no HTML special characters and would pass through all escaping steps unchanged, producing `<a href="javascript:alert(1)">` in the output — a live XSS vector when used with `innerHTML`.

Fix applied: the link replacement step now extracts the URL scheme and only allows `http`, `https`, and `mailto`. Any other scheme renders the link text as plain text with no anchor element.

**Note:** The overall escaping pipeline in `utils/markdown.ts` is structurally sound — code blocks are extracted to placeholders first (preventing double-processing), remaining text is HTML-escaped before inline transformations apply, and bold substitution operates on already-escaped text.

### packages/ui/src/components/chat/MessageBubble.tsx — CRITICAL (fixed)
**[FIXED] Local duplicate `renderMarkdown` with XSS:** The component contained a local `renderMarkdown` that:
1. Did **not** escape `"`, enabling attribute injection in link `href` values (e.g., `[x](https://x.com/" onclick="alert(1)`).
2. Inserted the captured code block content (`$1`) via regex replacement without re-escaping, meaning code escaped by step 1 would render correctly but the escaping was fragile.
3. Was a divergent copy of `utils/markdown.ts` — two markdown implementations in the same codebase will drift.

Fix applied: removed the local function entirely; component now imports `renderMarkdown` from `../../utils/markdown`.

**Warning:** `<span innerHTML={renderMarkdown(props.content)} />` — the use of `innerHTML` is intentional for markdown rendering, and is now gated behind the fixed `renderMarkdown`. This is acceptable only so long as `renderMarkdown` is kept secure. A lint rule banning raw `innerHTML` with an exception comment for this call site would improve auditability.

### packages/ui/src/components/chat/MessageList.tsx — CRITICAL (fixed)
**[FIXED] Wrong field name `msg.createdAt`:** `Message` (defined in `gateway/types.ts`) uses `timestamp: number`, not `createdAt`. The component passed `msg.createdAt` to `MessageBubble.createdAt`, which would always be `undefined`, rendering all timestamps as `Invalid Date`.

Fix applied: changed to `msg.timestamp`.

### packages/ui/src/components/chat/ChatView.tsx
Clean. Slim orchestration component. Correct use of `onMount` for history loading. Imports `StatusBar` — note that `StatusBar` is now rendered both inside `ChatView` and in `App.tsx` (`<div class="app-status"><StatusBar /></div>`), meaning the status bar appears twice in the chat tab layout. This is a UI duplication bug.

**Warning (UI duplication):** `App.tsx` renders `<StatusBar />` inside `.app-status` unconditionally, and `ChatView` also renders `<StatusBar />` at the top. In the chat tab, two status bars will be visible. Either remove `StatusBar` from `ChatView` or remove it from `App.tsx`.

### packages/ui/src/components/chat/ChatInput.tsx
Functional. `Spinner` component defined in the same file — acceptable given its trivial size. Auto-resize textarea logic is correct. Keyboard shortcut `Ctrl+Enter` for send is clear. 111 LOC — within limit.

**Minor:** `createEffect` on line 22 reads `const _ = store.chat.input;` purely to track the signal — this idiom is valid in SolidJS but slightly obscure; a comment would help.

### packages/ui/src/components/sessions/SessionList.tsx
Functional. Uses `SessionRow` type extension to handle optional fields gracefully. Inline mouse-enter/leave style mutations are used for hover effects instead of CSS — works but can flicker if SolidJS re-renders the row.

**Warning:** `store.sessions as SessionRow[]` is an unsafe cast. `SessionInfo` does not include `state`, `channel`, or `updatedAt`. These fields could be `undefined` safely but the cast suppresses any TypeScript checks. Better: extend `SessionInfo` in `gateway/types.ts` or define the extended shape there.

### packages/ui/src/components/config/ConfigEditor.tsx — WARNING
**Direct store mutations bypass `setStore`:** All input handlers directly assign to `store.config.gateway.port = ...`, `store.config.agent.defaultModel = ...`, etc. In SolidJS, the store is backed by a Proxy that does intercept direct property writes on nested objects, so this technically works. However it is not idiomatic, is not guaranteed across SolidJS versions, and bypasses any middleware or batching. Use `setStore("config", section, key, value)` pattern.

**Warning:** `ConfigEditor` calls `saveConfig(s, { ...store.config[s] })` — this spreads a shallow copy of the section. Because the store proxy intercepts reads during the spread, the values are correct, but a deep nested config object would only be shallowly copied.

### packages/ui/src/components/LoginPrompt.tsx
Clean. Error handling is user-facing and informative. Credentials stored in `localStorage` — acceptable for a developer tool. No sensitive data logged. 128 LOC — within limit.

**Note:** The gateway URL is not validated before attempting connection. An invalid URL string will result in a WebSocket constructor error bubbled up from `connectAndAuthenticate`, which is handled and displayed. This is acceptable.

### packages/ui/src/components/shared/StatusBar.tsx
Clean, 63 LOC. Reactive correctly — `status()` is a derived accessor.

**Note:** The `@keyframes pulse` style block is injected but never referenced by any element. Dead CSS.

### packages/ui/src/components/shared/TabBar.tsx
Clean, 71 LOC. Correct use of SolidJS `For`. Inline hover style mutations (like `SessionList`) — minor.

**Note:** Tab icons use Unicode emoji codepoints. These will render inconsistently across platforms/fonts.

### packages/ui/src/components/shared/Toast.tsx
Mostly clean. `showToast` is a module-level singleton function — works for a single-app context. `onCleanup` clears all toasts when `Toast` unmounts, which is correct.

**Warning:** The `setTimeout` timer in `showToast` is not cancelled if `Toast` unmounts before it fires — `setToasts` will be called on an already-cleaned state. This is harmless in practice (SolidJS handles stale signal writes gracefully) but could log a warning in strict mode. Store the timers in a `Set` and clear them in a cleanup.

**Warning:** `void timer` on line 33 is an antipattern comment workaround. The variable is unused; just remove it and the assignment.

### packages/ui/src/gateway/client.ts — CRITICAL (fixed)
**[FIXED] Leaked `session:created` event listener on each `connect()` call:** The `connect` method registered two separate `session:created` listeners:
- One to `resolve()` the promise (correctly removed via `unsub()`).
- A second one solely to `clearTimeout(timer)`, which was **never unsubscribed**.

Each call to `connect()` accumulated an additional permanent listener in the listener set. On reconnection loops, this would grow unboundedly.

Fix applied: moved `clearTimeout(timer)` into the first listener (before `unsub()` and `resolve()`), and removed the second `onEvent` call entirely.

**Warning:** `GATEWAY_URL` constant (`"ws://localhost:18789/ws"`) is defined both in `client.ts` (line 12) and in `app.ts` (as the `createGatewayClient` argument). The one in `client.ts` is a fallback default that is never actually used (app.ts always passes an explicit value). Remove the `client.ts` duplicate or export a shared constant.

**Warning:** `ws.onerror` handler is empty. WebSocket errors (e.g., certificate failures, DNS errors) produce an `error` event before the `close` event. While reconnect logic is triggered by `onclose`, the error itself is silently swallowed. At minimum, log it.

### packages/ui/src/gateway/types.ts
Clean and complete. All necessary protocol types are defined. `RequestMethod` union covers all methods used in `actions.ts`. 83 LOC.

### packages/ui/src/stores/app.ts
Clean. `createStore` used correctly. Gateway singleton initialized at module level. Event wiring is clean. `setConnectionError` correctly sets both `status` and `error` atomically.

**Minor:** `createGatewayClient` is called at module import time with hardcoded `"ws://localhost:18789/ws"` — the URL is immediately overridden by `connect(url, token)` calls, so this is fine, but it is slightly misleading. A comment noting this would help.

### packages/ui/src/stores/actions.ts
Clean. All async actions have try/catch with `setStore("connection", "error", ...)` on failure. `sendMessage` uses optimistic updates correctly. `initGateway` wraps `connectAndAuthenticate` in a fire-and-forget to avoid uncaught promise rejections.

**Warning:** `loadHistory` and `loadSessions` silently swallow errors into `connection.error` but do not set any loading state or notify the user via Toast. The UI has no visible error state for these operations (the StatusBar only shows connection status, not request errors).

**Duplicate comment:** Lines 111-112 both have JSDoc blocks on the same function — one is orphaned. Remove the stale comment block above `initGateway`.

### packages/ui/src/App.tsx
Clean. `onMount` + `createEffect` pattern for reconnection is correct. `hasCredentials` gate correctly prevents rendering chat UI without a connection. `Switch`/`Match` is exhaustive for all defined `TabName` values. 81 LOC.

### packages/ui/src/index.tsx
Clean. Standard SolidJS entry point. Root element null check is correct. 12 LOC.

---

## Critical Issues Fixed

| # | File | Issue | Fix Applied |
|---|------|-------|-------------|
| 1 | `ui/src/utils/markdown.ts` | `javascript:` URL scheme passes through all escaping, enabling XSS via `innerHTML` | Scheme allowlist: only `http`, `https`, `mailto` generate anchor tags |
| 2 | `ui/src/components/chat/MessageBubble.tsx` | Local `renderMarkdown` lacked `"` escaping, enabling href attribute injection XSS; divergent copy of shared utility | Removed local function; imported from `utils/markdown` |
| 3 | `ui/src/components/chat/MessageList.tsx` | `msg.createdAt` field does not exist on `Message` (field is `timestamp`); all timestamps render as `Invalid Date` | Changed to `msg.timestamp` |
| 4 | `plugins/src/installer.ts` | `inRepoPath` from remote registry used in `path.join` without bounds check — path traversal allows writing files outside `~/.nexus/plugins/` | Added `path.resolve` + `startsWith(rootDir + path.sep)` guard |
| 5 | `plugins/src/loader.ts` | `manifest.main` from on-disk plugin used in `path.resolve(pluginDir, ...)` without bounds check — could load files outside the plugin directory | Added `startsWith(pluginDir + path.sep)` guard |
| 6 | `ui/src/gateway/client.ts` | Second `session:created` listener registered per `connect()` call, never unsubscribed — listener set grows on every reconnect | Merged `clearTimeout` into the first listener; removed second `onEvent` call |

---

## Warnings (not fixed — require design decisions)

| Severity | File | Issue |
|----------|------|-------|
| Medium | `plugins/src/installer.ts` | `npm install` runs plugin lifecycle scripts — malicious `postinstall` can execute arbitrary code. Consider `--ignore-scripts` flag. |
| Medium | `ui/src/components/config/ConfigEditor.tsx` | Direct mutations of SolidJS store properties (`store.config.gateway.port = ...`) bypass `setStore` idiom. |
| Medium | `ui/src/components/chat/ChatView.tsx` | `StatusBar` rendered twice in chat tab — once in `App.tsx`, once inside `ChatView`. |
| Medium | `ui/src/stores/actions.ts` | No loading/error UI state for `loadHistory` and `loadSessions` failures (errors go to `connection.error` only). |
| Low | `ui/src/components/sessions/SessionList.tsx` | `store.sessions as SessionRow[]` is an unsafe cast — `SessionInfo` lacks `state`, `channel`, `updatedAt` fields. |
| Low | `ui/src/gateway/client.ts` | `ws.onerror` is empty — connection errors silently dropped before `onclose` fires. |
| Low | `ui/src/gateway/client.ts` | `GATEWAY_URL` constant duplicated in `client.ts` and `app.ts`. |
| Low | `ui/src/stores/actions.ts` | Stale orphaned JSDoc block above `initGateway`. |
| Low | `ui/src/components/shared/StatusBar.tsx` | `@keyframes pulse` defined in injected `<style>` but never referenced. Dead CSS. |
| Low | `ui/src/components/shared/Toast.tsx` | `setTimeout` timers not cancelled on component cleanup; `void timer` antipattern. |
| Low | `plugins/src/marketplace.ts` | `MarketplaceEntry.path` has no pattern constraint — traverse-style paths could fetch arbitrary repo files via GitHub raw URLs. |
| Low | `plugins/src/loader.ts` | Plugins run in the same Node.js process with no sandbox. Should be documented. |

---

## Type Safety Assessment

- No bare `any` types found across either package.
- Unsafe casts present and noted: `msg as Record<string, unknown>` (client.ts), `payload as Message` (app.ts), `store.sessions as SessionRow[]` (SessionList.tsx) — all are narrow and pragmatic given the dynamic WebSocket protocol.
- `ToolDefinition.execute(input: unknown)` and `HookDefinition.handler(payload: unknown)` correctly use `unknown` rather than `any`, requiring callers to narrow before use.
- `Record<string, unknown>` for config sections is acceptable given the config shape is server-defined and dynamic.

---

## Code Quality Assessment

- All files are under 200 LOC.
- No dead code or unused imports found.
- `index.ts` for plugins correctly re-exports every public symbol.
- `utils/markdown.ts` and `gateway/client.ts` are the most complex files — complexity is justified.
- `ConfigEditor.tsx` is dense with inline styles — readable but hard to maintain; extracting style constants (as already done with `inp`, `lbl`, `field`) is the right direction.

---

## Final Verdict: REQUEST_CHANGES

Six critical issues were identified and fixed directly in source:
- Two XSS vulnerabilities (markdown renderer + MessageBubble duplicate)
- One broken field reference (msg.createdAt → msg.timestamp)
- Two path traversal vulnerabilities (installer + loader)
- One event listener leak (gateway client)

The remaining warnings are design-level concerns that require team discussion before resolving, particularly the direct store mutation pattern in ConfigEditor and the duplicate StatusBar rendering. The plugin SDK API is clean, minimal, and correctly typed. The plugin infrastructure (marketplace + installer + registry + loader) is well-structured with good error handling throughout.
