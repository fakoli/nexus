# 13 -- Rebuild Blueprint: Nexus Architecture Specification

> **Status**: Complete
> **Date**: 2026-03-22
> **Depends On**: All analysis docs (01--10), [-> 12-decision-matrix](12-decision-matrix.md)
> **Purpose**: Final clean-room architecture specification for the Nexus personal AI assistant

---

## Executive Summary

Nexus is a clean-room rebuild of a personal AI assistant, informed by exhaustive analysis of the OpenClaw codebase (~10K files, ~1.16M LOC TypeScript). The rebuild preserves proven patterns -- the channel adapter interface, skills hierarchy, contract testing, and test isolation approach -- while eliminating the structural debt that makes OpenClaw unmaintainable: God Objects (3,212 LOC), uncontrolled external runtime dependency (244 files), triple schema libraries, file-based sessions, unencrypted credentials, and a 30+ export plugin SDK.

**Target metrics:**
- <2,000 source files (vs OpenClaw's 4,419)
- <5 minutes onboarding, <90 seconds for instant setup (vs OpenClaw's 5--15 minutes)
- 12 core modules (vs OpenClaw's 75+ packages)
- 500-LOC hard file limit (vs OpenClaw's 130 files over 700 LOC)
- 1 schema library (vs OpenClaw's 3)
- 3 plugin SDK exports (vs OpenClaw's 30--80+)
- ~16 weeks to MVP (6 phases)

---

## 1. Recommended Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **Language** | TypeScript | 5.x, `strict: true` | Same as OpenClaw. Non-negotiable for type safety. [-> 07-code-quality](07-code-quality.md): TS strict is the strongest quality signal in OpenClaw. |
| **Runtime** | Bun | 1.x | Single binary, built-in SQLite, fast startup, native TS execution. Eliminates Jiti transpilation layer that caused divergence issues. [-> 02-channels-plugins: Plugin Loader](02-channels-plugins.md): Jiti rated 3/5 due to transpilation fragility. |
| **Database** | SQLite (via Bun) | WAL mode | Replaces file-based JSONL sessions. ACID, indexed queries, single-file deployment, concurrent reads. [-> 01-gateway-core: Sessions](01-gateway-core.md) rated 2/5: "File-based storage does not scale." |
| **HTTP Framework** | Hono | 4.x | 14KB, works on Bun/Node/Deno/Cloudflare. Eliminates Express + phantom Hono situation. [-> 07-code-quality](07-code-quality.md): Express used in 7 files, Hono listed but not directly imported. One framework, not two. |
| **Schema Validation** | Zod | 4.x | Single schema library for all boundaries: config, protocol, tools, plugins. Replaces Ajv + TypeBox + Zod overlap. [-> 07-code-quality: Dependency Hygiene](07-code-quality.md): three schema libraries rated 2/5. |
| **Web UI** | SolidJS | 2.x | Fine-grained reactivity (no virtual DOM diffing), JSX ergonomics, 7KB runtime. [-> 04-web-ui](04-web-ui.md): Lit with 150+ @state() rated 2/5. SolidJS replaces with ~15 store slices. |
| **UI Components** | Kobalte | 0.x | Headless accessible components. [-> 04-web-ui](04-web-ui.md): "No component library -- every button, input, card hand-rolled." |
| **UI Styling** | Tailwind CSS | 4.x | Utility-first. [-> 04-web-ui](04-web-ui.md): "No utility framework -- manual CSS everywhere." |
| **Testing** | Vitest | 3.x | Same as OpenClaw. Preserve colocated `*.test.ts` pattern and test isolation approach. [-> 08-testing-infrastructure](08-testing-infrastructure.md) rated 4.5/5. |
| **Linting** | Oxlint + Oxfmt | Latest | Same as OpenClaw. [-> 07-code-quality](07-code-quality.md): "fast, modern, well-configured." |
| **Vector Search** | sqlite-vec | Latest | Same as OpenClaw. Embedded vector search within the SQLite database. No separate vector DB needed. |

### Stack Decisions That Differ from OpenClaw

| OpenClaw | Nexus | Why |
|----------|-------|-----|
| Node.js + Jiti | Bun | Native TS, built-in SQLite, no transpilation layer |
| JSONL file sessions | SQLite WAL | ACID, indexed, concurrent reads, compaction |
| Express (7 files) + Hono (phantom) | Hono only | One framework |
| Ajv + TypeBox + Zod | Zod only | One schema library |
| Lit (Web Components) | SolidJS | Fine-grained reactivity, smaller runtime |
| JSON5 config | TOML config | Standard format with comments, wide tooling support |
| `@mariozechner/pi-*` (external) | Own agent loop | Full control, eliminates 244-file external coupling |
| 75+ pnpm workspace packages | 12 modules in 1 package | Simplified dependency graph |

---

## 2. Module Architecture (12 Modules)

Each module is a directory under `src/` with a barrel `index.ts` export. No module exceeds 500 LOC per file. Dependencies flow downward; circular dependencies are a CI failure.

```
src/
  core/           # 1. Foundation types, errors, logging, config
  db/             # 2. SQLite schema, migrations, query helpers
  gateway/        # 3. WebSocket server, protocol, routing
  auth/           # 4. Authentication, rate limiting, device pairing
  agent/          # 5. Agent loop, streaming, provider abstraction
  tools/          # 6. Tool registry, tool base, 82 tool implementations
  skills/         # 7. Skill loading, 3-tier hierarchy, frontmatter parser
  memory/         # 8. Vector search, embedding, memory CRUD
  channels/       # 9. Channel adapter interface, channel manager
  plugins/        # 10. Plugin SDK, loader, registry, contract testing
  security/       # 11. Sandbox, path safety, prompt guard, allowlists, audit
  ui/             # 12. SolidJS web application
```

### Module Responsibilities

| # | Module | Responsibility | Max Files | Key Patterns |
|---|--------|---------------|-----------|--------------|
| 1 | **core** | Foundation types (`Result<T,E>`, `AppError`), structured logger (`createLogger`), config loading (TOML + env overrides + Zod validation), event bus. | ~30 | Error shape pattern from [-> 07-code-quality](07-code-quality.md). Subsystem logger from OpenClaw's `createSubsystemLogger`. |
| 2 | **db** | SQLite connection (WAL mode), schema definition, migrations, typed query helpers. Single source of truth for all persistence. | ~15 | Replaces file-based JSONL sessions [-> 01-gateway-core](01-gateway-core.md) and in-memory rate limiting [-> 06-security-model](06-security-model.md). |
| 3 | **gateway** | WebSocket server, protocol frame validation (Zod), request/response dispatch, namespace-based handler registration, session resolution, message pump. | ~40 | Thin dispatcher pattern. Handlers factored into per-namespace files (`handlers/sessions.ts`, `handlers/agents.ts`, etc.). Replaces the 1,354-LOC God Object [-> 01-gateway-core](01-gateway-core.md). |
| 4 | **auth** | Token, password, device pairing (V3, JSON payloads), Tailscale, trusted proxy. Rate limiter backed by SQLite (persists across restarts). | ~20 | Timing-safe comparison preserved from OpenClaw. Structured JSON replaces pipe-delimited device auth [-> 06-security-model](06-security-model.md). |
| 5 | **agent** | Own agent loop: session management, multi-attempt retry with auth rotation, provider-agnostic streaming via `StreamProvider` interface, prompt construction, history management, compaction. | ~40 | Decomposed replacement for OpenClaw's `attempt.ts` (3,212 LOC) and `run.ts` (1,719 LOC) [-> 03-agent-runtime](03-agent-runtime.md). Pipeline of 5 stages: session-init, prompt-build, tool-setup, stream-run, cleanup. |
| 6 | **tools** | Tool base interface, tool registry with categorical subdirectories (`tools/code/`, `tools/media/`, `tools/memory/`, `tools/web/`, `tools/session/`, `tools/infra/`), tool instantiation. | ~100 | Port all 82 tools from OpenClaw. Add `ToolBase` interface and registration mechanism [-> 03-agent-runtime: Tool Organization](03-agent-runtime.md). |
| 7 | **skills** | SKILL.md frontmatter parser, 3-tier loading (bundled > managed > workspace), environment variable injection, version tracking. | ~15 | Preserve OpenClaw's 4/5-rated skill system [-> 03-agent-runtime: Skills System](03-agent-runtime.md). Add versioning. |
| 8 | **memory** | Markdown + YAML frontmatter storage (replaces QMD), sqlite-vec vector indexing, embedding pipeline, semantic search, CRUD operations. | ~20 | Decomposed replacement for `qmd-manager.ts` (2,069 LOC) [-> 03-agent-runtime: Memory Subsystem](03-agent-runtime.md). Three sub-modules: format, index, sync. |
| 9 | **channels** | `ChannelPlugin<R, P, A>` interface (preserved as-is), channel manager, routing. | ~15 | Crown jewel interface preserved from OpenClaw [-> 02-channels-plugins](02-channels-plugins.md) rated 5/5. |
| 10 | **plugins** | 3-export SDK (`nexus/plugin-sdk/channel`, `nexus/plugin-sdk/runtime`, `nexus/plugin-sdk/testing`), plugin loader (Bun native import, pre-compiled cache, load timeout + circuit breaker), plugin registry. | ~20 | Replaces 30--80+ export paths [-> 02-channels-plugins: Plugin SDK Surface](02-channels-plugins.md) rated 2/5. |
| 11 | **security** | Encrypted credential store (AES-256-GCM + OS keychain), centralized allowlist enforcement, enforced prompt guard, path safety (multi-pass traversal protection preserved), sandbox (Docker/SSH), audit logger (SQLite). | ~25 | Addresses all five security gaps identified in [-> 06-security-model](06-security-model.md): unencrypted credentials (2/5), advisory-only prompt injection (2/5), per-channel allowlists (3/5), in-memory rate limiting (4/5 but no persistence), no audit trail (3/5). |
| 12 | **ui** | SolidJS application with ~15 store slices, route-based lazy loading, Kobalte headless components, Tailwind CSS, WebSocket gateway client with exponential backoff. | ~80 | Replaces 150+ `@state()` Lit monolith [-> 04-web-ui](04-web-ui.md) rated 2/5. |

### Dependency Graph

```
                    core
                   / | \
                  /  |  \
                db  auth  security
               /|    |      |
              / |    |      |
        gateway |    |      |
           |    |    |      |
           +----+----+------+
           |
         agent
        / | \ \
       /  |  \ \
   tools skills memory channels
       \   |   /    /
        \  |  /    /
        plugins   /
           |     /
           ui --+
```

Arrows point downward (dependency direction). No upward or circular dependencies.

---

## 3. SQLite Schema

All persistent state in a single SQLite database (`~/.nexus/nexus.db`) with WAL mode enabled.

### 3.1 Sessions

Replaces file-based JSONL [-> 01-gateway-core: Sessions](01-gateway-core.md).

```sql
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,          -- UUID
    agent_id        TEXT NOT NULL,
    channel_id      TEXT,                      -- nullable for CLI sessions
    peer_id         TEXT,                      -- channel-specific sender ID
    type            TEXT NOT NULL DEFAULT 'main',  -- 'main' | 'sub' | 'cron'
    status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived' | 'locked'
    model           TEXT,                      -- resolved model ID
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at     TEXT,
    metadata        TEXT                       -- JSON blob for extensible metadata
);

CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_channel_peer ON sessions(channel_id, peer_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

### 3.2 Messages (Transcript)

Replaces JSONL append-only files.

```sql
CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL REFERENCES sessions(id),
    run_id          TEXT NOT NULL,             -- groups messages per agent run
    role            TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'tool'
    content         TEXT NOT NULL,             -- message content (may be JSON for tool results)
    tool_call_id    TEXT,                      -- for tool result messages
    token_count     INTEGER,                   -- cached token count for compaction
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session_run ON messages(session_id, run_id);
CREATE INDEX idx_messages_session_created ON messages(session_id, created_at);
```

### 3.3 Configuration

Replaces JSON5 file-based config [-> 01-gateway-core: Config System](01-gateway-core.md).

```sql
CREATE TABLE config (
    key             TEXT PRIMARY KEY,          -- dot-notation: 'gateway.port', 'agent.default_model'
    value           TEXT NOT NULL,             -- JSON-encoded value
    source          TEXT NOT NULL DEFAULT 'user', -- 'default' | 'user' | 'env' | 'plugin'
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Note: Config is also loadable from `~/.nexus/config.toml` (file takes precedence on startup, written back on change). The SQLite table provides runtime queryability and audit.

### 3.4 Credentials

Replaces plaintext credential storage [-> 06-security-model: Credential Storage](06-security-model.md).

```sql
CREATE TABLE credentials (
    id              TEXT PRIMARY KEY,          -- e.g., 'anthropic:default', 'openai:prod'
    provider        TEXT NOT NULL,
    profile         TEXT NOT NULL DEFAULT 'default',
    encrypted_value TEXT NOT NULL,             -- AES-256-GCM ciphertext (base64)
    iv              TEXT NOT NULL,             -- initialization vector (base64)
    auth_tag        TEXT NOT NULL,             -- GCM auth tag (base64)
    credential_type TEXT NOT NULL,             -- 'api_key' | 'oauth_token' | 'oauth_refresh'
    expires_at      TEXT,                      -- for OAuth tokens
    cooldown_until  TEXT,                      -- rate limit cooldown timestamp
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    rotated_at      TEXT
);

CREATE INDEX idx_credentials_provider ON credentials(provider, profile);
```

Encryption key is stored in the OS keychain (macOS Keychain, Linux secret-tool, Windows Credential Manager). On systems without keychain support, falls back to a key file at `~/.nexus/.key` with 0o600 permissions.

### 3.5 Allowlists

Replaces per-channel allowlist enforcement [-> 06-security-model: DM Pairing](06-security-model.md).

```sql
CREATE TABLE allowlists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id      TEXT NOT NULL,             -- '*' for global
    pattern         TEXT NOT NULL,             -- sender pattern (exact, prefix*, wildcard)
    pattern_type    TEXT NOT NULL DEFAULT 'exact', -- 'exact' | 'prefix' | 'wildcard'
    action          TEXT NOT NULL DEFAULT 'allow', -- 'allow' | 'deny'
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    created_by      TEXT                       -- audit: who added this entry
);

CREATE INDEX idx_allowlists_channel ON allowlists(channel_id);
```

Enforcement order: global deny > channel deny > channel allow > global allow > default deny.

### 3.6 Audit Log

New -- addresses the missing audit trail [-> 06-security-model: Exec Approval](06-security-model.md).

```sql
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    event_type      TEXT NOT NULL,             -- 'auth' | 'exec_approval' | 'config_change' | 'credential_access' | 'channel_event' | 'security'
    actor           TEXT,                      -- device ID, connection ID, or 'system'
    action          TEXT NOT NULL,             -- e.g., 'login_success', 'tool_approved', 'config_set'
    resource        TEXT,                      -- what was acted on
    details         TEXT,                      -- JSON blob with event-specific data
    ip_address      TEXT,
    outcome         TEXT NOT NULL DEFAULT 'success' -- 'success' | 'failure' | 'denied'
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_type ON audit_log(event_type, timestamp);
CREATE INDEX idx_audit_actor ON audit_log(actor, timestamp);
```

### 3.7 Rate Limiting

Replaces in-memory rate limiter [-> 06-security-model: Auth System](06-security-model.md).

```sql
CREATE TABLE rate_limits (
    key             TEXT PRIMARY KEY,          -- e.g., 'auth:192.168.1.1', 'api:device-xyz'
    attempts        INTEGER NOT NULL DEFAULT 0,
    window_start    TEXT NOT NULL DEFAULT (datetime('now')),
    locked_until    TEXT                       -- lockout expiry
);
```

### 3.8 Cron Jobs

```sql
CREATE TABLE cron_jobs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,             -- cron expression, 'at:...', or 'every:...'
    timezone        TEXT DEFAULT 'UTC',
    agent_id        TEXT NOT NULL,
    session_target  TEXT NOT NULL DEFAULT 'isolated',
    delivery_mode   TEXT NOT NULL DEFAULT 'none', -- 'none' | 'announce' | 'webhook'
    delivery_target TEXT,                      -- channel ID or webhook URL
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run_at     TEXT,
    next_run_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cron_run_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT NOT NULL REFERENCES cron_jobs(id),
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    status          TEXT NOT NULL,             -- 'running' | 'success' | 'failure' | 'timeout'
    session_id      TEXT,
    error           TEXT
);
```

### 3.9 Memory (Vector Search)

```sql
CREATE TABLE memory_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content         TEXT NOT NULL,             -- Markdown with YAML frontmatter
    embedding       BLOB,                     -- sqlite-vec vector (via virtual table)
    source          TEXT,                      -- 'user' | 'agent' | 'skill'
    tags            TEXT,                      -- JSON array of tags
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sqlite-vec virtual table for vector similarity search
CREATE VIRTUAL TABLE memory_vectors USING vec0(
    entry_id INTEGER PRIMARY KEY,
    embedding float[1536]                     -- dimension matches embedding model
);
```

### 3.10 Plugins

```sql
CREATE TABLE plugins (
    id              TEXT PRIMARY KEY,          -- extension ID
    type            TEXT NOT NULL,             -- 'channel' | 'provider' | 'capability'
    version         TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    config          TEXT,                      -- JSON blob for plugin-specific config
    installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 4. Message Data Flow

```
                         INBOUND
                           |
                           v
  +--------------------------------------------------+
  |  1. GATEWAY (WebSocket / HTTP)                    |
  |     - Validate frame (Zod schema)                 |
  |     - Authenticate sender (auth module)           |
  |     - Rate limit check (db: rate_limits)          |
  +--------------------------------------------------+
                           |
                           v
  +--------------------------------------------------+
  |  2. CHANNEL RESOLUTION                            |
  |     - Identify source channel + peer              |
  |     - Check allowlist (db: allowlists)            |
  |     - Resolve or create session (db: sessions)    |
  +--------------------------------------------------+
                           |
                           v
  +--------------------------------------------------+
  |  3. MESSAGE PUMP (enqueue)                        |
  |     - Persist inbound message (db: messages)      |
  |     - Audit log entry (db: audit_log)             |
  |     - Check session lock (db: sessions.status)    |
  |     - Acquire lock -> set status = 'locked'       |
  +--------------------------------------------------+
                           |
                           v
  +--------------------------------------------------+
  |  4. AGENT PIPELINE                                |
  |     a. Session Init                               |
  |        - Load history (db: messages, with limit)  |
  |        - Compact if over token budget             |
  |     b. Prompt Build                               |
  |        - System prompt + skills (skills module)   |
  |        - Context injection (memory module)         |
  |        - Tool declarations (tools module)         |
  |     c. Stream Run                                 |
  |        - Select provider + auth profile           |
  |          (db: credentials, with rotation)         |
  |        - Stream request via StreamProvider        |
  |        - Process tool calls (tool registry)       |
  |        - Prompt guard check (security module)     |
  |     d. Cleanup                                    |
  |        - Persist assistant message (db: messages) |
  |        - Update memory if warranted (db: memory)  |
  |        - Release session lock                     |
  |        - Audit log entry                          |
  +--------------------------------------------------+
                           |
                           v
  +--------------------------------------------------+
  |  5. OUTBOUND ROUTING                              |
  |     - Resolve target channel plugin               |
  |     - Format response for channel                 |
  |     - Deliver via channel adapter                 |
  |     - Persist outbound message (db: messages)     |
  +--------------------------------------------------+
                           |
                           v
                        OUTBOUND
```

### Key Differences from OpenClaw

| Step | OpenClaw | Nexus |
|------|----------|-------|
| Frame validation | AJV schema (separate from config validation) | Zod (same library as config, tools, plugins) |
| Rate limiting | In-memory Map (lost on restart) | SQLite table (persistent) |
| Session resolution | Filesystem directory lookup | SQLite indexed query |
| Message persistence | JSONL append to file | SQLite INSERT with transaction |
| History loading | Linear JSONL file scan | SQLite indexed SELECT with LIMIT |
| Compaction | Inline in 3,212-LOC attempt.ts | Separate `history-manager.ts` module |
| Credential lookup | Plaintext config file | Encrypted SQLite row + keychain |
| Audit | None | SQLite audit_log table at every boundary |
| Prompt guard | Advisory logging only | Enforced block/warn/allow per policy |

---

## 5. Plugin SDK Design

### Problem

OpenClaw's plugin SDK exposes 30+ (reports vary up to 80+) import paths, creating a wide coupling surface that is difficult to version, discover, or deprecate. [-> 02-channels-plugins: Plugin SDK Surface](02-channels-plugins.md) rated 2/5.

### Solution: 3 Exports

```typescript
// 1. Channel plugin definition
import { defineChannel, type ChannelPlugin } from 'nexus/plugin-sdk/channel';

// 2. Runtime services (injected, not imported)
import { type PluginRuntime } from 'nexus/plugin-sdk/runtime';

// 3. Contract testing utilities
import { createChannelTestSuite } from 'nexus/plugin-sdk/testing';
```

That is the entire public surface. Three imports, three concerns.

### Channel Definition

```typescript
// nexus/plugin-sdk/channel
import { defineChannel } from 'nexus/plugin-sdk/channel';
import { z } from 'zod';

export default defineChannel({
  id: 'telegram',
  name: 'Telegram',
  version: '1.0.0',

  // Config schema (Zod) -- validated at load time
  configSchema: z.object({
    botToken: z.string(),
    allowedChatIds: z.array(z.string()).optional(),
  }),

  // Required capabilities -- validated before activation
  requires: ['messaging', 'outbound'],

  // Optional adapters (same pattern as OpenClaw's ChannelPlugin<R,P,A>)
  adapters: {
    lifecycle: { setup, teardown },
    messaging: { onMessage, sendMessage },
    threading: { onThread, sendThread },
    status: { getStatus },
    security: { checkAllowlist },
    // ... all adapters optional, type-safe via generics
  },
});
```

### Runtime Services (Dependency Injection)

```typescript
// Injected into adapter methods, not imported globally
interface PluginRuntime {
  // Core
  config: PluginConfig;
  logger: Logger;
  db: PluginDB;          // scoped database access

  // Capabilities (lazy, typed)
  media?: MediaService;
  tts?: TTSService;
  stt?: STTService;
  events: EventBus;
  state: StateStore;     // plugin-scoped key-value
}
```

Capabilities are declared in `requires` and validated at load time. If a plugin declares `requires: ['tts']` and TTS is not available, the loader rejects activation with a clear error. This addresses the opaque lazy-injection failure mode identified in [-> 02-channels-plugins](02-channels-plugins.md).

### Contract Testing

```typescript
// nexus/plugin-sdk/testing
import { createChannelTestSuite } from 'nexus/plugin-sdk/testing';
import telegramPlugin from './index';

createChannelTestSuite(telegramPlugin, {
  // Test fixtures
  mockConfig: { botToken: 'test-token' },
  mockMessage: { text: 'hello', senderId: 'user-123' },

  // Which adapter contracts to validate
  contracts: ['messaging', 'threading', 'status'],

  // NEW: Runtime injection failure tests (missing in OpenClaw)
  failureModes: ['media-unavailable', 'tts-unavailable'],
});
```

### Migration Path from OpenClaw Extensions

OpenClaw's 77 extensions can be ported incrementally:

1. **Backward compatibility shim**: A `nexus/plugin-sdk/compat` module (not part of the 3 public exports -- internal only) maps OpenClaw's `defineChannelPluginEntry()` to Nexus's `defineChannel()`.
2. **Gradual migration**: Extensions are ported one at a time, starting with the 5 core channels (Telegram, Discord, Slack, WhatsApp, web).
3. **Deprecation**: Once all extensions are ported, the compat shim is removed.

---

## 6. Security Architecture

### 6.1 Encrypted Credentials

```
                   +------------------+
                   |  OS Keychain     |
                   |  (master key)    |
                   +--------+---------+
                            |
                            v
                   +------------------+
                   |  Key Derivation  |
                   |  (HKDF-SHA256)   |
                   +--------+---------+
                            |
              +-------------+-------------+
              |                           |
              v                           v
    +------------------+        +------------------+
    |  Encrypt (write) |        |  Decrypt (read)  |
    |  AES-256-GCM     |        |  AES-256-GCM     |
    +--------+---------+        +--------+---------+
             |                           ^
             v                           |
    +------------------+        +------------------+
    |  SQLite table:   |------->|  SQLite table:   |
    |  credentials     |        |  credentials     |
    |  (ciphertext,    |        |  (ciphertext,    |
    |   iv, auth_tag)  |        |   iv, auth_tag)  |
    +------------------+        +------------------+
```

**Key management:**
- Master key generated on first run, stored in OS keychain.
- Per-credential keys derived via HKDF-SHA256 with credential ID as info parameter.
- Fallback for keychain-less systems: `~/.nexus/.key` file with 0o600 permissions (same as OpenClaw's current approach, but only for the master key, not plaintext credentials).

**Rotation:**
- Credentials can be rotated at runtime via `nexus secrets rotate <provider>`.
- No restart required -- the encrypted value is updated in SQLite and the agent picks up the new credential on the next attempt.

### 6.2 Centralized Allowlists

```
Inbound message
       |
       v
  Gateway receives
       |
       v
  +----------------------------+
  |  Allowlist Check           |
  |  (centralized, gateway     |
  |   level -- not per-channel)|
  |                            |
  |  1. Check global deny      |
  |  2. Check channel deny     |
  |  3. Check channel allow    |
  |  4. Check global allow     |
  |  5. Default: DENY          |
  +----------------------------+
       |
       v
  [allowed] --> Channel resolution --> Agent pipeline
  [denied]  --> Log + audit entry --> Drop
```

Single enforcement point at the gateway, replacing OpenClaw's per-channel scattered enforcement [-> 06-security-model: DM Pairing](06-security-model.md). Per-channel overrides are still supported via the `channel_id` column in the `allowlists` table.

### 6.3 Enforced Prompt Guard

```
Agent pipeline -> Prompt Guard (before sending to LLM)
                       |
              +--------+--------+
              |        |        |
              v        v        v
           [BLOCK]  [WARN]   [ALLOW]
              |        |        |
              v        v        v
         Reject    Log +     Pass
         message   audit +   through
         + audit   continue
```

**Detection patterns** (carried over from OpenClaw):
- 12+ suspicious prompt injection patterns
- Unicode homoglyph folding
- External content wrapping with unique random boundaries

**New enforcement** (not in OpenClaw):
- Configurable severity per pattern: `block`, `warn`, `allow`
- Global override: `security.prompt_guard.mode = 'enforce' | 'audit' | 'off'`
- Escape hatch: trusted content sources can be allowlisted
- All decisions logged to `audit_log` table

### 6.4 Audit Trail

Every security-relevant operation writes to the `audit_log` SQLite table:

| Event Type | Triggers |
|-----------|----------|
| `auth` | Login success/failure, device pairing, token refresh |
| `exec_approval` | Tool execution approved/denied/timed-out |
| `config_change` | Any config key modification |
| `credential_access` | Credential decrypt (read), rotate, create, delete |
| `channel_event` | Allowlist check pass/fail, DM pairing |
| `security` | Prompt guard trigger, sandbox violation, path traversal attempt |

Retention: configurable, default 90 days. `nexus security audit` CLI command for querying.

### 6.5 Preserved from OpenClaw

These security patterns scored 4/5 in [-> 06-security-model](06-security-model.md) and are carried over unchanged:

- **Timing-safe secret comparison** via SHA256 hashing
- **Multi-pass path traversal protection** with symlink resolution and loop detection
- **Multi-pass URL decoding** with 32-pass limit and fail-closed on malformed encoding
- **DM pairing** with 8-char codes (34^8 combinations), 1-hour TTL, max 3 pending
- **Sandbox** with Docker/SSH backends, mount-based access control, image pinning
- **Single-operator trust model** -- simple, well-reasoned, no premature multi-tenancy

---

## 7. Implementation Phases

### Phase 1: Foundation (Weeks 1--3)

**Goal:** Core infrastructure -- everything needed before any feature code.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| Project scaffold (Bun, TypeScript strict, Vitest, Oxlint) | -- | [-> 07-code-quality](07-code-quality.md), [-> 08-testing-infrastructure](08-testing-infrastructure.md) |
| Core module: Result type, AppError, structured logger, event bus | core | [-> 07-code-quality: Error Handling](07-code-quality.md) |
| SQLite schema + migrations (all tables from Section 3) | db | [-> 01-gateway-core: Sessions](01-gateway-core.md) |
| Config loading: TOML file + env overrides + Zod validation | core | [-> 01-gateway-core: Config System](01-gateway-core.md) |
| Encrypted credential store + OS keychain integration | security | [-> 06-security-model: Credential Storage](06-security-model.md) |
| Auth module: token + password + device pairing (V3, JSON) | auth | [-> 06-security-model: Auth System](06-security-model.md) |
| Rate limiter backed by SQLite | auth, db | [-> 06-security-model: Auth System](06-security-model.md) |
| Audit log module | security, db | [-> 06-security-model: Exec Approval](06-security-model.md) |

**Exit criteria:** `nexus init` creates config, initializes DB, stores encrypted API key, starts listening on WebSocket with auth.

---

### Phase 2: Agent Core (Weeks 4--6)

**Goal:** A working agent that can receive a message, call an LLM, and respond.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| StreamProvider interface + Anthropic + OpenAI providers | agent | [-> 03-agent-runtime: Provider Abstraction](03-agent-runtime.md) |
| Own agent loop: session-init, prompt-build, stream-run, cleanup | agent | [-> 03-agent-runtime: Attempt Logic](03-agent-runtime.md) |
| Multi-attempt retry with auth rotation + exponential backoff | agent | [-> 03-agent-runtime: Agent Execution Flow](03-agent-runtime.md) |
| Session management (create, lock, archive) via SQLite | agent, db | [-> 01-gateway-core: Sessions](01-gateway-core.md) |
| Message persistence (transcript) via SQLite | agent, db | [-> 01-gateway-core: Sessions](01-gateway-core.md) |
| History limiting + compaction (separate module, not inline) | agent | [-> 03-agent-runtime: Attempt Logic](03-agent-runtime.md) |
| Gateway message routing: inbound -> agent -> outbound | gateway | [-> 01-gateway-core: Routing](01-gateway-core.md) |
| Prompt guard (enforced) | security | [-> 06-security-model: Prompt Injection Defense](06-security-model.md) |

**Exit criteria:** Send a message via WebSocket, receive a streamed LLM response. Transcript persisted in SQLite. Auth rotation works on rate limit.

---

### Phase 3: Tools & Skills (Weeks 7--9)

**Goal:** The agent can use tools and skills.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| ToolBase interface + tool registry | tools | [-> 03-agent-runtime: Tool Organization](03-agent-runtime.md) |
| Port core tools: web_fetch, web_search, memory, cron, browser, message, sessions_send, image, canvas | tools | [-> 09-feature-inventory: Agent Tools](09-feature-inventory.md) |
| Categorized tool directories | tools | [-> 03-agent-runtime: Tool Organization](03-agent-runtime.md) |
| Skills loading: 3-tier hierarchy, frontmatter parser | skills | [-> 03-agent-runtime: Skills System](03-agent-runtime.md) |
| Memory module: Markdown storage + sqlite-vec search | memory | [-> 03-agent-runtime: Memory Subsystem](03-agent-runtime.md) |
| Exec approval system with persistent audit | security | [-> 06-security-model: Exec Approval](06-security-model.md) |
| Sandbox: path safety, Docker backend | security | [-> 06-security-model: Sandbox](06-security-model.md) |

**Exit criteria:** Agent can call tools (web search, memory, code exec), load skills, and persist memories. Exec approvals are logged.

---

### Phase 4: Channels & Plugins (Weeks 10--12)

**Goal:** Multi-channel messaging works.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| ChannelPlugin<R, P, A> interface (preserved from OpenClaw) | channels | [-> 02-channels-plugins: Channel Adapter Pattern](02-channels-plugins.md) |
| Plugin SDK: 3 exports (channel, runtime, testing) | plugins | [-> 02-channels-plugins: Plugin SDK Surface](02-channels-plugins.md) |
| Plugin loader: Bun native import, pre-compiled cache, timeout, circuit breaker | plugins | [-> 02-channels-plugins: Plugin Loader](02-channels-plugins.md) |
| Contract test framework | plugins | [-> 02-channels-plugins: Contract Testing](02-channels-plugins.md) |
| Core channels: Telegram, Discord, Slack, WhatsApp, web | channels | [-> 09-feature-inventory: Messaging Channels](09-feature-inventory.md) |
| Centralized allowlist enforcement | security | [-> 06-security-model: DM Pairing](06-security-model.md) |
| DM pairing flow | auth | [-> 06-security-model: DM Pairing](06-security-model.md) |
| Cron scheduler | agent, db | [-> 09-feature-inventory: Cron](09-feature-inventory.md) |

**Exit criteria:** Send a Telegram message, receive agent response. Allowlist enforced at gateway level. Plugin contract tests pass for all 5 core channels.

---

### Phase 5: Web UI (Weeks 13--14)

**Goal:** Full web dashboard.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| SolidJS app scaffold with Kobalte + Tailwind | ui | [-> 04-web-ui](04-web-ui.md) |
| ~15 store slices (replacing 150+ @state()) | ui | [-> 04-web-ui: App Architecture](04-web-ui.md) |
| WebSocket gateway client with exponential backoff | ui | [-> 04-web-ui: Gateway Connection](04-web-ui.md) |
| Chat view with message rendering, tool cards | ui | [-> 04-web-ui: Chat System](04-web-ui.md) |
| Session management view | ui | [-> 04-web-ui](04-web-ui.md) |
| Config view | ui | [-> 04-web-ui](04-web-ui.md) |
| Dark theme with CSS variable system | ui | [-> 04-web-ui: Styling](04-web-ui.md) |

**Exit criteria:** Fully functional web dashboard: chat, sessions, config, cron, logs. Mobile-responsive.

---

### Phase 6: Platform & Polish (Weeks 15--16)

**Goal:** Production readiness, remaining tools, documentation.

| Deliverable | Module | Evidence Base |
|-------------|--------|---------------|
| Port remaining tools (82 total) | tools | [-> 09-feature-inventory: Agent Tools](09-feature-inventory.md) |
| Additional providers (Google, OpenRouter, Ollama) | agent | [-> 09-feature-inventory: AI/LLM Providers](09-feature-inventory.md) |
| CLI ergonomics: ~15 primary commands, grouped help, shell completion | core | [-> 10-ux-analysis: CLI Ergonomics](10-ux-analysis.md) |
| Doctor: quick mode (6 checks) + full mode | core | [-> 10-ux-analysis: Doctor Diagnostics](10-ux-analysis.md) |
| CI pipeline: Linux + macOS, scope detection, 3 Vitest configs | -- | [-> 08-testing-infrastructure: CI/CD Pipeline](08-testing-infrastructure.md) |
| Documentation: 3 start pages, progressive disclosure | -- | [-> 10-ux-analysis: Documentation](10-ux-analysis.md) |
| Backward compatibility shim for OpenClaw extensions | plugins | [-> 02-channels-plugins: Migration Risk](02-channels-plugins.md) |
| Protocol codegen for Swift (preserve) + Kotlin (new) | -- | [-> 05-native-apps: Protocol Duplication](05-native-apps.md) |

**Exit criteria:** All 82 tools ported. CI green. <5 minute onboarding verified. <2,000 files verified. 12 modules verified.

---

## 8. Target Metrics Summary

| Metric | OpenClaw (Current) | Nexus (Target) | Evidence |
|--------|-------------------|----------------|----------|
| Source files | 4,419 | <2,000 | [-> 07-code-quality](07-code-quality.md) |
| Onboarding time (instant) | 3--4 min | <90 sec | [-> 10-ux-analysis](10-ux-analysis.md) |
| Onboarding time (full) | 10--15 min | <5 min | [-> 10-ux-analysis](10-ux-analysis.md) |
| Core modules | 75+ packages | 12 | [-> 01-gateway-core](01-gateway-core.md) |
| Max file LOC | 3,212 | 500 | [-> 03-agent-runtime](03-agent-runtime.md) |
| Schema libraries | 3 (Ajv, TypeBox, Zod) | 1 (Zod) | [-> 07-code-quality](07-code-quality.md) |
| Web frameworks | 2 (Express, Hono) | 1 (Hono) | [-> 07-code-quality](07-code-quality.md) |
| Plugin SDK exports | 30--80+ | 3 | [-> 02-channels-plugins](02-channels-plugins.md) |
| Config keys (primary) | 1,494 | ~200 | [-> 10-ux-analysis](10-ux-analysis.md) |
| CLI commands (primary) | 45 | ~15 | [-> 10-ux-analysis](10-ux-analysis.md) |
| Doctor modules (quick) | 27 (all, always) | 6 quick + 21 full | [-> 10-ux-analysis](10-ux-analysis.md) |
| Credential encryption | None (plaintext) | AES-256-GCM | [-> 06-security-model](06-security-model.md) |
| Prompt guard | Advisory only | Enforced | [-> 06-security-model](06-security-model.md) |
| Audit trail | None | SQLite persistent | [-> 06-security-model](06-security-model.md) |
| Rate limiter persistence | In-memory | SQLite | [-> 06-security-model](06-security-model.md) |
| Session storage | File-based JSONL | SQLite WAL | [-> 01-gateway-core](01-gateway-core.md) |
| External agent dependency | 244 files (`pi-*`) | 0 (own loop) | [-> 03-agent-runtime](03-agent-runtime.md) |
| Vitest configs | 9 | 3 | [-> 08-testing-infrastructure](08-testing-infrastructure.md) |
| Implementation time | Years of evolution | ~16 weeks to MVP | -- |

---

## 9. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Own agent loop is harder than expected** | Medium | High | Start with the simplest viable loop (single-turn, no subagents). Expand incrementally. OpenClaw's retry/rotation semantics are well-documented and can be ported as behavioral specs. |
| **SQLite performance at scale** | Low | Medium | WAL mode handles concurrent reads. Archival/compaction for old sessions. Benchmark with 10K sessions / 1M messages early in Phase 2. |
| **Plugin backward compatibility breaks** | Medium | Medium | The compat shim in Phase 6 provides a bridge. Core channel plugins are written natively; only long-tail extensions need the shim. |
| **Bun runtime edge cases** | Low | Medium | Bun 1.x is production-stable. Fallback: Hono and Zod both work on Node.js. The only Bun-specific feature is built-in SQLite (replaceable with better-sqlite3). |
| **Platform coverage gap** | High | Low | Intentionally accepted. API-first design means native apps can be built later without core changes. Web PWA covers the gap initially. |
| **Feature parity takes longer than 16 weeks** | Medium | Medium | Phase 6 is intentionally scoped as "port remaining." The MVP at end of Phase 5 (week 14) is a fully functional product with 5 channels, core tools, and web UI. Remaining tools are incremental. |

---

**Depends on:** All analysis docs (01--10), [-> 12-decision-matrix](12-decision-matrix.md)
**This is the final document in the analysis series.**
