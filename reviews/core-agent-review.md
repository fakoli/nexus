# Code Review: packages/core/src & packages/agent/src

**Reviewer:** Claude Code (automated)
**Date:** 2026-03-22
**Scope:** All non-test source files in `packages/core/src/` and `packages/agent/src/`

---

## File Summary

| File | Status | Notes |
|---|---|---|
| `core/src/types.ts` | PASS | Clean branded-type definitions, no issues |
| `core/src/db.ts` | PASS (w/ warning) | Well-structured migrations; pragma interpolation flagged as warning |
| `core/src/config.ts` | PASS | Parameterized queries, Zod validation, clean |
| `core/src/logger.ts` | PASS | Minimal, correct |
| `core/src/events.ts` | PASS | Typed event bus, no issues |
| `core/src/crypto.ts` | FIXED | **Critical:** static PBKDF2 salt replaced with per-installation random salt |
| `core/src/sessions.ts` | PASS (w/ warning) | Non-null assertion on `createSession` return; dynamic SQL is safe |
| `core/src/agents.ts` | PASS (w/ warning) | Non-null assertion on `createAgent` return |
| `core/src/audit.ts` | FIXED | **Critical:** `details` column was returned as raw JSON string, not deserialized object |
| `core/src/rate-limit.ts` | PASS | Correct transactional rate limiting |
| `core/src/index.ts` | PASS | All exports aligned with implementations |
| `agent/src/providers/base.ts` | PASS | Clean interface definitions |
| `agent/src/providers/anthropic.ts` | PASS (w/ warning) | `toolCallId!` non-null assertions; see warning W-3 |
| `agent/src/providers/openai.ts` | FIXED | **Critical:** unguarded `choices[0]` access + unguarded `JSON.parse` on tool arguments |
| `agent/src/providers/resolver.ts` | PASS | Clean failover logic; env var fallback correct |
| `agent/src/context-builder.ts` | PASS | Clean role mapping, no issues |
| `agent/src/execution-loop.ts` | PASS | Correct loop logic, proper error propagation |
| `agent/src/runtime.ts` | PASS | Good orchestration; error path returns a synthetic message rather than re-throwing (intentional) |
| `agent/src/tool-executor.ts` | PASS | Clean registry pattern, errors handled |
| `agent/src/tools/bash.ts` | FIXED | **Critical:** blocklist regex was dangerously narrow — only matched `rm -rf /` at EOL |
| `agent/src/tools/filesystem.ts` | PASS (w/ warning) | `write_file` has no path traversal guard or allowlist |

---

## Critical Issues (FIXED)

### C-1: Static PBKDF2 salt in `crypto.ts`
**File:** `packages/core/src/crypto.ts`
**Severity:** Critical — Security

The original `initMasterKey` used `crypto.createHash("sha256").update("nexus-vault-salt").digest()` as the PBKDF2 salt. A static, hardcoded salt:
- Is shared across all installations — an attacker who knows the salt can build a targeted dictionary attack
- Completely defeats the purpose of PBKDF2, which requires a unique random salt per derivation

**Fix applied:** Introduced `getOrCreateSalt()`. On first call it generates `crypto.randomBytes(32)` and persists it to the `config` table under the key `nexus_master_key_salt`. Subsequent calls load the persisted salt. The salt is now unique per installation and survives restarts.

**Note:** Existing encrypted credentials from before this fix are unaffected — they use AES-GCM with the master key stored in the key file path, not derived from a passphrase. Only the passphrase-derived code path was broken.

---

### C-2: Unguarded `choices[0]` access in `openai.ts`
**File:** `packages/agent/src/providers/openai.ts` — `complete()` method
**Severity:** Critical — Runtime crash

`response.choices[0]` was accessed without a null check. The OpenAI API can return an empty `choices` array under rate limit, content filter, or partial-response conditions. This would produce `TypeError: Cannot read properties of undefined (reading 'message')`, crashing the execution loop.

