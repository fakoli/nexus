/**
 * Federation configuration — re-exports from @nexus/core.
 *
 * The canonical schemas live in core/config.ts. This module provides
 * convenient gateway-local aliases with matching type names.
 */
export {
  FederationConfigSchema,
  FederationPeerConfigSchema as FederationPeerSchema,
} from "@nexus/core";

export type {
  FederationConfig,
  FederationPeerConfig as FederationPeer,
} from "@nexus/core";
