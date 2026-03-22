# Channel Integrations

Nexus supports two chat platform integrations: Telegram and Discord. Both are implemented as independent workspace packages in `extensions/` and connect to a running Nexus gateway over WebSocket.

---

## How Channel Adapters Work

Each adapter:

1. Connects to the Nexus gateway at `ws://localhost:<port>/ws`.
2. Sends `ConnectParams` with a device token (or token/password if configured).
3. Receives `HelloOk` with a session ID.
4. Listens for messages from the external platform.
5. Forwards each message as an `agent.run` RPC call.
6. Sends the response text back to the platform.

For multi-user platforms, each user's conversation gets its own Nexus session (identified by `peerId`).

---

## Telegram

### Prerequisites

1. Create a bot with [@BotFather](https://t.me/BotFather) and obtain the bot token.
2. Ensure the Nexus gateway is running.

### Installation

The `@nexus/telegram` package is included in the monorepo. No separate install is needed.

### Configuration

Set the following environment variables before starting the adapter:

```bash
export TELEGRAM_BOT_TOKEN=1234567890:ABCDefghIJKlmnoPQRstuvwXYZ
export NEXUS_GATEWAY_URL=ws://localhost:18789/ws
export NEXUS_GATEWAY_TOKEN=my-secret-token   # if security.gatewayToken is set
```

### Starting the Telegram Adapter

```bash
npx tsx extensions/telegram/src/index.ts
```

Or import programmatically:

```typescript
import { TelegramAdapter } from "@nexus/telegram";

const adapter = new TelegramAdapter({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  gatewayUrl: process.env.NEXUS_GATEWAY_URL ?? "ws://localhost:18789/ws",
  gatewayToken: process.env.NEXUS_GATEWAY_TOKEN,
});

await adapter.start(async (msg) => {
  // Custom message handler — the default handler forwards to the gateway
  // and replies with the agent response.
  await adapter.sendReply(msg.chatId, `Echo: ${msg.text}`);
});
```

### Telegram-specific Notes

- The adapter uses long polling (getUpdates) by default. Webhook mode is not yet supported.
- Markdown in agent responses is escaped using `escapeMarkdownV2` before sending.
- Messages longer than 4096 characters are split automatically.
- The `dmPolicy` config key controls whether direct messages are accepted (`pairing`, `open`, or `deny`).

---

## Discord

### Prerequisites

1. Create an application and bot at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable the **Message Content Intent** under Bot > Privileged Gateway Intents.
3. Invite the bot to your server with the `bot` scope and `Send Messages` + `Read Message History` permissions.
4. Copy the bot token.
5. Ensure the Nexus gateway is running.

### Configuration

```bash
export DISCORD_BOT_TOKEN=your-discord-bot-token
export NEXUS_GATEWAY_URL=ws://localhost:18789/ws
export NEXUS_GATEWAY_TOKEN=my-secret-token   # if security.gatewayToken is set
```

### Starting the Discord Adapter

```bash
npx tsx extensions/discord/src/index.ts
```

Or import programmatically:

```typescript
import { DiscordAdapter } from "@nexus/discord";
import { GatewayIntent } from "@nexus/discord";

const adapter = new DiscordAdapter({
  token: process.env.DISCORD_BOT_TOKEN!,
  gatewayUrl: process.env.NEXUS_GATEWAY_URL ?? "ws://localhost:18789/ws",
  gatewayToken: process.env.NEXUS_GATEWAY_TOKEN,
  intents: GatewayIntent.GUILDS | GatewayIntent.GUILD_MESSAGES | GatewayIntent.MESSAGE_CONTENT,
});

await adapter.start();
```

### Discord-specific Notes

- The adapter connects to the Discord Gateway using WebSocket (not REST polling).
- Each Discord channel gets a separate Nexus session (`peerId` = Discord channel ID).
- The bot only responds to messages that mention it or are in DMs.
- Rate limiting is handled by the Discord adapter; Nexus-level rate limits also apply.

---

## Security: Device Pairing

When `security.dmPolicy` is set to `"pairing"` (the default), channel adapters must pair before forwarding messages. Pairing is done once per adapter instance:

```bash
nexus pair --channel telegram --peer-id <chat-id>
```

The pairing command registers a device token in the `paired_devices` database table. The adapter includes this token in `ConnectParams.deviceToken`.

To list paired devices:

```bash
nexus pair list
```

To revoke a pairing:

```bash
nexus pair revoke <device-token>
```

---

## Adding a New Channel

See [CONTRIBUTING.md](../CONTRIBUTING.md#how-to-add-a-new-channel) for step-by-step instructions on implementing a new channel adapter.
