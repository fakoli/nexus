/**
 * Federation server handler — processes inbound federation WebSocket
 * connections from remote Nexus gateways.
 *
 * Validates the federation handshake, routes inbound messages to local
 * sessions, and forwards local events to federated peers.
 */
import { WebSocket } from "ws";
import { createLogger, events, appendMessage, getOrCreateSession, getOrCreateAgent, timingSafeEqual } from "@nexus/core";
import {
  FederationHandshakeSchema,
  FederationFrameSchema,
} from "./protocol.js";
import type {
  FederationFrame,
  FederatedMessage,
  FederatedSession,
  FederatedStream,
} from "./protocol.js";

const log = createLogger("federation:handler");

export interface InboundPeer {
  gatewayId: string;
  gatewayName: string;
  ws: WebSocket;
  connectedAt: number;
  lastSeen: number;
}

const inboundPeers = new Map<string, InboundPeer>();

// ── Connection handling ─────────────────────────────────────────────

/**
 * Process a new inbound federation WebSocket connection.
 * The first message must be a FederationHandshake with a valid token.
 */
export function handleFederationConnection(
  ws: WebSocket,
  localGatewayId: string,
  localGatewayName: string,
  expectedToken: string | undefined,
  maxPeers: number,
): void {
  let authed = false;

  // Timeout unauthenticated connections to prevent resource exhaustion
  const handshakeTimeout = setTimeout(() => {
    if (!authed) {
      log.warn("Federation handshake timeout — closing connection");
      ws.close(4408, "Handshake timeout");
    }
  }, 10_000);

  ws.on("message", (data) => {
    const raw = data.toString();

    if (!authed) {
      clearTimeout(handshakeTimeout);
      authed = processHandshake(
        ws, raw, localGatewayId, localGatewayName, expectedToken, maxPeers,
      );
      return;
    }

    processFrame(ws, raw);
  });

  ws.on("close", () => {
    clearTimeout(handshakeTimeout);
    removePeerBySocket(ws);
  });

  ws.on("error", (err) => {
    clearTimeout(handshakeTimeout);
    log.error({ err: err.message }, "Inbound federation WS error");
    removePeerBySocket(ws);
  });
}

function processHandshake(
  ws: WebSocket,
  raw: string,
  localGatewayId: string,
  localGatewayName: string,
  expectedToken: string | undefined,
  maxPeers: number,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendAck(ws, localGatewayId, localGatewayName, false, "Invalid JSON");
    ws.close(4400, "Invalid JSON");
    return false;
  }

  const result = FederationHandshakeSchema.safeParse(parsed);
  if (!result.success) {
    sendAck(ws, localGatewayId, localGatewayName, false, "Invalid handshake");
    ws.close(4400, "Invalid handshake");
    return false;
  }

  const handshake = result.data;

  // Token validation (timing-safe comparison to prevent timing attacks)
  if (expectedToken && !timingSafeEqual(handshake.token ?? "", expectedToken)) {
    sendAck(ws, localGatewayId, localGatewayName, false, "Invalid token");
    ws.close(4401, "Invalid token");
    return false;
  }

  // Reject duplicate gatewayId (prevents orphaned WebSocket leak)
  if (inboundPeers.has(handshake.gatewayId)) {
    sendAck(ws, localGatewayId, localGatewayName, false, "Peer already connected");
    ws.close(4409, "Peer already connected");
    return false;
  }

  // Max peers check
  if (inboundPeers.size >= maxPeers) {
    sendAck(ws, localGatewayId, localGatewayName, false, "Max peers reached");
    ws.close(4429, "Max peers reached");
    return false;
  }

  // Accept the peer
  const now = Date.now();
  const peer: InboundPeer = {
    gatewayId: handshake.gatewayId,
    gatewayName: handshake.gatewayName,
    ws,
    connectedAt: now,
    lastSeen: now,
  };
  inboundPeers.set(handshake.gatewayId, peer);

  sendAck(ws, localGatewayId, localGatewayName, true);

  events.emit("federation:peer:connected", {
    gatewayId: handshake.gatewayId,
    gatewayName: handshake.gatewayName,
    direction: "inbound",
  });

  log.info(
    { peerId: handshake.gatewayId, peerName: handshake.gatewayName },
    "Inbound federation peer accepted",
  );

  return true;
}

