# Gateway & CLI Code Review

**Reviewer:** Review Agent (Claude Sonnet 4.6)
**Date:** 2026-03-22
**Scope:** `packages/gateway/src/` and `packages/cli/src/` (excluding `__tests__`)
**Verdict:** REQUEST_CHANGES — 6 critical issues found; all fixed in this pass.

---

## File-by-File Summary

| File | LOC | Status | Notes |
|------|-----|--------|-------|
| `gateway/src/index.ts` | 8 | PASS | Clean barrel; correct `export type` usage. |
| `gateway/src/protocol/frames.ts` | 75 | PASS | Zod schemas correct; types properly co-located. |
| `gateway/src/middleware/auth.ts` | 114 | PASS (with warning) | Logic sound; `deviceToken` path is a documented stub. |
| `gateway/src/server.ts` | 387 | NEEDS-WORK → FIXED | Two critical bugs fixed (see C-1, C-2). |
| `gateway/src/handlers/chat.ts` | 96 | PASS | Params validated with Zod; session checked before use. |
| `gateway/src/handlers/sessions.ts` | 79 | PASS | Clean; UUID generated server-side when caller omits it. |
| `gateway/src/handlers/config.ts` | 96 | NEEDS-WORK → FIXED | Credential leak fixed (see C-3). |
| `gateway/src/handlers/agent.ts` | 80 | PASS | Proper try/catch; session pre-check. |
| `cli/src/index.ts` | 23 | PASS | Top-level `await import` is fine under Bun. |
| `cli/src/commands/gateway.ts` | 38 | PASS | Signal handlers correct; dynamic import avoids load penalty. |
| `cli/src/commands/config.ts` | 42 | NEEDS-WORK → FIXED | Added section allowlist + Zod validation (see C-4). |
| `cli/src/commands/send.ts` | 63 | NEEDS-WORK → FIXED | Missing handshake fixed (see C-5). |
| `cli/src/commands/status.ts` | 43 | PASS (with warning) | Timeout logic correct; minor bind-address issue (W-3). |
| `cli/src/commands/marketplace.ts` | 211 | NEEDS-WORK → FIXED | SSRF fix applied (see C-6). Slight LOC over limit. |
| `cli/src/commands/plugins.ts` | 560 | NEEDS-WORK → FIXED | SSRF + version-tracking bug fixed (see C-6, C-7). Over 200 LOC limit. |

---

## Critical Issues (MUST fix before merge)

### C-1 — `server.ts`: Unhandled promise rejection from async WS handler

**File:** `packages/gateway/src/server.ts` line 351–353 (pre-fix)

**Problem:** `handleWsMessage` is declared `async` and returns `Promise<void>`, but the
`ws.on("message", ...)` callback called it without `await` or `.catch()`:

```ts
ws.on("message", (data) => {
  handleWsMessage(client, data.toString()); // Promise dropped on the floor
});
```

Any unhandled exception thrown inside `handleWsMessage` (e.g. from `getOrCreateAgent`,
`getOrCreateSession`, or a handler) would produce an `UnhandledPromiseRejectionWarning`
in Node ≤ 14 and a hard crash (`--unhandled-rejections=throw` default) in Node 15+.

**Fix applied:** Added `.catch()` that logs the error and sends an `INTERNAL_ERROR` frame
to the client rather than silently crashing the server process.

---

### C-2 — `server.ts`: Client ID collision overwrites existing connection

**File:** `packages/gateway/src/server.ts` line 340 (pre-fix)

**Problem:**
```ts
const clientId = req.socket.remoteAddress ?? uuid();
```
Two concurrent connections from the same IP (e.g. browser tab + CLI, or behind NAT)
share a `clientId`. The second `clients.set(clientId, client)` silently overwrites the
first entry. The first client's socket is lost from the map: its WS error/close events
no longer clean up the entry, and it never receives broadcasts. Under load this leaks
sockets indefinitely because the orphaned entry is never removed.

**Fix applied:** Always generate a `uuid()` for `clientId`. The remote address is still
logged for diagnostics via a separate `remoteAddr` variable.

---

### C-3 — `handlers/config.ts`: `config.get` leaks authentication credentials

**File:** `packages/gateway/src/handlers/config.ts`

**Problem:** The `config.get` RPC handler returned the entire `NexusConfig` object —
including `security.gatewayToken` and `security.gatewayPassword` — to any authenticated
WebSocket client:

```ts
const config = getAllConfig();
return { id: "", ok: true, payload: { config } };
```

An attacker who obtains a valid session (e.g. through a compromised client) could then
retrieve the server's own token/password and use it to authenticate new sessions or
exfiltrate credentials.

**Fix applied:** Introduced `redactSection()` helper. The `security` section now has
`gatewayToken` and `gatewayPassword` replaced with `"[REDACTED]"` before transmission,
for both full-config and section-specific responses.

---

### C-4 — `cli/commands/config.ts`: `config set` writes arbitrary keys without validation

**File:** `packages/cli/src/commands/config.ts`