**Fix applied:** Added explicit guard: `if (!choice) throw new Error("OpenAI returned an empty choices array")`. The error propagates to `execution-loop.ts` where it is caught, `markProviderFailed` is called, and the error is re-thrown to `runtime.ts` where it is surfaced gracefully.

---

### C-3: Unguarded `JSON.parse` on tool arguments in `openai.ts`
**File:** `packages/agent/src/providers/openai.ts` — `complete()` method
**Severity:** Critical — Runtime crash

`tc.function.arguments` is a raw string from the OpenAI API. Partial streamed responses or API errors can produce malformed JSON. The unguarded `JSON.parse(tc.function.arguments)` would throw `SyntaxError`, crashing the execution loop.

**Fix applied:** Wrapped in try/catch. On failure, `input` defaults to `{}` and a warning is logged with the tool name. This allows the tool to receive an empty input and return a structured error rather than crashing the agent.

---

### C-4: Dangerously narrow bash blocklist in `tools/bash.ts`
**File:** `packages/agent/src/tools/bash.ts`
**Severity:** Critical — Security

The original pattern `/\brm\s+-rf\s+\/\s*$/` only matched `rm -rf /` at the very end of the string, with a trailing space before `/`. It did NOT block:
- `rm -rf /home/user` (no trailing newline match)
- `rm -rf /*` (wildcard)
- `rm -fr /` (flag order reversed)
- `sudo rm -rf /etc`

**Fix applied:** Replaced with a broader set of patterns that cover:
- `rm -rf /...` and `rm -fr /...` (any flag ordering that includes both `r` and `f`)
- `rm -f /*` and `rm /*` (wildcard glob on root)
- `poweroff` (was missing from system control list)
- Raw device writes via `/dev/nvme*`
- `dd` targeting raw block devices
- `chmod -R 777 /` (world-writable root tree)
- Fork bomb pattern `:(){ :|: & };:`

**Important caveat (warning retained below):** A blocklist is fundamentally insufficient for a capability this dangerous. See W-5.

---

### C-5: `queryAudit` returned raw JSON string instead of deserialized object
**File:** `packages/core/src/audit.ts`
**Severity:** Critical — Type contract violation

`AuditEntry.details` is typed as `Record<string, unknown> | undefined`. The SQLite `details` column stores JSON text. The original `queryAudit` cast the raw rows directly to `AuditEntry[]` without deserializing `details`, so callers received `details` as a raw `string` — a silent type lie that would cause `TypeError` wherever callers tried to access `details.someKey`.

**Fix applied:** Introduced `RawAuditRow` type and `deserializeAuditRows()` helper that parses the `details` JSON string, matching the existing pattern used consistently in `sessions.ts` and `agents.ts`.

---

## Warnings (Address Later)

### W-1: Non-null assertions (`!`) on post-insert reads
**Files:** `core/src/sessions.ts:16`, `core/src/agents.ts:7`

Both `createSession` and `createAgent` call `getSession(id)!` / `getAgent(id)!` after inserting. The `!` assertion silently swallows the case where the read-back returns `null` (e.g., if the INSERT silently failed or a concurrent DELETE raced it). Consider:
```ts
const session = getSession(id);
if (!session) throw new Error(`Failed to read back created session: ${id}`);
return session;
```

---

### W-2: `toolCallId!` non-null assertion in providers
**Files:** `agent/src/providers/anthropic.ts:27,81`, `agent/src/providers/openai.ts:20`

