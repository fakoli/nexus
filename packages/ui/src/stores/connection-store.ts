import { createStore } from "solid-js/store";
import type { ConnectionStatus } from "../gateway/types";

// ── Connection store ──────────────────────────────────────────────────────────

export interface ConnectionState {
  status: ConnectionStatus;
  error: string | null;
  gatewayUrl: string;
  token: string;
}

export const [connectionStore, setConnectionStore] = createStore<ConnectionState>({
  status: "disconnected",
  error: null,
  gatewayUrl: "",
  token: "",
});

export function setConnectionStatus(status: ConnectionStatus): void {
  setConnectionStore("status", status);
}

export function setConnectionError(error: string | null): void {
  setConnectionStore("error", error);
  if (error) setConnectionStore("status", "disconnected");
}

export function setGatewayUrl(url: string): void {
  setConnectionStore("gatewayUrl", url);
}

export function setToken(token: string): void {
  setConnectionStore("token", token);
}
