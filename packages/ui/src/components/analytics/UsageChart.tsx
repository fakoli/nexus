import { type Component, createSignal, For, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";
import type { DailyUsage } from "../../stores/usage-actions";

const W = 600, H = 200;
const PAD = { top: 16, right: 16, bottom: 48, left: 56 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${parseInt(month)}/${parseInt(day)}`;
}
interface TooltipState { x: number; y: number; day: DailyUsage }
interface Props { days: DailyUsage[] }

export const UsageChart: Component<Props> = (props) => {
  const [tip, setTip] = createSignal<TooltipState | null>(null);

  const maxTotal = () => Math.max(...props.days.map((d) => d.totalTokens), 1);

  const barW = () => props.days.length > 0 ? INNER_W / props.days.length : INNER_W;
  const BAR_GAP = 2;

  const yTicks = () => {
    const mx = maxTotal();
    const step = mx <= 10 ? 2 : mx <= 100 ? 20 : mx <= 1000 ? 200 : Math.ceil(mx / 5 / 1000) * 1000;
    const ticks: number[] = [];
    for (let v = 0; v <= mx; v += step) ticks.push(v);
    return ticks;
  };

  const toY = (v: number) => INNER_H - (v / maxTotal()) * INNER_H;

  return (
    <div style={{ position: "relative" }}>
      <Show when={props.days.length === 0}>
        <p style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.xl }}>
          No time-series data yet.
        </p>
      </Show>
      <Show when={props.days.length > 0}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
          onMouseLeave={() => setTip(null)}
        >
          {/* Y-axis grid lines */}
          <For each={yTicks()}>
            {(v) => {
              const y = PAD.top + toY(v);
              return (
                <>
                  <line x1={PAD.left} x2={PAD.left + INNER_W} y1={y} y2={y}
                    stroke={t.color.border} stroke-width="1" stroke-dasharray="3 3" />
                  <text x={PAD.left - 6} y={y + 4} text-anchor="end"
                    font-size="10" fill={t.color.textMuted} font-family={t.font.family}>
                    {fmtK(v)}
                  </text>
                </>
              );
            }}
          </For>

          {/* Bars */}
          <For each={props.days}>
            {(day, i) => {
              const bw = barW();
              const slotX = PAD.left + i() * bw;
              const halfGap = BAR_GAP / 2;
              const singleW = bw / 2 - halfGap - 1;
              const inH = () => (day.inputTokens / maxTotal()) * INNER_H;
              const outH = () => (day.outputTokens / maxTotal()) * INNER_H;

              return (
                <g
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect();
                    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, day });
                  }}
                >
                  {/* Input bar (blue) */}
                  <rect
                    x={slotX + halfGap}
                    y={PAD.top + INNER_H - inH()}
                    width={Math.max(singleW, 2)}
                    height={inH()}
                    fill={t.color.info}
                    opacity="0.85"
                    rx="2"
                  />
                  {/* Output bar (green) */}
                  <rect
                    x={slotX + bw / 2 + halfGap}
                    y={PAD.top + INNER_H - outH()}
                    width={Math.max(singleW, 2)}
                    height={outH()}
                    fill={t.color.success}
                    opacity="0.85"
                    rx="2"
                  />
                  {/* X-axis label */}
                  <text
                    x={slotX + bw / 2}
                    y={PAD.top + INNER_H + 16}
                    text-anchor="middle"
                    font-size="9"
                    fill={t.color.textMuted}
                    font-family={t.font.family}
                  >
                    {props.days.length <= 14 || i() % 3 === 0 ? shortDate(day.date) : ""}
                  </text>
                </g>
              );
            }}
          </For>

          {/* Axes */}
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + INNER_H} stroke={t.color.border} stroke-width="1" />
          <line x1={PAD.left} x2={PAD.left + INNER_W} y1={PAD.top + INNER_H} y2={PAD.top + INNER_H} stroke={t.color.border} stroke-width="1" />
        </svg>

        {/* Legend */}
        <div style={{ display: "flex", gap: t.space.md, "margin-top": t.space.sm, "font-size": t.font.sizeSm, color: t.color.textMuted }}>
          {([["info", "Input tokens"], ["success", "Output tokens"]] as const).map(([c, label]) => (
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: t.color[c], "border-radius": "2px", "margin-right": t.space.xs }} />{label}</span>
          ))}
        </div>

        {/* Hover tooltip */}
        <Show when={tip()}>
          {(tv) => (
            <div style={{ position: "absolute", top: `${tv().y - 60}px`, left: `${tv().x + 12}px`, background: t.color.bgHover, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, padding: `${t.space.xs} ${t.space.sm}`, "font-size": t.font.sizeSm, color: t.color.text, "pointer-events": "none", "z-index": "10", "white-space": "nowrap", "box-shadow": t.shadow.md }}>
              <div style={{ "font-weight": t.font.weightBold, "margin-bottom": "2px" }}>{tv().day.date}</div>
              <div style={{ color: t.color.info }}>In: {fmtK(tv().day.inputTokens)}</div>
              <div style={{ color: t.color.success }}>Out: {fmtK(tv().day.outputTokens)}</div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
};
