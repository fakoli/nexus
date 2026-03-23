/**
 * Federation manager — orchestrates all peer connections (inbound + outbound).
 *
 * On startup, reads configured peers and connects to each.
 * At runtime, accepts inbound connections and routes messages.
 * On shutdown, gracefully disconnects all peers.
 */
import { v4 as uuid } from "uuid";
import { createLogger, events, appendMessage, getOrCreateSession, getOrCreateAgent } from "@nexus/core";
import { FederationClient } from "./client.js";
import type { FederationClientOptions } from "./client.js";
import type { FederationConfig } from "./config.js";
import {
  getInboundPeers,
  disconnectInboundPeer,
  broadcastToInboundPeers,
  clearInboundPeers,
} from "./handler.js";
import type { FederationFrame, FederatedMessage, FederatedStream } from "./protocol.js";

const log = createLogger("federation:manager");

const SERVER_VERSION = "0.1.0";

export interface FederatedPeer {
  gatewayId: string;
  gatewayName: string;
  direction: "inbound" | "outbound";
  status: "connecting" | "connected" | "disconnected";
  connectedAt?: number;
  lastSeen?: number;
}

// ── Outbound client tracking ────────────────────────────────────────

interface OutboundEntry {
  client: FederationClient;
  url: string;
  connectedAt?: number;
}

const outboundClients = new Map<string, OutboundEntry>();

let localGatewayId = "";
let localGatewayName = "nexus";
let managerConfig: FederationConfig | null = null;

// ── Lifecycle ───────────────────────────────────────────────────────

export function startFederation(config: FederationConfig): void {
  localGatewayId = config.gatewayId ?? uuid();
  localGatewayName = config.gatewayName;
  managerConfig = config;

  log.info(
    { gatewayId: localGatewayId, peers: config.peers.length },
    "Starting federation",
  );

  for (const peer of config.peers) {
    if (peer.autoConnect) {
      addPeer(peer.url, peer.token, peer.name);
    }
  }
}

export function stopFederation(): void {
  log.info("Stopping federation");
  for (const [, entry] of outboundClients) {
    entry.client.disconnect();
  }
  outboundClients.clear();
  clearInboundPeers();
  managerConfig = null;
}

// ── Peer management ─────────────────────────────────────────────────

export function addPeer(url: string, token: string, name?: string): string {
  const config = managerConfig;
  const opts: FederationClientOptions = {
    localGatewayId,
    localGatewayName,
    version: SERVER_VERSION,
    heartbeatInterval: config?.heartbeatInterval ?? 30000,
    reconnectMaxDelay: config?.reconnectMaxDelay ?? 30000,
    messageQueueSize: config?.messageQueueSize ?? 1000,
  };

  const client = new FederationClient(url, token, opts);
  const peerKey = name ?? url;

  client.onMessage((msg) => {
    routeInboundMessage(msg);
  });

  client.onStream((stream) => {
    routeInboundStream(stream);
  });

  client.onConnect((ack) => {
    const entry = findEntryByClient(client);
    if (entry) {
      entry.connectedAt = Date.now();
    }
    events.emit("federation:peer:connected", {
      gatewayId: ack.gatewayId,
      gatewayName: ack.gatewayName,
      direction: "outbound",
    });
    log.info(
      { remoteId: ack.gatewayId, remoteName: ack.gatewayName },
      "Outbound federation peer connected",
    );
  });

  client.onDisconnect((reason) => {
    events.emit("federation:peer:disconnected", {
      gatewayId: client.remoteGatewayId,
      reason,
    });
  });

  outboundClients.set(peerKey, { client, url, connectedAt: undefined });
  client.connect();

  return peerKey;
}

export function removePeer(gatewayId: string): boolean {
  // Try outbound first
  for (const [key, entry] of outboundClients) {
    if (entry.client.remoteGatewayId === gatewayId || key === gatewayId) {
      entry.client.disconnect();
      outboundClients.delete(key);
      return true;
    }
  }
  // Try inbound
  return disconnectInboundPeer(gatewayId);
}

export function getPeers(): FederatedPeer[] {
  const peers: FederatedPeer[] = [];

  // Outbound peers
  for (const entry of outboundClients.values()) {
    peers.push({
      gatewayId: entry.client.remoteGatewayId || "unknown",
      gatewayName: entry.client.remoteGatewayName || "unknown",
      direction: "outbound",
      status: entry.client.isConnected() ? "connected" : "connecting",
      connectedAt: entry.connectedAt,
    });
  }

  // Inbound peers
  for (const inbound of getInboundPeers()) {
    peers.push({
      gatewayId: inbound.gatewayId,
      gatewayName: inbound.gatewayName,
      direction: "inbound",
      status: "connected",
      connectedAt: inbound.connectedAt,
      lastSeen: inbound.lastSeen,
    });
  }

  return peers;
}

export function getLocalGatewayId(): string {
  return localGatewayId;
}

export function getLocalGatewayName(): string {
  return localGatewayName;
}

// ── Message routing ─────────────────────────────────────────────────

function routeInboundMessage(msg: FederatedMessage): void {
  getOrCreateAgent("default");
  getOrCreateSession(msg.sessionId, "default", "federation");
  appendMessage(msg.sessionId, msg.message.role, msg.message.content, msg.message.metadata);

  events.emit("federation:message:received", {
    originGateway: msg.originGateway,
    sessionId: msg.sessionId,
  });
}

function routeInboundStream(stream: FederatedStream): void {
  events.emit("session:message", {
    sessionId: stream.sessionId,
    role: "assistant",
    content: stream.delta.content ?? "",
  });
}

export function forwardToAll(sessionId: string, frame: FederationFrame): void {
  // Forward to outbound peers
  for (const entry of outboundClients.values()) {
    if (entry.client.isConnected()) {
      if (frame.type === "federation:message") {
        entry.client.forwardMessage(sessionId, frame.message);
      } else if (frame.type === "federation:stream") {
        entry.client.forwardStream(sessionId, frame.delta);
      } else if (frame.type === "federation:session") {
        entry.client.syncSession(frame.session, frame.action);
      }
    }
  }

  // Forward to inbound peers
  broadcastToInboundPeers(frame);

  events.emit("federation:message:forwarded", {
    targetGateway: "all",
    sessionId,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function findEntryByClient(client: FederationClient): OutboundEntry | undefined {
  for (const entry of outboundClients.values()) {
    if (entry.client === client) {
      return entry;
    }
  }
  return undefined;
}
