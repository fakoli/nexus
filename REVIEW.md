# Nexus Code Review Report

**Reviewer:** Review Agent
**Date:** 2026-03-22
**Scope:** All source files in packages/core/src, packages/agent/src, packages/gateway/src, packages/cli/src
**Test files:** Not touched (out of scope).

---

## Linting Infrastructure Added

### `.eslintrc.json` (new file)
Strict TypeScript ESLint config added at project root with:
- `@typescript-eslint/no-explicit-any`: **error**
- `@typescript-eslint/no-unused-vars`: **error** (with `_`-prefix escape hatch)
- `@typescript-eslint/no-non-null-assertion`: **error**
- `@typescript-eslint/consistent-type-imports`: **error** (enforces `import type`)
- `no-console`: **warn** (disabled for `logger.ts` and all CLI commands)
- `recommended-requiring-type-checking` extended rules enabled

### `package.json` (updated)
Added to `devDependencies`:
- `eslint` ^9.0.0
- `@typescript-eslint/parser` ^8.0.0
- `@typescript-eslint/eslint-plugin` ^8.0.0
- `prettier` ^3.0.0

Added to `scripts`:
- `"lint": "eslint packages/*/src/**/*.ts"`
- `"lint:fix": "eslint --fix packages/*/src/**/*.ts"`

---

## Issues Found and Fixed

### 1. `packages/core/src/crypto.ts` — CJS `require()` in ESM module (CRITICAL)

**Problem:** `initMasterKey()` used `const fs = require("node:fs")` inside a branch, which is incompatible with `"type": "module"` in `package.json`. This would throw `ReferenceError: require is not defined` at runtime whenever `NEXUS_MASTER_KEY` was set.

**Fix:** Added `import fs from "node:fs"` at the top of the file and removed the inline `require()` call.

---

### 2. `packages/core/src/crypto.ts` — Unsafe non-null assertion (BUG)

**Problem:** `getMasterKey()` called `initMasterKey()` then returned `masterKey!`. If `initMasterKey()` ever failed to assign `masterKey` (e.g. due to an exception swallowed internally), the non-null assertion would hide a null-dereference that would surface later as a confusing crypto error.

**Fix:** Added an explicit post-init null check that throws a clear `Error("Master key could not be initialized")`.

---

### 3. `packages/agent/src/tools/bash.ts` — Unsafe `as` cast for error object (TYPE SAFETY)

**Problem:** `catch (err: unknown)` was immediately followed by `const execErr = err as { status?: number; ... }`. This is effectively an `any` cast — it suppresses type checking without verifying the shape.

**Fix:** Added a `typeof err === "object" && err !== null` guard before the cast, with a fallback branch for non-object errors.

---

### 4. `packages/agent/src/tool-executor.ts` — Missing return type annotation (TYPE SAFETY)

**Problem:** `getToolDefinitions()` had no return type annotation, causing TypeScript to infer a structural type that may drift from `ToolDefinition[]` if the mapping changed.

**Fix:** Added explicit `: ToolDefinition[]` return type and imported `ToolDefinition` from `./providers/base.js`.

---

### 5. `packages/agent/src/execution-loop.ts` — `response` declared without explicit type (TYPE SAFETY)

**Problem:** `let response;` was declared outside the `try` block, giving it the implicit type `any` (TypeScript infers the union `ProviderResponse | undefined` but treats subsequent uses as potentially uninitialized).

**Fix:** Changed to `let response: ProviderResponse;` and imported `ProviderResponse` from the base types.

---

### 6. `packages/agent/src/context-builder.ts` — Chained `as` double-casts for metadata (TYPE SAFETY)

**Problem:** Metadata fields were extracted via `(m.metadata as Record<string, unknown>).toolCallId as string | undefined` — this performs no runtime validation and silently accepts wrong types.

**Fix:** Replaced with `typeof meta?.toolCallId === "string"` guards, providing actual runtime type narrowing instead of blind casting.

---

### 7. `packages/gateway/src/server.ts` — `req.headers as Record<string, string>` unsafe cast (TYPE SAFETY / CORRECTNESS)

**Problem:** Node's `IncomingHttpHeaders` allows `string | string[] | undefined` values (e.g. `set-cookie` is always `string[]`). Casting to `Record<string, string>` silently drops multi-value headers and passes incorrect types to the WHATWG `Request` constructor.

**Fix:** Introduced a `flattenHeaders(headers: IncomingHttpHeaders): Record<string, string>` helper that joins array values with `", "` and drops undefined entries. The helper is called in the HTTP bridging closure.

---

### 8. `packages/gateway/src/server.ts` — Event forwarding casts (TYPE SAFETY)

**Problem:** All three `events.on(...)` callbacks used `e as Record<string, unknown>`, suppressing the typed event payloads from `NexusEvents`.

**Fix:** Used `as unknown as Record<string, unknown>` (explicit double-cast signalling intentional widening) for `session:created` and `session:message`. For `config:changed`, constructed an explicit `{ key, value }` object that preserves the typed payload structure rather than casting.

