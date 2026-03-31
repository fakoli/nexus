/**
 * Channel stream RPC handlers.
 *
 * channels.streams.list      — list configured channel observations
 * channels.streams.configure — update a channel's observation config
 * channels.streams.status    — return active stream status (config-based)
 */
import { z } from "zod";
import { getAllConfig, setConfig, ChannelObservationSchema } from "@nexus/core";
import { createLogger } from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:channels");

// ── Schemas ─────────────────────────────────────────────────────────

const ChannelStreamsListParams = z.object({
  platform: z.enum(["telegram", "discord"]).optional(),
});

const ChannelStreamsConfigureParams = z.object({
  platform: z.enum(["telegram", "discord"]),
  channelId: z.string().min(1),
  observation: ChannelObservationSchema,
});

const ChannelStreamsStatusParams = z.object({
  platform: z.enum(["telegram", "discord"]).optional(),
});

// ── Handlers ────────────────────────────────────────────────────────

/**
 * channels.streams.list
 * Returns the observation configs for all channels (or filtered by platform).
 */
export function handleChannelStreamsList(params: Record<string, unknown>): ResponseFrame {
  const parsed = ChannelStreamsListParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const config = getAllConfig();
  const { platform } = parsed.data;

  type PlatformKey = "telegram" | "discord";

  function getPlatformObservations(plat: PlatformKey) {
    const platCfg = config.channels[plat];
    return {
      platform: plat,
      enabled: platCfg.enabled,
      observations: platCfg.observations,
    };
  }

  if (platform) {
    return {
      id: "",
      ok: true,
      payload: { channels: [getPlatformObservations(platform)] },
    };
  }

  return {
    id: "",
    ok: true,
    payload: {
      channels: [
        getPlatformObservations("telegram"),
        getPlatformObservations("discord"),
      ],
    },
  };
}

/**
 * channels.streams.configure
 * Updates the observation config for a specific channel.
 */
export function handleChannelStreamsConfigure(params: Record<string, unknown>): ResponseFrame {
  const parsed = ChannelStreamsConfigureParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { platform, channelId, observation } = parsed.data;

  try {
    const config = getAllConfig();
    const platCfg = config.channels[platform];

    const updatedChannels = {
      ...config.channels,
      [platform]: {
        ...platCfg,
        observations: {
          ...platCfg.observations,
          [channelId]: observation,
        },
      },
    };

    setConfig("channels", updatedChannels);
    log.info({ platform, channelId, mode: observation.mode }, "Channel observation configured");

    return {
      id: "",
      ok: true,
      payload: { platform, channelId, observation },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, "Failed to configure channel observation");
    return {
      id: "",
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }
}

/**
 * channels.streams.status
 * Returns status information for channel streams (config-based).
 */
export function handleChannelStreamsStatus(params: Record<string, unknown>): ResponseFrame {
  const parsed = ChannelStreamsStatusParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const config = getAllConfig();
  const { platform } = parsed.data;

  type PlatformKey = "telegram" | "discord";

  function getPlatformStatus(plat: PlatformKey) {
    const platCfg = config.channels[plat];
    const observations = platCfg.observations;
    const activeCount = Object.values(observations).filter(
      (obs) => obs.mode !== "off",
    ).length;

    return {
      platform: plat,
      enabled: platCfg.enabled,
      configuredChannels: Object.keys(observations).length,
      activeChannels: activeCount,
      channels: Object.entries(observations).map(([id, obs]) => ({
        channelId: id,
        mode: obs.mode,
        autoIndex: obs.autoIndex,
      })),
    };
  }

  if (platform) {
    return {
      id: "",
      ok: true,
      payload: { status: [getPlatformStatus(platform)] },
    };
  }

  return {
    id: "",
    ok: true,
    payload: {
      status: [
        getPlatformStatus("telegram"),
        getPlatformStatus("discord"),
      ],
    },
  };
}
