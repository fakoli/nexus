import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-channels-handler-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("@nexus/core");
  db.closeDb();
  db.runMigrations();
  return db;
}

describe("channel stream RPC handlers", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("@nexus/core");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  // ── channels.streams.list ──────────────────────────────────────────

  it("channels.streams.list returns both platforms by default", async () => {
    const { handleChannelStreamsList } = await import("../handlers/channels.js");
    const result = handleChannelStreamsList({});
    expect(result.ok).toBe(true);
    const channels = (result.payload as { channels: unknown[] }).channels;
    expect(channels).toHaveLength(2);
    const platforms = (channels as Array<{ platform: string }>).map((c) => c.platform);
    expect(platforms).toContain("telegram");
    expect(platforms).toContain("discord");
  });

  it("channels.streams.list filters by platform", async () => {
    const { handleChannelStreamsList } = await import("../handlers/channels.js");
    const result = handleChannelStreamsList({ platform: "discord" });
    expect(result.ok).toBe(true);
    const channels = (result.payload as { channels: unknown[] }).channels;
    expect(channels).toHaveLength(1);
    expect((channels[0] as { platform: string }).platform).toBe("discord");
  });

  it("channels.streams.list rejects invalid platform", async () => {
    const { handleChannelStreamsList } = await import("../handlers/channels.js");
    const result = handleChannelStreamsList({ platform: "slack" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  // ── channels.streams.configure ─────────────────────────────────────

  it("channels.streams.configure saves an observation", async () => {
    const { handleChannelStreamsConfigure } = await import("../handlers/channels.js");
    const result = handleChannelStreamsConfigure({
      platform: "discord",
      channelId: "123456",
      observation: { mode: "active", autoIndex: true, cooldownMs: 1000 },
    });
    expect(result.ok).toBe(true);
    const payload = result.payload as { platform: string; channelId: string; observation: { mode: string } };
    expect(payload.platform).toBe("discord");
    expect(payload.channelId).toBe("123456");
    expect(payload.observation.mode).toBe("active");
  });

  it("channels.streams.configure rejects missing required fields", async () => {
    const { handleChannelStreamsConfigure } = await import("../handlers/channels.js");
    const result = handleChannelStreamsConfigure({ platform: "discord" }); // missing channelId
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("channels.streams.configure rejects invalid mode", async () => {
    const { handleChannelStreamsConfigure } = await import("../handlers/channels.js");
    const result = handleChannelStreamsConfigure({
      platform: "discord",
      channelId: "111",
      observation: { mode: "broadcast" }, // invalid
    });
    expect(result.ok).toBe(false);
  });

  it("channels.streams.configure persists and is readable via list", async () => {
    const { handleChannelStreamsConfigure, handleChannelStreamsList } = await import("../handlers/channels.js");

    handleChannelStreamsConfigure({
      platform: "telegram",
      channelId: "-100999",
      observation: { mode: "mention-only", autoIndex: false, cooldownMs: 3000 },
    });

    const listResult = handleChannelStreamsList({ platform: "telegram" });
    expect(listResult.ok).toBe(true);
    const ch = (listResult.payload as { channels: Array<{ observations: Record<string, unknown> }> }).channels[0];
    expect(ch?.observations["-100999"]).toBeDefined();
    expect((ch?.observations["-100999"] as { mode: string }).mode).toBe("mention-only");
  });

  // ── channels.streams.status ────────────────────────────────────────

  it("channels.streams.status returns status for both platforms", async () => {
    const { handleChannelStreamsStatus } = await import("../handlers/channels.js");
    const result = handleChannelStreamsStatus({});
    expect(result.ok).toBe(true);
    const status = (result.payload as { status: unknown[] }).status;
    expect(status).toHaveLength(2);
  });

  it("channels.streams.status filters by platform", async () => {
    const { handleChannelStreamsStatus } = await import("../handlers/channels.js");
    const result = handleChannelStreamsStatus({ platform: "telegram" });
    expect(result.ok).toBe(true);
    const status = (result.payload as { status: unknown[] }).status;
    expect(status).toHaveLength(1);
  });

  it("channels.streams.status counts active channels correctly", async () => {
    const { handleChannelStreamsConfigure, handleChannelStreamsStatus } = await import("../handlers/channels.js");

    handleChannelStreamsConfigure({
      platform: "discord",
      channelId: "ch1",
      observation: { mode: "active", autoIndex: false, cooldownMs: 0 },
    });
    handleChannelStreamsConfigure({
      platform: "discord",
      channelId: "ch2",
      observation: { mode: "off", autoIndex: false, cooldownMs: 0 },
    });
    handleChannelStreamsConfigure({
      platform: "discord",
      channelId: "ch3",
      observation: { mode: "observe", autoIndex: false, cooldownMs: 0 },
    });

    const result = handleChannelStreamsStatus({ platform: "discord" });
    expect(result.ok).toBe(true);
    const status = (result.payload as { status: Array<{ activeChannels: number; configuredChannels: number }> }).status;
    expect(status[0]?.configuredChannels).toBe(3);
    expect(status[0]?.activeChannels).toBe(2); // "active" and "observe" are non-off
  });
});
