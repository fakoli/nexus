import { type Component, type JSX, createSignal, For, Show } from "solid-js";
import { store } from "../../stores/app";
import { gateway } from "../../stores/app";
import { tokens as t } from "../../design/tokens";
import { Badge, Button, Card, Input } from "../../design/components";
import type { FederatedPeer } from "../../gateway/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusVariant(s: FederatedPeer["status"]): "success" | "warning" | "error" {
  switch (s) {
    case "connected":    return "success";
    case "connecting":   return "warning";
    case "disconnected": return "error";
  }
}

function directionLabel(d: FederatedPeer["direction"]): string {
  return d === "inbound" ? "\u2190 Inbound" : "\u2192 Outbound";
}

function formatTs(ts: number | undefined): string {
  if (!ts) return "\u2014";
  return new Date(ts).toLocaleString();
}

// ── Component ────────────────────────────────────────────────────────────────

export const FederationView: Component = () => {
  const [peerUrl, setPeerUrl] = createSignal("");
  const [peerToken, setPeerToken] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal("");

  const peers = () => store.federation.peers;
  const enabled = () => store.federation.enabled;

  const handleConnect = async (): Promise<void> => {
    const url = peerUrl().trim();
    if (!url) return;
    setConnecting(true);
    setError("");
    try {
      await gateway.request("federation.connect", {
        url,
        token: peerToken().trim(),
      });
      setPeerUrl("");
      setPeerToken("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (gatewayId: string): Promise<void> => {
    try {
      await gateway.request("federation.disconnect", { gatewayId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Disconnect failed";
      setError(msg);
    }
  };

  return (
    <div style={{
      padding: t.space.lg, "max-width": "800px",
      margin: "0 auto", display: "flex",
      "flex-direction": "column", gap: t.space.lg,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", "align-items": "center",
        "justify-content": "space-between",
      }}>
        <h2 style={{
          margin: "0", color: t.color.text,
          "font-size": t.font.sizeXl,
          "font-family": t.font.family,
        }}>
          Federation
        </h2>
        <Badge variant={enabled() ? "success" : "default"}>
          {enabled() ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {/* Peer table */}
      <Card title="Connected Peers">
        <Show
          when={peers().length > 0}
          fallback={
            <p style={{ color: t.color.textDim, margin: "0" }}>
              No peers connected.
            </p>
          }
        >
          <div style={{ "overflow-x": "auto" }}>
            <table style={{
              width: "100%", "border-collapse": "collapse",
              "font-size": t.font.sizeMd, "font-family": t.font.family,
              color: t.color.text,
            }}>
              <thead>
                <tr style={{ "border-bottom": `1px solid ${t.color.border}` }}>
                  <Th>Name</Th>
                  <Th>Direction</Th>
                  <Th>Status</Th>
                  <Th>Connected At</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                <For each={peers()}>
                  {(peer) => (
                    <tr style={{ "border-bottom": `1px solid ${t.color.border}` }}>
                      <Td>
                        <span style={{ "font-weight": t.font.weightBold }}>
                          {peer.gatewayName}
                        </span>
                        <br />
                        <span style={{
                          "font-size": t.font.sizeSm,
                          color: t.color.textDim,
                          "font-family": t.font.familyMono,
                        }}>
                          {peer.gatewayId}
                        </span>
                      </Td>
                      <Td>{directionLabel(peer.direction)}</Td>
                      <Td>
                        <Badge variant={statusVariant(peer.status)}>
                          {peer.status}
                        </Badge>
                      </Td>
                      <Td>{formatTs(peer.connectedAt)}</Td>
                      <Td>
                        <Button
                          variant="ghost"
                          onClick={() => handleDisconnect(peer.gatewayId)}
                        >
                          Disconnect
                        </Button>
                      </Td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Card>

      {/* Connect form */}
      <Card title="Connect to Peer">
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
          <Input
            label="Gateway URL"
            placeholder="http(s)://host:port"
            value={peerUrl()}
            onInput={(e) => setPeerUrl(e.currentTarget.value)}
          />
          <Input
            label="Token (optional)"
            placeholder="Bearer token for authentication"
            value={peerToken()}
            onInput={(e) => setPeerToken(e.currentTarget.value)}
            type="password"
          />
          <Show when={error()}>
            <span style={{ color: t.color.error, "font-size": t.font.sizeSm }}>
              {error()}
            </span>
          </Show>
          <Button onClick={handleConnect} loading={connecting()}>
            Connect
          </Button>
        </div>
      </Card>
    </div>
  );
};

// ── Table cell helpers ───────────────────────────────────────────────────────

const Th: Component<{ children: string }> = (props) => (
  <th style={{
    "text-align": "left", padding: `${t.space.sm} ${t.space.sm}`,
    "font-weight": t.font.weightBold, color: t.color.textMuted,
    "font-size": t.font.sizeSm, "text-transform": "uppercase",
    "letter-spacing": "0.05em",
  }}>
    {props.children}
  </th>
);

const Td: Component<{ children?: JSX.Element }> = (props) => (
  <td style={{ padding: `${t.space.sm} ${t.space.sm}` }}>
    {props.children}
  </td>
);

export default FederationView;
