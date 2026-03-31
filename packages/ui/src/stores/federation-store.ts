import { createStore } from "solid-js/store";
import type { FederatedPeer } from "../gateway/types";

// ── Federation store ──────────────────────────────────────────────────────────

export interface FederationState {
  peers: FederatedPeer[];
  enabled: boolean;
}

export const [federationStore, setFederationStore] = createStore<FederationState>({
  peers: [],
  enabled: false,
});

export function upsertPeer(peer: FederatedPeer): void {
  setFederationStore("peers", (peers) => {
    const filtered = peers.filter((p) => p.gatewayId !== peer.gatewayId);
    return [...filtered, peer];
  });
}

export function setPeerDisconnected(gatewayId: string): void {
  setFederationStore("peers", (peers) =>
    peers.map((p) =>
      p.gatewayId === gatewayId ? { ...p, status: "disconnected" as const } : p,
    ),
  );
}

export function setFederationEnabled(enabled: boolean): void {
  setFederationStore("enabled", enabled);
}
