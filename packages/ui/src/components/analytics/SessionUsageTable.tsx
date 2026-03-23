import { type Component, For, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";
import { setStore } from "../../stores/app";
import type { SessionUsage } from "../../stores/usage-actions";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  return usd < 0.000001 ? "—" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(4)}`;
}

// Rough cost estimate: default Anthropic rates ($3 in / $15 out per MTok)
function estimateCost(input: number, output: number): number {
  return (input * 3.0 + output * 15.0) / 1_000_000;
}

function truncate(s: string, n = 12): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

interface Props {
  sessions: SessionUsage[];
}

export const SessionUsageTable: Component<Props> = (props) => {
  const sorted = () =>
    [...props.sessions].sort((a, b) => b.totalTokens - a.totalTokens);

  function handleRowClick(sessionId: string): void {
    setStore("session", "id", sessionId);
    setStore("ui", "tab", "chat");
  }

  const thStyle = {
    padding: `${t.space.xs} ${t.space.sm}`,
    "text-align": "left" as const,
    "font-size": t.font.sizeSm,
    color: t.color.textMuted,
    "font-weight": t.font.weightBold,
    "text-transform": "uppercase" as const,
    "letter-spacing": "0.05em",
    "border-bottom": `1px solid ${t.color.border}`,
    "white-space": "nowrap" as const,
  };

  const tdStyle = {
    padding: `${t.space.xs} ${t.space.sm}`,
    "font-size": t.font.sizeMd,
    color: t.color.text,
    "border-bottom": `1px solid ${t.color.border}`,
    "white-space": "nowrap" as const,
  };

  return (
    <div>
      <Show when={props.sessions.length === 0}>
        <p style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.xl }}>
          No session usage data yet.
        </p>
      </Show>
      <Show when={props.sessions.length > 0}>
        <div style={{ "overflow-x": "auto" }}>
          <table style={{ width: "100%", "border-collapse": "collapse", "font-family": t.font.family }}>
            <thead>
              <tr>
                <th style={thStyle}>Session</th>
                <th style={thStyle}>Agent</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Input</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Output</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Total</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              <For each={sorted()}>
                {(row) => (
                  <tr
                    style={{ cursor: "pointer", transition: `background ${t.transition.fast}` }}
                    onClick={() => handleRowClick(row.sessionId)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = t.color.bgHover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                  >
                    <td style={tdStyle}>
                      <span style={{ "font-family": t.font.familyMono, "font-size": t.font.sizeSm, color: t.color.accent }}>
                        {truncate(row.sessionId)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: t.color.textMuted }}>
                      {truncate(row.agentId, 16)}
                    </td>
                    <td style={{ ...tdStyle, "text-align": "right" as const, color: t.color.info }}>
                      {fmtTokens(row.inputTokens)}
                    </td>
                    <td style={{ ...tdStyle, "text-align": "right" as const, color: t.color.success }}>
                      {fmtTokens(row.outputTokens)}
                    </td>
                    <td style={{ ...tdStyle, "text-align": "right" as const, "font-weight": t.font.weightBold }}>
                      {fmtTokens(row.totalTokens)}
                    </td>
                    <td style={{ ...tdStyle, "text-align": "right" as const, color: t.color.warning }}>
                      {fmtCost(estimateCost(row.inputTokens, row.outputTokens))}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
};
