/**
 * SandboxStatus — displays sandbox state for an agent.
 *
 * SandboxStatus: small badge showing "Sandboxed" or "Unsandboxed".
 * CapabilityEditor: form to configure the agent's sandbox capabilities.
 */
import { createSignal, Show, For } from "solid-js";
import { Badge, Card, Input, Toggle } from "../../design/components";
import { tokens as t } from "../../design/tokens";

// ── Inline capability types (mirrors @nexus/sandbox, no cross-package import) ──

export interface AgentCapabilities {
  network: { allowedHosts: string[] };
  filesystem: { allowedPaths: Record<string, string>; readOnly: boolean };
  memory: { maxPages: number };
  tools: { allowed: string[]; denied: string[] };
  timeoutMs: number;
}

// ── SandboxStatus ───────────────────────────────────────────────────

interface SandboxStatusProps {
  agentId: string;
  sandboxed: boolean;
}

export function SandboxStatus(props: SandboxStatusProps) {
  return (
    <div style={{ display: "inline-flex", "align-items": "center", gap: t.space.xs }}>
      <Badge variant={props.sandboxed ? "success" : "default"}>
        {props.sandboxed ? "Sandboxed" : "Unsandboxed"}
      </Badge>
      <Show when={props.sandboxed}>
        <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>
          {props.agentId}
        </span>
      </Show>
    </div>
  );
}

// ── CapabilityEditor ────────────────────────────────────────────────

interface CapabilityEditorProps {
  capabilities: AgentCapabilities;
  onChange: (caps: AgentCapabilities) => void;
}

export function CapabilityEditor(props: CapabilityEditorProps) {
  const [networkEnabled, setNetworkEnabled] = createSignal(
    props.capabilities.network.allowedHosts.length > 0,
  );
  const [fsEnabled, setFsEnabled] = createSignal(
    Object.keys(props.capabilities.filesystem.allowedPaths).length > 0,
  );
  const [toolsEnabled, setToolsEnabled] = createSignal(
    props.capabilities.tools.allowed.includes("*") ||
      props.capabilities.tools.allowed.length > 0,
  );
  const [maxPages, setMaxPages] = createSignal(
    String(props.capabilities.memory.maxPages),
  );
  const [timeoutMs, setTimeoutMs] = createSignal(
    String(props.capabilities.timeoutMs),
  );

  function emit() {
    const caps: AgentCapabilities = {
      network: {
        allowedHosts: networkEnabled() ? props.capabilities.network.allowedHosts : [],
      },
      filesystem: {
        allowedPaths: fsEnabled() ? props.capabilities.filesystem.allowedPaths : {},
        readOnly: props.capabilities.filesystem.readOnly,
      },
      memory: {
        maxPages: Math.max(1, parseInt(maxPages(), 10) || 256),
      },
      tools: {
        allowed: toolsEnabled() ? props.capabilities.tools.allowed : [],
        denied: toolsEnabled() ? props.capabilities.tools.denied : ["*"],
      },
      timeoutMs: Math.max(1000, parseInt(timeoutMs(), 10) || 30000),
    };
    props.onChange(caps);
  }

  const labelStyle = {
    "font-size": t.font.sizeSm,
    color: t.color.textMuted,
    "font-weight": t.font.weightBold,
    "text-transform": "uppercase" as const,
    "letter-spacing": "0.05em",
  };

  return (
    <Card title="Sandbox Capabilities">
      <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>

        {/* Network access */}
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.xs }}>
          <span style={labelStyle}>Network Access</span>
          <Toggle
            checked={networkEnabled()}
            onChange={(v) => { setNetworkEnabled(v); emit(); }}
            label="Allow outbound network requests"
          />
          <Show when={networkEnabled()}>
            <div style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>
              Allowed hosts:&nbsp;
              <For each={props.capabilities.network.allowedHosts}>
                {(host) => (
                  <span style={{ "margin-right": t.space.xs, color: t.color.text }}>
                    {host}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Filesystem access */}
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.xs }}>
          <span style={labelStyle}>Filesystem Access</span>
          <Toggle
            checked={fsEnabled()}
            onChange={(v) => { setFsEnabled(v); emit(); }}
            label="Allow filesystem access"
          />
          <Show when={fsEnabled()}>
            <div style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>
              Read-only: {props.capabilities.filesystem.readOnly ? "yes" : "no"}
            </div>
          </Show>
        </div>

        {/* Tool access */}
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.xs }}>
          <span style={labelStyle}>Tool Access</span>
          <Toggle
            checked={toolsEnabled()}
            onChange={(v) => { setToolsEnabled(v); emit(); }}
            label="Allow tool execution"
          />
          <Show when={toolsEnabled()}>
            <div style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>
              Allowed: {props.capabilities.tools.allowed.join(", ") || "none"}
            </div>
          </Show>
        </div>

        {/* Memory limit */}
        <Input
          label="Memory limit (pages, 1 page = 64 KB)"
          type="number"
          value={maxPages()}
          onInput={(e) => { setMaxPages(e.currentTarget.value); emit(); }}
        />

        {/* Timeout */}
        <Input
          label="Timeout (ms)"
          type="number"
          value={timeoutMs()}
          onInput={(e) => { setTimeoutMs(e.currentTarget.value); emit(); }}
        />
      </div>
    </Card>
  );
}
