/**
 * Discord REST API client (v10).
 *
 * Uses the global `fetch` for requests.  Handles 429 rate-limit responses by
 * waiting the `retry_after` duration then retrying once.
 */
import { createLogger } from "@nexus/core";

const log = createLogger("discord:rest");

const BASE_URL = "https://discord.com/api/v10";
const MAX_RETRIES = 3;

export class DiscordRestClient {
  private readonly headers: Record<string, string>;

  constructor(token: string) {
    this.headers = {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "NexusBot/0.1.0 (nexus)",
    };
  }

  // ── Low-level request helper ────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DiscordApiError(0, path, `Network error: ${msg}`);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const waitMs = (data.retry_after ?? 1) * 1000;
      log.warn({ path, attempt, waitMs }, "Rate limited, retrying");
      await sleep(waitMs);
      return this.request<T>(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new DiscordApiError(res.status, path, text);
    }

    // 204 No Content
    if (res.status === 204) return undefined as unknown as T;

    return res.json() as Promise<T>;
  }

  // ── Public API methods ──────────────────────────────────────────────

  /**
   * Send a message to a channel.
   * @returns The created message object.
   */
  async sendMessage(channelId: string, content: string): Promise<{ id: string }> {
    log.debug({ channelId }, "Sending message");
    return this.request<{ id: string }>("POST", `/channels/${channelId}/messages`, { content });
  }

  /**
   * Edit an existing message.
   * @returns The updated message object.
   */
  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ id: string }> {
    log.debug({ channelId, messageId }, "Editing message");
    return this.request<{ id: string }>(
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      { content },
    );
  }

  /**
   * Delete a message.
   */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    log.debug({ channelId, messageId }, "Deleting message");
    await this.request<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
  }

  /**
   * Retrieve the recommended WebSocket Gateway URL.
   */
  async getGatewayUrl(): Promise<string> {
    const data = await this.request<{ url: string }>("GET", "/gateway/bot");
    return `${data.url}/?v=10&encoding=json`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DiscordApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(`Discord API error ${status} on ${path}: ${message}`);
    this.name = "DiscordApiError";
  }
}
