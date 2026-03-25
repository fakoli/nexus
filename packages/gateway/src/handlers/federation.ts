/**
 * Federation RPC handlers.
 *
 * - federation.peers      — list connected federation peers
 * - federation.connect    — connect to a new peer gateway
 * - federation.disconnect — disconnect a peer gateway
 * - federation.status     — federation status overview
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";
import {
  getPeers,
  addPeer,
  removePeer,
  getLocalGatewayId,
  getLocalGatewayName,
} from "../federation/manager.js";

const log = createLogger("gateway:federation");

// ── Param schemas ───────────────────────────────────────────────────

const ConnectPeerParams = z.object({
  url: z.string().url(),
  token: z.string().optional().default(""),
  name: z.string().optional(),
});

const DisconnectPeerParams = z.object({
  gatewayId: z.string(),
});

// ── Handlers ────────────────────────────────────────────────────────

export function handleFederationPeers(): ResponseFrame {
  const peers = getPeers();
  return {
    id: "",
    ok: true,
    payload: { peers },
  };
}

export function handleFederationConnect(
  params: Record<string, unknown>,
): ResponseFrame {
  const parsed = ConnectPeerParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const { url, token, name } = parsed.data;

  try {
    const peerKey = addPeer(url, token, name);
    log.info({ url, peerKey }, "Federation peer connection initiated");
    return {
      id: "",
      ok: true,
      payload: { peerKey, status: "connecting" },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "FEDERATION_ERROR", message: msg },
    };
  }
}

export function handleFederationDisconnect(
  params: Record<string, unknown>,
): ResponseFrame {
  const parsed = DisconnectPeerParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  const removed = removePeer(parsed.data.gatewayId);
  if (!removed) {
    return {
      id: "",
      ok: false,
      error: {
        code: "PEER_NOT_FOUND",
        message: `Peer ${parsed.data.gatewayId} not found`,
      },
    };
  }

  log.info({ gatewayId: parsed.data.gatewayId }, "Federation peer disconnected");
  return { id: "", ok: true, payload: { disconnected: true } };
}

export function handleFederationStatus(): ResponseFrame {
  const peers = getPeers();
  const connected = peers.filter((p) => p.status === "connected").length;

  return {
    id: "",
    ok: true,
    payload: {
      gatewayId: getLocalGatewayId(),
      gatewayName: getLocalGatewayName(),
      totalPeers: peers.length,
      connectedPeers: connected,
      peers,
    },
  };
}
