# Configuration Reference

Nexus configuration is stored in a local SQLite database at `~/.nexus/nexus.db` (or the path set by `NEXUS_DB_PATH`). It is divided into three sections: `gateway`, `agent`, and `security`.

---

## Managing Configuration

```bash
# Read a section
nexus config get gateway
nexus config get agent
nexus config get security

# Read all sections at once
nexus config get

# Write a section (JSON object — keys are merged with defaults)
nexus config set gateway '{"port": 19000, "bind": "lan"}'
nexus config set agent '{"defaultProvider": "openai", "defaultModel": "gpt-4o"}'
nexus config set security '{"gatewayToken": "my-secret-token"}'
```

You can also set config via the `config.set` RPC method over WebSocket (see [api-reference.md](api-reference.md)).

---

## Environment Variables

These environment variables are read at startup and are never written to the database:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for the Anthropic provider |
| `OPENAI_API_KEY` | API key for the OpenAI provider |
| `NEXUS_DB_PATH` | Override the SQLite database file path |
| `NEXUS_MASTER_KEY` | Master encryption key (hex string or path to key file) |
| `NEXUS_UI_DIST` | Override the path to the built UI dist directory |

---

## `gateway` Section

Controls the HTTP/WebSocket server.

| Key | Type | Default | Description |
|---|---|---|---|
| `port` | number | `18789` | TCP port the server binds to |
| `bind` | `"loopback"` \| `"lan"` \| `"all"` | `"loopback"` | Network interface: `loopback` = 127.0.0.1 only; `lan` = local network; `all` = 0.0.0.0 |
| `verbose` | boolean | `false` | Log every HTTP request and WebSocket message |

**Example:**

```bash
nexus config set gateway '{"port": 18789, "bind": "loopback", "verbose": false}'
```

---

## `agent` Section

Controls the AI execution layer.

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultProvider` | string | `"anthropic"` | Provider to use when none is specified per-request. Supported: `"anthropic"`, `"openai"` |
| `defaultModel` | string | `"claude-sonnet-4-6"` | Model identifier passed to the provider. Must be valid for `defaultProvider` |
| `workspace` | string | — | Absolute path the agent is allowed to read/write. If unset, filesystem tools are unrestricted |
| `thinkLevel` | `"off"` \| `"low"` \| `"medium"` \| `"high"` | `"low"` | Extended thinking budget: `off` disables it; `high` allows the model maximum thinking tokens |

**Example:**

```bash
nexus config set agent '{"defaultProvider": "openai", "defaultModel": "gpt-4o", "workspace": "/home/user/projects", "thinkLevel": "medium"}'
```

---

## `security` Section

Controls authentication and access policy.

| Key | Type | Default | Description |
|---|---|---|---|
| `gatewayToken` | string | — | If set, WebSocket clients must send this value in the `token` field of `ConnectParams` |
| `gatewayPassword` | string | — | Password-based auth fallback. If set alongside `gatewayToken`, either is accepted |
| `dmPolicy` | `"pairing"` \| `"open"` \| `"deny"` | `"pairing"` | How channel adapters (Telegram, Discord) authenticate: `pairing` = require device pairing; `open` = allow any; `deny` = block all DM channels |
| `promptGuard` | `"enforce"` \| `"warn"` \| `"off"` | `"enforce"` | Prompt injection detection: `enforce` = reject suspicious prompts; `warn` = log but continue; `off` = disabled |

> Note: `gatewayToken` and `gatewayPassword` are never returned over the wire — `config.get` always returns `"[REDACTED]"` for those fields.

**Example:**

```bash
# Set a bearer token
nexus config set security '{"gatewayToken": "my-secret-token"}'

# Open DMs for all channels (development only)
nexus config set security '{"dmPolicy": "open"}'
```

---

## Default Configuration Object

When no configuration has been set, Nexus uses these defaults:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "verbose": false
  },
  "agent": {
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-6",
    "thinkLevel": "low"
  },
  "security": {
    "dmPolicy": "pairing",
    "promptGuard": "enforce"
  }
}
```

---

## Config Storage Details

- Config is stored in the `config` table with columns `key` (TEXT PRIMARY KEY), `value` (JSON text), and `updated_at` (Unix timestamp).
- Each top-level section (`gateway`, `agent`, `security`) is stored as a single row with its JSON object as the value.
- Plugin config is stored under `plugins.installed` and `plugins.registries` (managed by `nexus plugins` commands).
- The `getAllConfig()` function in `@nexus/core` always validates the full config against `NexusConfigSchema` using Zod, filling in defaults for any missing fields.
