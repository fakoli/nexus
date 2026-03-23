import { type Component, For, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";
import type { ModelUsage } from "../../stores/usage-actions";

// Provider pricing per million tokens (input / output)
const PRICING: Record<string, { input: number; output: number; label: string }> = {
  anthropic: { input: 3.00,  output: 15.00, label: "Anthropic" },
  openai:    { input: 5.00,  output: 15.00, label: "OpenAI"    },
  google:    { input: 0.35,  output: 1.05,  label: "Google"    },
  groq:      { input: 0.05,  output: 0.10,  label: "Groq"      },
  default:   { input: 3.00,  output: 15.00, label: "Unknown"   },
};

function providerLabel(p: string): string {
  return PRICING[p]?.label ?? p;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(4)}`;
}

interface Props { models: ModelUsage[] }

export const CostBreakdown: Component<Props> = (props) => {
  const sorted = () =>
    [...props.models].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const maxCost = () => Math.max(...props.models.map((m) => m.estimatedCostUsd), 0.000001);

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
      <Show when={props.models.length === 0}>
        <p style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.xl }}>
          No model usage data yet.
        </p>
      </Show>
      <Show when={props.models.length > 0}>
        <div style={{ "overflow-x": "auto" }}>
          <table style={{ width: "100%", "border-collapse": "collapse", "font-family": t.font.family }}>
            <thead>
              <tr>
                <th style={thStyle}>Provider / Model</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Input</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Output</th>
                <th style={{ ...thStyle, "min-width": "120px" }}>Relative</th>
                <th style={{ ...thStyle, "text-align": "right" as const }}>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              <For each={sorted()}>
                {(row) => {
                  const pct = () => (row.estimatedCostUsd / maxCost()) * 100;
                  return (
                    <tr>
                      <td style={tdStyle}>
                        <div style={{ "font-weight": t.font.weightBold }}>{row.model}</div>
                        <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>
                          {providerLabel(row.provider)}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, "text-align": "right" as const, color: t.color.info }}>
                        {fmtTokens(row.inputTokens)}
                      </td>
                      <td style={{ ...tdStyle, "text-align": "right" as const, color: t.color.success }}>
                        {fmtTokens(row.outputTokens)}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ position: "relative", height: "8px", background: t.color.border, "border-radius": t.radius.full, overflow: "hidden" }}>
                          <div style={{ position: "absolute", left: "0", top: "0", height: "100%", width: `${pct()}%`, background: t.color.accent, "border-radius": t.radius.full, transition: `width ${t.transition.slow}` }} />
                        </div>
                      </td>
                      <td style={{ ...tdStyle, "text-align": "right" as const, "font-weight": t.font.weightBold, color: t.color.warning }}>
                        {fmtCost(row.estimatedCostUsd)}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <div style={{ "margin-top": t.space.md, "font-size": t.font.sizeSm, color: t.color.textDim }}>
          Pricing reference (per MTok): Anthropic $3/$15 · OpenAI $5/$15 · Google $0.35/$1.05 · Groq $0.05/$0.10
        </div>
      </Show>
    </div>
  );
};
