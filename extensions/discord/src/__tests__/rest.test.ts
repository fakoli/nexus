/**
 * Unit tests for DiscordRestClient.
 *
 * All network I/O is intercepted via vi.stubGlobal("fetch", ...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscordRestClient, DiscordApiError } from "../rest.js";

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("DiscordRestClient", () => {
  let client: DiscordRestClient;
  const TOKEN = "Bot.test.token";

  beforeEach(() => {
    client = new DiscordRestClient(TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── sendMessage ──────────────────────────────────────────────────────

  it("sendMessage: POSTs to the correct endpoint", async () => {
    const fetchMock = mockFetch(200, { id: "msg-123" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.sendMessage("channel-1", "hello world");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/channels/channel-1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello world" });
    expect(result.id).toBe("msg-123");
  });

  it("sendMessage: includes Bot authorization header", async () => {
    const fetchMock = mockFetch(200, { id: "msg-456" });
    vi.stubGlobal("fetch", fetchMock);

    await client.sendMessage("chan", "hi");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bot ${TOKEN}`);
  });

  // ── editMessage ──────────────────────────────────────────────────────

  it("editMessage: PATCHes the correct endpoint", async () => {
    const fetchMock = mockFetch(200, { id: "msg-789" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.editMessage("chan-2", "msg-789", "updated text");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/channels/chan-2/messages/msg-789");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ content: "updated text" });
    expect(result.id).toBe("msg-789");
  });

  // ── deleteMessage ────────────────────────────────────────────────────

  it("deleteMessage: DELETEs the correct endpoint and returns void", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: () => Promise.resolve(undefined),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.deleteMessage("chan-3", "msg-101");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/channels/chan-3/messages/msg-101");
    expect(init.method).toBe("DELETE");
    expect(result).toBeUndefined();
  });

  // ── getGatewayUrl ────────────────────────────────────────────────────

  it("getGatewayUrl: appends v10 query params to the returned URL", async () => {
    const fetchMock = mockFetch(200, { url: "wss://gateway.discord.gg" });
    vi.stubGlobal("fetch", fetchMock);

    const url = await client.getGatewayUrl();

    expect(url).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
  });

  // ── Error handling ───────────────────────────────────────────────────

  it("throws DiscordApiError on non-2xx responses", async () => {
    const fetchMock = mockFetch(403, { message: "Missing Permissions" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.sendMessage("chan", "bad")).rejects.toThrow(DiscordApiError);
    await expect(client.sendMessage("chan", "bad")).rejects.toMatchObject({ status: 403 });
  });

  // ── Rate limit handling ──────────────────────────────────────────────

  it("retries once after a 429 response and succeeds on the second call", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          // retry_after: 0 → sleep(0) so the test stays synchronous-ish
          json: () => Promise.resolve({ retry_after: 0 }),
          text: () => Promise.resolve("rate limited"),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg-retry" }),
        text: () => Promise.resolve('{"id":"msg-retry"}'),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.sendMessage("chan", "retry me");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.id).toBe("msg-retry");
  });

  it("throws after exhausting MAX_RETRIES on repeated 429s", async () => {
    // Use real timers with a near-zero retry_after so the test stays fast.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({ retry_after: 0 }),
      text: () => Promise.resolve("rate limited"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.sendMessage("chan", "forever rate limited")).rejects.toThrow(DiscordApiError);
    // Initial call + MAX_RETRIES (3) retries = 4 total fetch calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  // ── Authorization format ─────────────────────────────────────────────

  it("uses the correct Content-Type header", async () => {
    const fetchMock = mockFetch(200, { id: "x" });
    vi.stubGlobal("fetch", fetchMock);

    await client.sendMessage("c", "test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
