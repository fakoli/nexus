# Nexus Gateway API Reference

The Nexus gateway exposes a WebSocket RPC API at `ws://<host>:<port>/ws` and an HTTP API for health and status checks.

---

## Connection Protocol

### 1. Open WebSocket

```
ws://localhost:18789/ws
```

### 2. Send `ConnectParams` (first message, client → server)

```json
{
  "token": "optional-bearer-token",
  "password": "optional-password",
  "deviceToken": "optional-device-token",
  "client": {
    "name": "my-client",
    "version": "1.0.0",
    "platform": "node"
  }
}
```

All fields are optional. If `security.gatewayToken` or `security.gatewayPassword` is set in config, the corresponding field is required.

### 3. Receive `HelloOk` (server → client, on success)

```json
{
  "proto": 1,
  "server": { "name": "nexus-gateway", "version": "0.1.0" },
  "session": { "id": "<uuid>", "agentId": "default" }
}
```

On auth failure, the server sends a `ResponseFrame` with `ok: false` and closes the connection with code 4401.

### 4. Send `RequestFrame` (client → server, RPC call)

```json
{
  "id": "unique-request-id",
  "method": "chat.send",
  "params": { }
}
```

The `id` field is echoed back in the `ResponseFrame`.

### 5. Receive `ResponseFrame` (server → client, RPC reply)

```json
{
  "id": "unique-request-id",
  "ok": true,
  "payload": { }
}
```

On error:

```json
{
  "id": "unique-request-id",
  "ok": false,
  "error": { "code": "ERROR_CODE", "message": "Human-readable description" }
}
```

### 6. Receive `EventFrame` (server → client, broadcast)

```json
{
  "event": "session:created",
  "payload": { },
  "seq": 42
}
```

`seq` is a monotonically increasing integer. Gaps indicate missed events (e.g. the client was not authenticated yet).

---

## RPC Methods

### `chat.send`

Append a message to a session's history.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Target session ID |
| `content` | string | yes | Message content (min 1 character) |
| `role` | string | no | One of `user`, `assistant`, `tool_use`, `tool_result`, `system`. Default: `user` |
| `metadata` | object | no | Arbitrary key-value metadata |

**Response payload:**

```json
{ "messageId": "<uuid>", "sessionId": "<uuid>" }
```

---

### `chat.history`

Retrieve message history for a session.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Target session ID |
| `limit` | integer | no | Max messages to return (1–500, default 100) |
| `offset` | integer | no | Pagination offset (default 0) |

**Response payload:**

```json
{
  "messages": [ { "id": "...", "role": "user", "content": "...", "createdAt": 1234567890, "metadata": {} } ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

---

### `sessions.list`

List sessions with optional filters.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | no | Filter by agent ID |
| `state` | string | no | One of `active`, `archived`, `deleted` |

**Response payload:**

```json
{ "sessions": [ { "id": "...", "agentId": "default", "channel": null, "state": "active", "createdAt": 1234567890 } ] }
```

---

### `sessions.create`

Create a new session.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | no | Agent to assign (default: `"default"`) |
| `channel` | string | no | Channel identifier (e.g. `"telegram"`, `"discord"`) |
| `peerId` | string | no | External peer ID (e.g. Telegram chat ID) |
| `sessionId` | string | no | Requested session UUID (auto-generated if omitted) |

**Response payload:**

```json
{ "session": { "id": "...", "agentId": "default", "channel": null, "peerId": null, "state": "active" } }
```

---

### `config.get`

Read the current configuration.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `section` | string | no | One of `gateway`, `agent`, `security`. Returns full config if omitted. |

**Response payload (with section):**

```json
{ "section": "agent", "value": { "defaultProvider": "anthropic", "defaultModel": "claude-sonnet-4-6", "thinkLevel": "low" } }
```

**Response payload (no section):**

```json
{ "config": { "gateway": { ... }, "agent": { ... }, "security": { "dmPolicy": "pairing", "promptGuard": "enforce" } } }
```

Note: `gatewayToken` and `gatewayPassword` are always returned as `"[REDACTED]"`.

---

### `config.set`

Update a configuration section.

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `section` | string | yes | One of `gateway`, `agent`, `security` |
| `value` | object | yes | Partial or full section object (merged with defaults) |

**Response payload:**

```json
{ "section": "agent", "value": { "defaultProvider": "openai", "defaultModel": "gpt-4o", "thinkLevel": "low" } }
```

---

### `agent.run`

Run an agent turn: send a user message and receive the AI response (blocking until the agent finishes all tool calls).

**Params:**

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Session to run the agent in |
| `message` | string | yes | User message (min 1 character) |
| `provider` | string | no | Override provider for this turn (e.g. `"openai"`) |
| `model` | string | no | Override model for this turn (e.g. `"gpt-4o"`) |

**Response payload:**

```json
{
  "content": "The final assistant message text",
  "messageId": "<uuid>",
  "toolCallCount": 2,
  "usage": { "inputTokens": 1024, "outputTokens": 256 }
}
```

---

## Server-Push Events

The gateway broadcasts these `EventFrame` events to all authenticated clients:

| Event | Payload | Description |
|---|---|---|
| `session:created` | `{ id, agentId, channel, peerId }` | A new session was created |
| `session:message` | `{ sessionId, messageId, role }` | A message was appended to a session |
| `config:changed` | `{ key, value }` | A config key was updated |

---

## HTTP Endpoints

### `GET /healthz`

Liveness probe. Returns `{ "ok": true }` with HTTP 200.

### `GET /api/status`

Server status.

```json
{
  "server": "nexus-gateway",
  "version": "0.1.0",
  "proto": 1,
  "clients": 3,
  "uptime": 12345.67
}
```

### `GET /ui/`

Serves the built SolidJS web UI (SPA). Falls back to `index.html` for unknown paths to support client-side routing.

### `GET /`

Redirects to `/ui/`.

---

## Error Codes

| Code | Description |
|---|---|
| `PARSE_ERROR` | The message body is not valid JSON |
| `INVALID_CONNECT` | The first message does not match `ConnectParams` schema |
| `AUTH_FAILED` | Credentials are missing or incorrect |
| `INVALID_FRAME` | A request message does not match `RequestFrame` schema |
| `METHOD_NOT_FOUND` | The requested RPC method does not exist |
| `INVALID_PARAMS` | Params do not match the method's schema |
| `INVALID_CONFIG` | Config value does not match the section schema |
| `SESSION_NOT_FOUND` | The specified session ID does not exist |
| `AGENT_ERROR` | The agent runtime threw an error |
| `INTERNAL_ERROR` | Unexpected server error |
