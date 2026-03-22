# Code Review: channels package + telegram/discord extensions

**Reviewer:** Claude Code (automated)
**Date:** 2026-03-22
**Scope:**
- `packages/channels/src/` (adapter, registry, allowlist, pairing, reply, router, index)
- `extensions/telegram/src/` (types, bot, adapter, index)
- `extensions/discord/src/` (types, rest, gateway, adapter, index)

All critical issues below were fixed inline before this report was written.

---

## File Summaries

### `packages/channels/src/adapter.ts`
Defines `ChannelAdapter`, `ChannelCapabilities`, `ChannelContext`, and `SendOptions`. Clean, well-typed, no dead code.

**Fixed:** Added `markdown: boolean` to `ChannelCapabilities`. Previously this field was absent, causing a downstream bug in `reply.ts` (see CRIT-1).

---

### `packages/channels/src/registry.ts`
Manages adapter lifecycle with a module-level singleton. Idiomatic, straightforward, no type issues. `_resetRegistry()` is correctly gated for tests. No concerns.

---

### `packages/channels/src/allowlist.ts`
Implements glob-based allowlist evaluation backed by SQLite. The algorithm (channel-specific rules first, then global rules, deny-by-default when rules exist) is correct and well-documented.

**Warning W-1:** The `patternToRegex` function does not anchor or constrain the sender ID before calling `regex.test()`. If a `senderId` contains characters such as `\n`, a multi-line pattern could match unexpectedly. This is low risk given that sender IDs are platform-assigned numeric/string identifiers, but worth noting.

---

### `packages/channels/src/pairing.ts`
DM pairing challenge flow. Uses `crypto.getRandomValues` for code generation — good entropy choice. `CODE_ALPHABET` is 32 chars, 256/32 = 8 exactly, so there is **no modulo bias**.

**Warning W-2:** `ensurePairingTable()` is called on every public method entry. The `CREATE TABLE IF NOT EXISTS` DDL is idempotent but triggers a write transaction on every call. Consider caching a boolean flag after the first successful call to avoid repeated DDL execution in hot paths.

**Warning W-3:** `approvePairing` logs the `senderId` but `revokePairingChallenge` does not record an audit event. For security auditability, revocations should also be recorded.

---

### `packages/channels/src/reply.ts`
**Fixed (CRIT-1):** The `formatReply` function previously used `adapter.capabilities.media` as a heuristic for whether the channel supports markdown. This was wrong: a channel that supports file uploads but not markdown rendering (e.g. SMS gateways with media support) would receive un-stripped markdown, and a markdown-capable channel without media support would have its output silently stripped. Fixed to use `adapter.capabilities.markdown` (the new dedicated capability field).

**Warning W-4:** `truncateContent` truncates at a fixed 4096-character ceiling regardless of channel. Some channels have much lower limits (Telegram messages: 4096; Discord messages: 2000). This should ideally be per-adapter. Currently only a warning since the truncation prevents hard API errors, but the threshold is too generous for Discord (2000 chars).

---

### `packages/channels/src/router.ts`
**Fixed (CRIT-2):** Empty or whitespace-only messages were passed through to the agent without any guard. An empty string sent to the agent wastes API quota and may produce confusing responses. Added an early-return guard at the top of `routeInbound`.

**Warning W-5:** `getChannelConfig` silently swallows all errors from `getConfig`. If `getConfig` throws for reasons other than "key not found" (e.g. corrupted config store), the channel will silently fall back to `policy: "strict"` without any log warning. Consider narrowing the catch to a `KeyNotFoundError` type if the core provides one.