---

### 9. `packages/agent/src/providers/anthropic.ts` — Incomplete `stopReason` mapping (BUG)

**Problem:** The `complete()` method only mapped `"tool_use"` and defaulted everything else (including `"max_tokens"` and `"error"`) to `"end_turn"`. This caused the execution loop to treat a token-limit truncation as a normal end, potentially looping on incomplete tool use or swallowing truncated output.

**Fix:** Added explicit branches for `"max_tokens"` and `"error"` stop reasons, mapping them to the correct `ProviderResponse["stopReason"]` values.

---

### 10. `packages/agent/src/providers/openai.ts` — Incomplete `stopReason` mapping (BUG)

**Problem:** Same issue as above — OpenAI's `"length"` finish reason (token limit hit) was silently mapped to `"end_turn"` instead of `"max_tokens"`.

**Fix:** Added an explicit `"length"` → `"max_tokens"` branch.

---

### 11. `packages/core/src/sessions.ts` — `listSessions` returned unparsed JSON metadata (BUG)

**Problem:** `listSessions()` returned raw SQLite rows with `metadata` as a JSON string, but the function signature declares `Session[]` where `metadata` is `Record<string, unknown> | undefined`. This caused consumers to silently receive a string where an object was expected.

**Fix:** Added `.map()` post-processing to parse the `metadata` JSON string, consistent with the existing pattern in `getSession()`.

---

### 12. `packages/core/src/sessions.ts` — `getMessages` returned unparsed JSON metadata (BUG)

**Problem:** Same issue — `getMessages()` returned `Message[]` with `metadata` still as a raw JSON string from SQLite.

**Fix:** Added `.map()` post-processing to parse `metadata`, matching the pattern used in `getSession()`.

---

### 13. `packages/core/src/db.ts` — Pragma interpolation hardening (SECURITY / ROBUSTNESS)

**Problem:** `database.pragma(\`user_version = ${migration.version}\`)` interpolated the version number directly into the pragma string. While migration versions are controlled internal constants (not user input), this pattern is worth hardening in case the migration list ever receives external input.

**Fix:** Added `Math.trunc(migration.version)` before interpolation to guarantee the value is an integer with no decimal or injected characters.

---

### 14. `packages/cli/src/commands/send.ts` — Missing error handling on WebSocket JSON parse (ROBUSTNESS)

**Problem:** The `ws.on("message", ...)` callback called `JSON.parse(data.toString())` with no try/catch. A malformed or unexpected server response would throw an uncaught exception, crashing the CLI process with an opaque stack trace.

**Fix:** Wrapped the parse in `try/catch`, printing a clear error message and closing the socket on failure. Also added proper type assertions for the `error` and `result` sub-fields to avoid implicit `any`.

---

## Issues Noted but Not Fixed

The following are design-level observations that would require broader refactoring beyond a review fix:

- **`packages/gateway/src/middleware/auth.ts` device token auth is a stub.** The comment acknowledges this — it accepts any non-empty `deviceToken` as valid when no token/password is configured. This is intentionally deferred per the inline comment; a full implementation would query `paired_devices` and verify a HMAC/hash.

- **`packages/agent/src/providers/anthropic.ts` stream handler does not emit `tool_use_end`.** The `content_block_stop` event is received but yields nothing. The execution loop uses the non-streaming `complete()` path, so this is not currently a bug, but the `stream()` implementation is incomplete for any streaming consumer.

- **`packages/gateway/src/server.ts` client ID reuse.** Multiple connections from the same IP share a `clientId` based on `remoteAddress`. A second connection from the same IP would overwrite the first entry in `clients`. Using `uuid()` consistently would be safer.

- **`packages/core/src/sessions.ts` `createSession` uses non-null assertion (`getSession(id)!`).** This is safe in practice because the INSERT immediately precedes it, but it would be cleaner to throw explicitly if the row is not found.

---

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Added eslint/prettier devDependencies and lint scripts |
| `.eslintrc.json` | Created (new file) |
| `packages/core/src/crypto.ts` | Fixed ESM require(), fixed non-null assertion |
| `packages/core/src/db.ts` | Hardened pragma version interpolation |
| `packages/core/src/sessions.ts` | Fixed metadata JSON parsing in listSessions and getMessages |
| `packages/agent/src/tool-executor.ts` | Added ToolDefinition return type to getToolDefinitions |
| `packages/agent/src/execution-loop.ts` | Added ProviderResponse type to response variable |
| `packages/agent/src/context-builder.ts` | Replaced unsafe casts with typeof guards for metadata fields |
| `packages/agent/src/tools/bash.ts` | Added typeof guard before error object cast |
| `packages/agent/src/providers/anthropic.ts` | Fixed incomplete stopReason mapping |
| `packages/agent/src/providers/openai.ts` | Fixed incomplete stopReason mapping |
| `packages/gateway/src/server.ts` | Added flattenHeaders helper, fixed event forwarding casts |
| `packages/cli/src/commands/send.ts` | Added JSON.parse error handling and typed response access |
