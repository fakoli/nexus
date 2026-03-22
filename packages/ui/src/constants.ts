/**
 * Derive the WebSocket URL from the current page origin when running in a
 * browser, so the UI works whether it is served from the gateway itself
 * (http://host:19200/ui/) or from a standalone dev server.
 *
 * Falls back to an explicit env override for non-browser contexts (SSR, tests).
 */
function deriveGatewayUrl(): string {
  if (import.meta.env.VITE_GATEWAY_URL) {
    return import.meta.env.VITE_GATEWAY_URL as string;
  }
  if (typeof window !== "undefined" && window.location?.host) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }
  return "ws://localhost:19200/ws";
}

export const DEFAULT_GATEWAY_URL = deriveGatewayUrl();
