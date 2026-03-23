/**
 * Federation module — gateway-to-gateway streaming channels.
 */
export {
  FederationHandshakeSchema,
  FederationAckSchema,
  FederatedMessageSchema,
  FederatedSessionSchema,
  FederatedStreamSchema,
  FederationFrameSchema,
} from "./protocol.js";
export type {
  FederationHandshake,
  FederationAck,
  FederatedMessage,
  FederatedSession,
  FederatedStream,
  FederationFrame,
} from "./protocol.js";

export {
  FederationConfigSchema,
  FederationPeerSchema,
} from "./config.js";
export type {
  FederationConfig,
  FederationPeer,
} from "./config.js";

export { FederationClient } from "./client.js";
export type { FederationClientOptions } from "./client.js";

export {
  handleFederationConnection,
  getInboundPeers,
  disconnectInboundPeer,
  broadcastToInboundPeers,
  clearInboundPeers,
} from "./handler.js";
export type { InboundPeer } from "./handler.js";

export {
  startFederation,
  stopFederation,
  addPeer,
  removePeer,
  getPeers,
  getLocalGatewayId,
  getLocalGatewayName,
  forwardToAll,
} from "./manager.js";
export type { FederatedPeer } from "./manager.js";