**Problem:** The CLI `config set <section> <json>` command passed the user-supplied JSON
directly to `setConfigSection(section, parsed)` with no allowlist check on `section` and
no Zod validation on the value. This allowed:
- Writing to arbitrary config keys (e.g. `nexus config set __proto__ '{"polluted":true}'`).
- Storing structurally invalid values that would later cause schema parse errors at
  server startup.

**Fix applied:** Added an allowlist check against `VALID_SECTIONS` and Zod validation
via `NexusConfigSchema.shape[section].safeParse(parsed)` before persisting. Mirrors the
existing validation in the gateway's `handleConfigSet` RPC handler.

---

### C-5 — `cli/commands/send.ts`: Skips mandatory ConnectParams handshake

**File:** `packages/cli/src/commands/send.ts`

**Problem:** The Nexus WS protocol requires the client to send a `ConnectParams` JSON
object as the **first** message after upgrade. The server authenticates from this message
and responds with `HelloOk` before accepting any `RequestFrame`. The `send` command
connected and immediately sent an RPC request frame without performing the handshake:

```ts
ws.on("open", () => {
  ws.send(JSON.stringify(request)); // Server closes with 4401 AUTH_FAILED
});
```

This means `nexus send -m "hello"` has never worked against a running gateway.

Additionally the old code sent `{ jsonrpc, id, method, params: { message, sessionId } }`
which does not match the `RequestFrame` schema (`{ id, method, params }` — no `jsonrpc`
key; `params` uses `content` not `message` per `ChatSendParams`).

**Fix applied:**
1. On `open`: send `ConnectParams` (with token from `--token` flag or config).
2. On first `message`: validate `HelloOk`, extract server-assigned `sessionId`, then
   send the `RequestFrame` with correct schema.
3. On subsequent `message`: print RPC response payload or error.
4. Added `--token` CLI option so the user can supply a token without editing config.

---

### C-6 — `marketplace.ts` and `plugins.ts`: SSRF via unvalidated registry URL scheme

**Files:** `packages/cli/src/commands/marketplace.ts`,
`packages/cli/src/commands/plugins.ts`

**Problem:** Both `validateRegistry()` (marketplace) and `fetchRegistryIndex()` (plugins)
called `fetch(url)` directly without checking the URL scheme. A malicious registry entry
or a user tricked into running `nexus plugins registry add file:///etc/passwd` could:
- Read local files via `file://` (supported by some runtimes including Bun).
- Hit internal network services via `http://169.254.169.254/` (cloud IMDS).
- Trigger other non-HTTP protocols.

**Fix applied:** Parse the URL with `new URL()` and reject any scheme other than `http:`
or `https:` before calling `fetch`. Applied to both files independently since they each
have their own fetch helper (see W-1 for the duplication warning).

---

### C-7 — `plugins.ts`: `update` command reports wrong `from` version (always equal to `to`)

**File:** `packages/cli/src/commands/plugins.ts`

**Problem:** The `from` version in the result record was captured **after** mutating
`plugin.version`:

```ts
plugin.version = remote.version;          // mutates the object
// ...
results.push({ ..., from: plugin.version, // now equals remote.version — always same as `to`
                    to: remote.version, status: "updated" });
```

Output: `Updated my-plugin: 2.0.0 -> 2.0.0` (both versions identical). The old version
was silently lost.

**Fix applied:** Snapshot `prevVersion = plugin.version` before mutation; use it as
`from` in the result record.

---

## Warnings (address later)

### W-1 — `plugins.ts` duplicates `marketplace.ts` almost entirely

`packages/cli/src/commands/plugins.ts` (560 LOC, 2.8× over the 200-LOC limit) contains
its own `RegistryIndex`, `RegistryEntry`, and `fetchRegistryIndex` that are near-identical
to the exported equivalents in `marketplace.ts`. `marketplace.ts` is never imported by
any other file — it is effectively dead code.

**Recommendation:** Delete `marketplace.ts` or make it the canonical module and import
from it in `plugins.ts`. This would bring `plugins.ts` well under 200 LOC and eliminate
the dual maintenance burden (e.g. the SSRF fix in C-6 had to be applied twice).

---

### W-2 — `middleware/auth.ts`: `deviceToken` path is a no-op security stub

Any non-empty `deviceToken` is accepted as valid when no `token`/`password` is configured.
The comment acknowledges this. Until the `paired_devices` table lookup and hash
verification are implemented, this path provides zero real authentication.

**Recommendation:** Add a clear warning log (already present) and document in a TODO
ticket. Consider rejecting `deviceToken` with `"Not implemented"` rather than silently
accepting it, to prevent the stub from shipping to production unnoticed.

---

### W-3 — `status.ts` and `send.ts`: bind-address logic for non-loopback is wrong

```ts
const host = config.gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
```