`m.toolCallId!` is used when mapping `tool` role messages. The `toolCallId` field is optional on `ProviderMessage`. If a `tool` role message is ever constructed without a `toolCallId`, this produces `undefined` silently (the `!` just suppresses the TypeScript error, it doesn't throw at runtime — `undefined` is passed to the API). This could cause an API call with a malformed tool result message.

Consider narrowing the type or adding a runtime guard:
```ts
if (!m.toolCallId) throw new Error(`tool message missing toolCallId`);
```

---

### W-3: `listSessions` uses dynamic SQL string concatenation
**File:** `core/src/sessions.ts:48-58`

While the concatenated parts are only literal strings (`" AND agent_id = ?"`, `" AND state = ?"`), and values are properly parameterized, this pattern is a maintenance hazard. A future contributor may accidentally interpolate a variable. Consider building a conditions array and joining with `AND`, or using a query builder. Not a current injection risk.

---

### W-4: `db.ts` pragma interpolation
**File:** `core/src/db.ts:49`

```ts
database.pragma(`user_version = ${version}`);
```

`better-sqlite3`'s `.pragma()` does not support parameterized values. The `Math.trunc` call and the fact that `version` comes from a closed internal array makes this safe. However, a security scanner will flag it. The comment documents the intent; consider adding an explicit `if (!Number.isInteger(version) || version < 0 || version > 9999)` guard for belt-and-suspenders.

---

### W-5: Bash tool blocklist is insufficient as a security boundary
**File:** `agent/src/tools/bash.ts`

The expanded blocklist (from C-4 fix) is better, but a regex-based blocklist is fundamentally bypassable by shell metacharacters, variable expansion, heredocs, command substitution, and encoding tricks. Examples the new list still doesn't block:
- `eval "rm -rf /home"` (eval-wrapped)
- `base64-decoded commands`
- `alias rm='rm -rf /'`

If the bash tool is exposed to untrusted users, a stronger containment strategy (Docker, macOS sandbox, or a user with restricted permissions and a chroot) is required. The blocklist should be considered defense-in-depth only.

---

### W-6: `filesystem.ts` write tool has no path allowlist
**File:** `agent/src/tools/filesystem.ts`

`write_file` accepts any absolute path and creates directories recursively. An agent could write to `/etc/cron.d/`, `~/.ssh/authorized_keys`, or other sensitive locations. Consider an allowlist or at minimum blocking writes outside of a configured workspace directory.

---

### W-7: Static PBKDF2 salt migration
**File:** `packages/core/src/crypto.ts`

Deployments that previously used passphrase-based key derivation (with the old static salt) will derive a different master key after the C-1 fix, because the salt is now randomized per installation. Any existing credentials encrypted with the old static-salt derivation will fail to decrypt.

**Recommendation:** Add a one-time migration that attempts to detect and re-encrypt credentials using the new salt, or document that existing passphrase-mode credentials must be re-entered after upgrade.

---

### W-8: `logger.ts` level is not configurable from `NexusConfig`
**File:** `core/src/logger.ts`

The log level is hardcoded to `"info"` as a default parameter and is never read from config. The `GatewayConfigSchema` has a `verbose: boolean` field, but there is no code that maps `verbose: true` to `level: "debug"`. Consider wiring these up.

---

### W-9: `anthropic.ts` — `tool` role messages map to `"user"` role
**File:** `agent/src/providers/anthropic.ts:24,78`

```ts
m.role === "tool" ? "user" : m.role
```

Anthropic's Messages API uses a specific `tool_result` content block, not a plain `user` message. The content is correctly set as a `tool_result` block when `m.role === "tool"`, so this works, but the outer `role: "user"` is technically correct per Anthropic's API spec (tool results are wrapped in a `user` turn). This is fine but worth a comment for future maintainers who might assume `role: "tool"` would be passed directly.

---

## Final Verdict

**REQUEST_CHANGES — with fixes applied**

Four critical issues have been patched directly in source:
1. `crypto.ts` — static PBKDF2 salt replaced with per-installation random salt
2. `openai.ts` — unguarded `choices[0]` access guarded with explicit null check
3. `openai.ts` — unguarded `JSON.parse` on tool arguments wrapped in try/catch
4. `audit.ts` — `details` JSON column deserialized correctly before returning
5. `tools/bash.ts` — dangerously narrow blocklist regex significantly expanded

The codebase is well-structured overall: no `any` types, no SQL injection (all queries parameterized), consistent naming, all files under 200 LOC, exports align with implementations. The critical issues were all runtime/security bugs, not architectural problems.

**Before push:** Address W-1 (non-null assertions post-insert) and W-7 (passphrase-mode credential migration strategy).
