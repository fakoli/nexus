/**
 * @nexus/channels — barrel export.
 *
 * Channel adapter framework, message router, allowlist, and DM pairing.
 */

// Adapter interface + types
export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelContext,
  SendOptions,
} from "./adapter.js";

// Registry
export {
  registerAdapter,
  startAdapter,
  stopAdapter,
  stopAllAdapters,
  getAdapter,
  listAdapters,
  isAdapterRunning,
  unregisterAdapter,
} from "./registry.js";

// Router
export { routeInbound, buildSessionKey } from "./router.js";
export type { RoutingPolicy, ChannelRoutingConfig, RouteResult } from "./router.js";

// Allowlist
export {
  checkAllowlist,
  addAllowlistEntry,
  removeAllowlistEntry,
  listAllowlistEntries,
} from "./allowlist.js";
export type { AllowlistResult } from "./allowlist.js";

// Pairing
export {
  createPairingChallenge,
  approvePairing,
  revokePairingChallenge,
  listPendingPairings,
  ensurePairingTable,
} from "./pairing.js";
export type { PairingRequest } from "./pairing.js";

// Reply utilities
export { dispatchReply, formatReply, stripMarkdown, truncateContent } from "./reply.js";