**Warning W-6:** `metadata?.messageId as string | undefined` on line 158 is an unsafe cast. If `metadata.messageId` is a number (e.g. Telegram's integer message IDs stored in metadata), coercing to `string | undefined` will pass a number through typed as a string. Use `String(metadata.messageId)` or validate the type explicitly.

---

### `extensions/telegram/src/types.ts`
Minimal, accurate Telegram API type subset. All types are properly typed; no `any`. No concerns.

---

### `extensions/telegram/src/bot.ts`
**Fixed (CRIT-3):** `sendMedia` in `adapter.ts` previously accessed the private `baseUrl` field of `TelegramBot` via `(this.bot as unknown as { baseUrl: string }).baseUrl`. Added a public `buildUrl(endpoint: string): string` method to `TelegramBot` to expose this safely without breaking encapsulation.

Backoff logic is correct and capped at 60 seconds. The polling loop properly resets `failureCount` on success and breaks cleanly when `_polling` is false.

**Warning W-7:** In `startPolling`, errors from `onUpdate(update)` are logged with `(err as Error).message` — this casts to `Error` unconditionally. If `onUpdate` throws a non-Error value (e.g. a string), `.message` will be `undefined`. Use the `err instanceof Error ? err.message : String(err)` pattern consistently.

---

### `extensions/telegram/src/adapter.ts`
**Fixed (CRIT-3, continued):** Replaced `(this.bot as unknown as { baseUrl: string }).baseUrl` with `this.bot.buildUrl(endpoint)`.

**Fixed (CRIT-4):** `sendMedia` returned `json.result!` (non-null assertion) after checking `json.ok === true`. A malformed but `ok: true` response could have yielded `undefined` typed as `TelegramMessage`. Replaced with an explicit check that throws a `TelegramBotError` if `result` is absent.

**Warning W-8:** `TelegramAdapter` does not implement the nexus `ChannelAdapter` interface from `@nexus/channels`. Its `start(handler: MessageHandler)` signature is incompatible with `start(ctx: ChannelContext)`. This means there is no nexus-registered adapter for Telegram out of the box — consumers must write their own wrapper. The Discord extension was fixed to implement the real interface; Telegram should receive the same treatment in a follow-up.

**Warning W-9:** In `normaliseMessage`, when `msg.from` is absent, a synthetic `from` object with `id: 0` is substituted. `id: 0` is not a valid Telegram user ID, and routing based on `senderId === "0"` could collide across multiple anonymous messages. A more defensive approach would be to return `null` (drop the message) when `from` is absent, especially for non-channel messages where a real sender is expected.

---

### `extensions/discord/src/types.ts`
**Fixed (CRIT-5):** The file previously contained a local `ChannelAdapter` interface stub:
```ts
export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendReply(channelId: string, text: string): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}
```
This interface is incompatible with the nexus `ChannelAdapter` contract (missing `id`, `name`, `capabilities`, and `start(ctx: ChannelContext)`). `DiscordAdapter` implementing it gave a false sense of contract compliance. The stub has been removed; `DiscordAdapter` now imports and implements the real `@nexus/channels` `ChannelAdapter`.

---

### `extensions/discord/src/rest.ts`
**Fixed (CRIT-6):** The `request` method did not wrap the initial `fetch()` call in a try/catch. A DNS failure or network timeout would throw a raw `TypeError` instead of a `DiscordApiError`, breaking any catch blocks that key on `DiscordApiError`. Added a try/catch that wraps network failures in `DiscordApiError(0, path, "Network error: ...")`.

**Warning W-10:** The rate-limit retry path calls `await res.json()` and `.catch(() => ({}))` — fine. However, `retry_after` from Discord can be a float (e.g. `1.5` seconds). The current code multiplies by 1000 correctly, so this is just a note.

**Warning W-11:** `MAX_RETRIES = 3` applies only to 429 rate-limit responses. Other transient 5xx errors are immediately thrown as `DiscordApiError` without retry. Consider applying the retry logic to 5xx responses as well.

---

### `extensions/discord/src/gateway.ts`
**Fixed (CRIT-7):** `startHeartbeat` previously stored the initial-beat `setTimeout` handle in `this.reconnectTimer`:
```ts
this.reconnectTimer = setTimeout(() => { ... }, firstBeat);
```
Because `reconnectTimer` is also used for reconnect scheduling, calling `clearTimers()` (e.g. during `reconnect()`) would cancel an in-flight first-heartbeat timeout, preventing the heartbeat loop from ever starting after a resume. Fixed by using `this.heartbeatTimer` for the initial-beat timeout. `clearInterval` in Node.js cancels both `setTimeout` and `setInterval` handles (both are `NodeJS.Timeout`), so `clearHeartbeat()` correctly handles the initial timeout and the subsequent interval.

**Warning W-12:** `onDispatch` handles only `READY` and `MESSAGE_CREATE` events. Other important dispatch events (`GUILD_CREATE`, `RESUMED`, `MESSAGE_UPDATE`) are silently dropped. At minimum, a `RESUMED` handler should reset `heartbeatAcked = true` and log success.

**Warning W-13:** `sendResume` sends the token in plaintext in the gateway payload `d` field. This is required by the Discord API but means the token is serialized to a JSON string on the wire. The `ws` library encrypts via TLS, so this is safe in transit, but the gateway object holds the token in memory indefinitely. This is standard practice but worth noting in a security audit.

---

### `extensions/discord/src/adapter.ts`
**Fixed (CRIT-5, CRIT-7 continued):** `DiscordAdapter` now correctly:
- Imports `ChannelAdapter`, `ChannelCapabilities`, `ChannelContext`, `SendOptions` from `@nexus/channels`.
- Declares `readonly id`, `readonly name`, `readonly capabilities` (with `markdown: false`).
- Implements `start(ctx: ChannelContext)` storing `ctx` for use in `handleRawMessage`.
- Routes inbound messages through `ctx.onInbound(authorId, content, metadata)`.
- Clears `ctx` on `stop()`.
- The unsafe cast `(adapter as unknown as { gateway: DiscordGateway }).gateway = gateway` in `DiscordAdapter.create()` has been removed; `gateway` and `rest` are now `private` (non-`readonly`) and can be directly assigned.
- Empty messages are now filtered before routing.

**Warning W-14:** `DiscordAdapter.capabilities.markdown` is set to `false`. Discord does support its own Markdown dialect. This can be changed to `true` if the router should not strip Discord markdown from outbound agent replies. For now `false` is a safe conservative default.

---

### `extensions/discord/src/index.ts`
**Fixed:** Removed re-export of the deleted local `ChannelAdapter` type.

---

## Critical Issues (all fixed)

| ID | File | Description | Fix |
|----|------|-------------|-----|
| CRIT-1 | `packages/channels/src/reply.ts` | `formatReply` used `capabilities.media` as proxy for markdown support — completely wrong heuristic, silently stripped or passed markdown incorrectly | Added `markdown: boolean` to `ChannelCapabilities`; `formatReply` now uses `capabilities.markdown` |
| CRIT-2 | `packages/channels/src/router.ts` | Empty/whitespace messages forwarded to agent without guard, wasting API quota | Added early-return guard for empty messages |
| CRIT-3 | `extensions/telegram/src/adapter.ts` + `bot.ts` | `sendMedia` accessed private `baseUrl` via `as unknown as { baseUrl: string }` — fragile, breaks encapsulation | Added public `buildUrl(endpoint)` to `TelegramBot`; updated `sendMedia` to call it |
| CRIT-4 | `extensions/telegram/src/adapter.ts` | `json.result!` non-null assertion after `ok: true` — could return `undefined` typed as `TelegramMessage` | Replaced with explicit undefined check + `TelegramBotError` |
| CRIT-5 | `extensions/discord/src/types.ts` + `adapter.ts` | Local `ChannelAdapter` interface incompatible with nexus contract; `DiscordAdapter` had wrong `start()` signature, missing `id`/`name`/`capabilities` | Deleted stub interface; `DiscordAdapter` now imports and implements real `@nexus/channels` `ChannelAdapter` |
| CRIT-6 | `extensions/discord/src/rest.ts` | `fetch()` not wrapped in try/catch — network errors threw raw `TypeError` | Added try/catch wrapping failures in `DiscordApiError(0, ...)` |
| CRIT-7 | `extensions/discord/src/gateway.ts` | `startHeartbeat` stored initial-beat timeout in `reconnectTimer`, causing `clearTimers()` to cancel heartbeat setup during reconnect | Changed to use `heartbeatTimer` for the initial-beat timeout |

---

## Warnings (not auto-fixed)

| ID | File | Description |
|----|------|-------------|
| W-1 | `allowlist.ts` | `patternToRegex` does not sanitize sender IDs containing newlines before `regex.test()` |
| W-2 | `pairing.ts` | `ensurePairingTable()` runs DDL on every public method call; consider a one-time init flag |
| W-3 | `pairing.ts` | `revokePairingChallenge` has no audit log call |
| W-4 | `reply.ts` | `truncateContent` uses 4096-char ceiling for all adapters; Discord's limit is 2000 |
| W-5 | `router.ts` | `getChannelConfig` catches all errors silently; should narrow to key-not-found |
| W-6 | `router.ts` | `metadata?.messageId as string | undefined` is an unsafe cast if `messageId` is numeric |
| W-7 | `bot.ts` (Telegram) | `(err as Error).message` in polling loop; use `err instanceof Error ? err.message : String(err)` |
| W-8 | `adapter.ts` (Telegram) | `TelegramAdapter` does not implement nexus `ChannelAdapter`; consumers must write their own nexus wrapper |
| W-9 | `adapter.ts` (Telegram) | Anonymous/channel-post messages get synthetic `from.id === 0`; could collide across senders |
| W-10 | `rest.ts` (Discord) | `retry_after` is a float; handled correctly but worth documenting |
| W-11 | `rest.ts` (Discord) | 5xx errors not retried, only 429 |
| W-12 | `gateway.ts` (Discord) | `RESUMED` and `GUILD_CREATE` dispatch events not handled |
| W-13 | `gateway.ts` (Discord) | Token serialized into resume payload (required by Discord; safe over TLS, noted for audit trail) |
| W-14 | `adapter.ts` (Discord) | `capabilities.markdown = false` is conservative; Discord does support Markdown |

---

## Channel Adapter Contract Consistency

| Requirement | Telegram | Discord (before) | Discord (after fix) |
|---|---|---|---|
| `readonly id: string` | No | No | **Yes** |
| `readonly name: string` | No | No | **Yes** |
| `readonly capabilities` | No | No | **Yes** |
| `start(ctx: ChannelContext)` | No (takes `MessageHandler`) | No (no ctx) | **Yes** |
| `stop(): Promise<void>` | Yes | Yes | Yes |
| `sendReply(target, content, options?)` | Yes | Partial (no options) | **Yes** |
| Calls `ctx.onInbound` | N/A | No | **Yes** |
| Filters bot self-messages | Yes | Yes | Yes |
| Filters empty messages | Yes | No | **Yes** |

**Follow-up required:** `TelegramAdapter` still needs to be promoted to a nexus-contract-compliant adapter (W-8). The recommended approach is a thin `TelegramChannelAdapter` wrapper class in `extensions/telegram/src/` that holds a `TelegramAdapter` internally and implements the nexus `ChannelAdapter` interface, wiring `start(ctx)` to `telegramAdapter.start(msg => ctx.onInbound(...))`.

---

## Line-count check (>200 LOC threshold)

| File | LOC |
|------|-----|
| `packages/channels/src/router.ts` | 182 |
| `packages/channels/src/pairing.ts` | 207 |
| `extensions/telegram/src/bot.ts` | 251 |
| `extensions/telegram/src/adapter.ts` | 299 |
| `extensions/discord/src/gateway.ts` | 265 |

`telegram/src/bot.ts`, `telegram/src/adapter.ts`, and `discord/src/gateway.ts` exceed 200 LOC. Of these, only `adapter.ts` (Telegram) is a candidate for splitting — the `sendMedia` logic (lines 237–296) could be extracted to a `telegram-media.ts` helper. The gateway and bot files are cohesive units and their length is justified.

---

## Final Verdict

**REQUEST_CHANGES** — 7 critical issues found; all have been fixed directly in the source files as part of this review. The most significant was CRIT-5: `DiscordAdapter` implementing a locally-defined shadow `ChannelAdapter` that bore no resemblance to the nexus contract, meaning the adapter would never have correctly integrated with the registry/router. The remaining warnings (W-1 through W-14) should be addressed before this code is considered production-ready, particularly W-8 (Telegram nexus wrapper) and W-4 (per-adapter truncation limits).
