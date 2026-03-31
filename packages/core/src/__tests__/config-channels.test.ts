import { describe, it, expect } from "vitest";
import { ChannelObservationSchema, ChannelsConfigSchema } from "../config.js";

describe("ChannelObservationSchema", () => {
  it("defaults to mode=off, autoIndex=false, cooldownMs=5000", () => {
    const result = ChannelObservationSchema.parse({});
    expect(result.mode).toBe("off");
    expect(result.autoIndex).toBe(false);
    expect(result.cooldownMs).toBe(5000);
    expect(result.responseFilter).toBeUndefined();
  });

  it("accepts all valid modes", () => {
    for (const mode of ["off", "observe", "active", "mention-only"] as const) {
      const result = ChannelObservationSchema.parse({ mode });
      expect(result.mode).toBe(mode);
    }
  });

  it("rejects invalid mode", () => {
    expect(() => ChannelObservationSchema.parse({ mode: "invalid" })).toThrow();
  });

  it("accepts responseFilter string", () => {
    const result = ChannelObservationSchema.parse({ responseFilter: "^!" });
    expect(result.responseFilter).toBe("^!");
  });

  it("rejects negative cooldownMs", () => {
    expect(() => ChannelObservationSchema.parse({ cooldownMs: -1 })).toThrow();
  });
});

describe("ChannelsConfigSchema with observations", () => {
  it("defaults to empty observations", () => {
    const result = ChannelsConfigSchema.parse({});
    expect(result.telegram.observations).toEqual({});
    expect(result.discord.observations).toEqual({});
  });

  it("accepts channel observations keyed by channel id", () => {
    const result = ChannelsConfigSchema.parse({
      discord: {
        enabled: true,
        token: "tok",
        observations: {
          "123456789": { mode: "active", autoIndex: true },
        },
      },
    });
    const obs = result.discord.observations["123456789"];
    expect(obs).toBeDefined();
    expect(obs?.mode).toBe("active");
    expect(obs?.autoIndex).toBe(true);
    expect(obs?.cooldownMs).toBe(5000); // default
  });

  it("multiple channels can each have observations", () => {
    const result = ChannelsConfigSchema.parse({
      telegram: {
        enabled: true,
        token: "tg",
        observations: {
          "-100123": { mode: "observe" },
          "-100456": { mode: "mention-only", cooldownMs: 1000 },
        },
      },
    });
    expect(result.telegram.observations["-100123"]?.mode).toBe("observe");
    expect(result.telegram.observations["-100456"]?.cooldownMs).toBe(1000);
  });
});