Connecting to `0.0.0.0` is not meaningful as a client address — `0.0.0.0` is a
server-side wildcard, not a routable address. When `bind === "all"` the CLI should
connect to `127.0.0.1` (loopback to reach the local process) or to a user-specified
host. When `bind === "lan"` it should similarly default to `127.0.0.1` unless the user
explicitly provides a host.

**Recommendation:** Default the client connection to `127.0.0.1` regardless of bind
mode, and add a `--host` option to `send` and `status` for remote gateway access.

---

### W-4 — `server.ts`: `handleWsMessage` accepts binary WebSocket frames as UTF-8

```ts
ws.on("message", (data) => {
  handleWsMessage(client, data.toString()); // Buffer.toString() defaults to UTF-8
});
```

If a client sends a binary frame (e.g. a Buffer with arbitrary bytes), `data.toString()`
will attempt UTF-8 decoding and produce garbage input to `JSON.parse`. The JSON parse
will fail and the client receives a `PARSE_ERROR`, but the conversion silently corrupts
multi-byte sequences. A more robust approach is to reject non-string frames explicitly:

```ts
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    sendError(ws, "", "INVALID_FRAME", "Binary frames are not supported");
    return;
  }
  handleWsMessage(client, data.toString()).catch(...);
});
```

---

### W-5 — `frames.ts`: `EventFrame.payload` uses `z.record(z.unknown())` — prevents scalar events

`EventFrame.payload` is typed as `Record<string, unknown>` (always an object). This
prevents broadcasting scalar or array payloads. The `broadcast()` helper in `server.ts`
also types its second argument as `Record<string, unknown>`. This is fine for current
usage but worth noting if future events need to carry non-object payloads.

---

### W-6 — `handlers/config.ts`: `config.set` allows changing `security.gatewayToken` over WS

Any authenticated client can call `config.set { section: "security", value: { gatewayToken: "attacker" } }`
and replace the server's auth token mid-flight. This is a privilege escalation if the
initial auth was via a weaker method (e.g. anonymous / device token stub). Consider
restricting `config.set` for the `security` section to localhost-origin connections only,
or adding an explicit "admin" auth tier.

---

## Protocol Correctness Assessment

| Check | Result |
|-------|--------|
| Frame schemas match Zod definitions | PASS |
| Handshake sequence (ConnectParams → HelloOk → RequestFrame) | PASS (server side); CLI was broken — FIXED |
| Auth before any RPC accepted | PASS — `client.authed` guard is correct |
| `id` field echoed back in responses | PASS — `response.id = id` assigned after handler returns |
| Error frames always sent before close | PASS — `sendError` checks `readyState === OPEN` |
| `EventFrame.seq` is monotonic | PASS — module-level `eventSeq` incremented atomically (single-threaded) |
| Binary frame handling | WARNING — see W-4 |

---

## API Surface Assessment

| Handler | Params validated | Error codes sensible | Session pre-checked |
|---------|-----------------|---------------------|-------------------|
| `chat.send` | YES (Zod) | YES | YES |
| `chat.history` | YES (Zod) | YES | YES |
| `sessions.list` | YES (Zod) | YES | N/A |
| `sessions.create` | YES (Zod) | YES | N/A |
| `config.get` | YES (Zod) | YES | N/A |
| `config.set` | YES (Zod + section schema) | YES | N/A |
| `agent.run` | YES (Zod) | YES | YES |

All handlers return `{ id: "" }` as a stub — the `id` is overwritten by
`response.id = id` in `server.ts:293` before sending. This is correct but subtle;
consider having handlers accept `id` as a parameter to make the contract explicit.

---

## Files Changed by This Review

| File | Change |
|------|--------|
| `packages/gateway/src/server.ts` | C-1: `.catch()` on async handler; C-2: always use `uuid()` for `clientId` |
| `packages/gateway/src/handlers/config.ts` | C-3: redact `gatewayToken`/`gatewayPassword` in all `config.get` responses |
| `packages/cli/src/commands/config.ts` | C-4: added section allowlist + Zod validation to `config set` |
| `packages/cli/src/commands/send.ts` | C-5: implement full ConnectParams → HelloOk → RequestFrame handshake |
| `packages/cli/src/commands/marketplace.ts` | C-6: reject non-http(s) URL schemes before `fetch` |
| `packages/cli/src/commands/plugins.ts` | C-6: same SSRF fix in `fetchRegistryIndex`; C-7: snapshot `prevVersion` before mutation |

---

## Final Verdict: REQUEST_CHANGES

Six critical defects were found and fixed in this pass. The most severe were:

1. **Unhandled async rejection** (C-1) — would crash the gateway process under load.
2. **Client ID collision** (C-2) — silently dropped connections and leaked sockets.
3. **Credential exposure via `config.get`** (C-3) — auth tokens sent in plaintext over WS.
4. **CLI handshake bypass** (C-5) — `nexus send` has never worked against a live gateway.

All six fixes are applied directly to source. Four warnings (W-1 through W-6) remain
open for follow-up; none are blocking but W-1 (dead-code duplication) and W-6 (privilege
escalation on `config.set security`) should be addressed before the next release.
