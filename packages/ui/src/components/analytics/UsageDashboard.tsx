import { type Component, createSignal, onMount, Switch, Match } from "solid-js";
import { tokens as t } from "../../design/tokens";
import { Card } from "../../design/components";
import {
  loadUsageSummary,
  loadUsageBySession,
  loadUsageByModel,
  loadUsageTimeSeries,
  type CoreUsageSummary,
  type SessionUsage,
  type ModelUsage,
  type DailyUsage,
} from "../../stores/usage-actions";
import { CostBreakdown } from "./CostBreakdown";
import { UsageChart } from "./UsageChart";
import { SessionUsageTable } from "./SessionUsageTable";

type Tab = "model" | "session" | "time";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

// ── Summary card ──────────────────────────────────────────────────────────────

const SummaryCard: Component<{ label: string; value: string; sub?: string }> = (props) => (
  <Card style={{ flex: "1", "min-width": "140px" }}>
    <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "text-transform": "uppercase", "letter-spacing": "0.05em", "margin-bottom": t.space.xs }}>
      {props.label}
    </div>
    <div style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text }}>
      {props.value}
    </div>
    {props.sub && (
      <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "margin-top": "2px" }}>
        {props.sub}
      </div>
    )}
  </Card>
);

// ── Tab button ────────────────────────────────────────────────────────────────

const TabBtn: Component<{ label: string; active: boolean; onClick: () => void }> = (props) => (
  <button
    onClick={props.onClick}
    style={{
      background: "transparent",
      border: "none",
      "border-bottom": props.active ? `2px solid ${t.color.accent}` : "2px solid transparent",
      color: props.active ? t.color.accent : t.color.textMuted,
      "font-family": t.font.family,
      "font-size": t.font.sizeMd,
      "font-weight": props.active ? t.font.weightBold : t.font.weightNormal,
      padding: `${t.space.sm} ${t.space.md}`,
      cursor: "pointer",
      transition: `color ${t.transition.fast}, border-color ${t.transition.fast}`,
    }}
  >
    {props.label}
  </button>
);

// ── UsageDashboard ────────────────────────────────────────────────────────────

export const UsageDashboard: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>("model");
  const [summary, setSummary] = createSignal<CoreUsageSummary | null>(null);
  const [sessions, setSessions] = createSignal<SessionUsage[]>([]);
  const [models, setModels] = createSignal<ModelUsage[]>([]);
  const [days, setDays] = createSignal<DailyUsage[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const [sum, sess, mods, ts] = await Promise.all([
      loadUsageSummary(),
      loadUsageBySession(),
      loadUsageByModel(),
      loadUsageTimeSeries(),
    ]);
    setSummary(sum);
    setSessions(sess);
    setModels(mods);
    setDays(ts);
    setLoading(false);
  });

  const avgTokensPerSession = () => {
    const s = summary();
    const count = s?.sessionCount ?? 0;
    if (!s || count === 0) return "—";
    return fmtTokens(Math.round(s.totalTokens / count));
  };

  return (
    <div style={{ padding: t.space.lg, overflow: "auto", height: "100%", "box-sizing": "border-box" }}>
      <div style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text, "margin-bottom": t.space.lg }}>
        Usage Analytics
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: t.space.md, "flex-wrap": "wrap", "margin-bottom": t.space.lg }}>
        <SummaryCard
          label="Total Tokens"
          value={summary() ? fmtTokens(summary()!.totalTokens) : "—"}
          sub={summary()?.totalInputTokens != null
            ? `In: ${fmtTokens(summary()!.totalInputTokens!)} · Out: ${fmtTokens(summary()!.totalOutputTokens!)}`
            : undefined}
        />
        <SummaryCard label="Est. Cost" value={summary() ? fmtCost(summary()!.estimatedCostUsd ?? summary()!.totalCost) : "—"} />
        <SummaryCard label="Sessions" value={summary()?.sessionCount != null ? String(summary()!.sessionCount) : "—"} />
        <SummaryCard label="Avg / Session" value={avgTokensPerSession()} />
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", "border-bottom": `1px solid ${t.color.border}`, "margin-bottom": t.space.md }}>
        <TabBtn label="By Model" active={activeTab() === "model"} onClick={() => setActiveTab("model")} />
        <TabBtn label="By Session" active={activeTab() === "session"} onClick={() => setActiveTab("session")} />
        <TabBtn label="Over Time" active={activeTab() === "time"} onClick={() => setActiveTab("time")} />
      </div>

      {/* Tab content */}
      <Card>
        {loading() ? (
          <div style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, padding: t.space.lg, "text-align": "center" }}>
            Loading…
          </div>
        ) : (
          <Switch>
            <Match when={activeTab() === "model"}>
              <CostBreakdown models={models()} />
            </Match>
            <Match when={activeTab() === "session"}>
              <SessionUsageTable sessions={sessions()} />
            </Match>
            <Match when={activeTab() === "time"}>
              <UsageChart days={days()} />
            </Match>
          </Switch>
        )}
      </Card>
    </div>
  );
};