function sendAck(
  ws: WebSocket,
  gatewayId: string,
  gatewayName: string,
  accepted: boolean,
  reason?: string,
): void {
  const ack = JSON.stringify({
    type: "federation:ack",
    gatewayId,
    gatewayName,
    accepted,
    reason,
  });
  ws.send(ack);
}

function processFrame(ws: WebSocket, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("Non-JSON frame from federation peer");
    return;
  }

  const result = FederationFrameSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ err: result.error.message }, "Invalid federation frame");
    return;
  }

  const frame = result.data;
  updatePeerLastSeen(ws);
  dispatchInboundFrame(frame);
}

function dispatchInboundFrame(frame: FederationFrame): void {
  switch (frame.type) {
    case "federation:message":
      handleInboundMessage(frame);
      break;
    case "federation:session":
      handleInboundSession(frame);
      break;
    case "federation:stream":
      handleInboundStream(frame);
      break;
    case "federation:hello":
    case "federation:ack":
      // Unexpected after handshake; ignore
      break;
  }
}

function handleInboundMessage(msg: FederatedMessage): void {
  // Validate that the claimed origin is a known connected peer
  if (!inboundPeers.has(msg.originGateway)) {
    log.warn({ claimed: msg.originGateway }, "Message from unrecognized origin gateway, ignoring");
    return;
  }

  const session = getOrCreateSession(msg.sessionId, "default", "federation");
  appendMessage(session.id, msg.message.role, msg.message.content, msg.message.metadata);

  events.emit("federation:message:received", {
    originGateway: msg.originGateway,
    sessionId: msg.sessionId,
  });

  log.info(
    { origin: msg.originGateway, sessionId: msg.sessionId },
    "Federated message received and stored",
  );
}

function handleInboundSession(msg: FederatedSession): void {
  switch (msg.action) {
    case "create":
    case "sync": {
      getOrCreateAgent(msg.session.agentId);
      getOrCreateSession(msg.session.id, msg.session.agentId, "federation");
      log.info(
        { action: msg.action, sessionId: msg.session.id },
        "Federated session synced",
      );
      break;
    }
    case "close":
      log.info({ sessionId: msg.session.id }, "Federated session close request");
      break;
  }
}

function handleInboundStream(msg: FederatedStream): void {
  // Stream deltas are broadcast as events for connected UI clients
  events.emit("session:message", {
    sessionId: msg.sessionId,
    role: "assistant",
    content: msg.delta.content ?? "",
  });
}

// ── Peer bookkeeping ────────────────────────────────────────────────

function updatePeerLastSeen(ws: WebSocket): void {
  for (const peer of inboundPeers.values()) {
    if (peer.ws === ws) {
      peer.lastSeen = Date.now();
      break;
    }
  }
}

function removePeerBySocket(ws: WebSocket): void {
  for (const [id, peer] of inboundPeers.entries()) {
    if (peer.ws === ws) {
      inboundPeers.delete(id);
      events.emit("federation:peer:disconnected", { gatewayId: id });
      log.info({ peerId: id }, "Inbound federation peer disconnected");
      break;
    }
  }
}

// ── Public queries ──────────────────────────────────────────────────

export function getInboundPeers(): InboundPeer[] {
  return Array.from(inboundPeers.values());
}

export function disconnectInboundPeer(gatewayId: string): boolean {
  const peer = inboundPeers.get(gatewayId);
  if (!peer) return false;
  peer.ws.close(1000, "Disconnected by local gateway");
  inboundPeers.delete(gatewayId);
  events.emit("federation:peer:disconnected", { gatewayId });
  return true;
}

/**
 * Broadcast a frame to all connected inbound peers.
 */
export function broadcastToInboundPeers(frame: FederationFrame): void {
  const data = JSON.stringify(frame);
  for (const peer of inboundPeers.values()) {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  }
}

/**
 * Clear all inbound peers (used during shutdown).
 */
export function clearInboundPeers(): void {
  for (const peer of inboundPeers.values()) {
    peer.ws.close(1001, "Gateway shutting down");
  }
  inboundPeers.clear();
}
