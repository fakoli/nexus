import { type Component, For, Show, createSignal, onMount } from "solid-js";
import { gateway } from "../../stores/app";
import { setTab } from "../../stores/actions";
import { tokens as t } from "../../design/tokens";
import { Badge, Card } from "../../design/components";
import type { Agent, CronJob, GatewayStatus, UsageSummary } from "../../gateway/types";

// ── Stat card ─────────────────────────────────────────────────────────────────

const StatCard: Component<{ label: string; value: string; sub?: string; accent?: boolean }> = (p) => (
  <div style={{
    background: t.color.bgCard, border: `1px solid ${t.color.border}`,
    "border-radius": t.radius.lg, padding: t.space.md, display: "flex",
    "flex-direction": "column", gap: t.space.xs,
  }}>
    <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "text-transform": "uppercase", "letter-spacing": "0.06em", "font-weight": t.font.weightBold }}>{p.label}</div>
    <div style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: p.accent ? t.color.accent : t.color.text, "font-family": t.font.familyMono }}>{p.value}</div>
    <Show when={p.sub}><div style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>{p.sub}</div></Show>
  </div>
);

// ── Security score bar ────────────────────────────────────────────────────────

const ScoreBar: Component<{ score: number }> = (p) => {
  const color = () => p.score >= 80 ? t.color.success : p.score >= 50 ? t.color.warning : t.color.error;
  return (
    <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
      <div style={{ flex: "1", height: "6px", background: t.color.bgHover, "border-radius": t.radius.full, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${p.score}%`, background: color(), "border-radius": t.radius.full, transition: `width ${t.transition.slow}` }} />
      </div>
      <span style={{ "font-size": t.font.sizeSm, "font-weight": t.font.weightBold, color: color(), "font-family": t.font.familyMono, "min-width": "32px", "text-align": "right" }}>{p.score}/100</span>
    </div>
  );
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

const Dashboard: Component = () => {
  const [status, setStatus] = createSignal<GatewayStatus | null>(null);
  const [usage, setUsage] = createSignal<UsageSummary | null>(null);
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [cron, setCron] = createSignal<CronJob[]>([]);
  const [secScore, setSecScore] = createSignal<number | null>(null);
  const [recentMsgs, setRecentMsgs] = createSignal<Array<{ id: string; role: string; content: string; ts: number }>>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const [gw, us, ag, cr, sec, hist] = await Promise.allSettled([
        gateway.request("gateway.status", {}),
        gateway.request("usage.summary", {}),
        gateway.request("agents.list", {}),
        gateway.request("cron.list", {}),
        gateway.request("security.audit", {}),
        gateway.request("chat.history", { limit: 5 }),
      ]);

      if (gw.status === "fulfilled") setStatus(gw.value as unknown as GatewayStatus);
      if (us.status === "fulfilled") setUsage(us.value as unknown as UsageSummary);
      if (ag.status === "fulfilled") setAgents((ag.value as { agents?: Agent[] }).agents ?? []);
      if (cr.status === "fulfilled") setCron((cr.value as { jobs?: CronJob[] }).jobs ?? []);
      if (sec.status === "fulfilled") setSecScore(((sec.value as { score?: number }).score ?? 0));
      if (hist.status === "fulfilled") setRecentMsgs(((hist.value as { messages?: Array<{ id: string; role: string; content: string; timestamp: number }> }).messages ?? []).slice(-5).map(m => ({ id: m.id, role: m.role, content: m.content, ts: m.timestamp })));
    } finally {
      setLoading(false);
    }
  });

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtCost = (c: number) => `$${c.toFixed(4)}`;
  const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const nextCron = () => cron().filter(j => j.enabled && j.nextRun).sort((a, b) => (a.nextRun ?? 0) - (b.nextRun ?? 0))[0];

  return (
    <div style={{ height: "100%", overflow: "auto", padding: t.space.lg, display: "flex", "flex-direction": "column", gap: t.space.lg }}>

      {/* ── Status row ── */}
      <div style={{ display: "flex", "align-items": "center", gap: t.space.lg, "flex-wrap": "wrap" }}>
        <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
          <div style={{ width: "10px", height: "10px", "border-radius": t.radius.full, background: status() ? t.color.success : t.color.textDim, "box-shadow": status() ? `0 0 6px ${t.color.success}` : "none" }} />
          <span style={{ "font-size": t.font.sizeMd, "font-weight": t.font.weightBold, color: t.color.text }}>Gateway</span>
          <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{status() ? "online" : loading() ? "loading…" : "offline"}</span>
        </div>
        <Show when={status()}>
          <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>up {fmtUptime(status()!.uptime)}</span>
          <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>v{status()!.version}</span>
          <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{status()!.connectedClients} client{status()!.connectedClients !== 1 ? "s" : ""}</span>
        </Show>
        <div style={{ flex: "1" }} />
        <button onClick={() => setTab("debug")} style={{ background: "transparent", border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.textMuted, "font-family": t.font.family, "font-size": t.font.sizeSm, padding: `4px ${t.space.sm}`, cursor: "pointer" }}>Debug Console</button>
        <button onClick={() => setTab("logs")} style={{ background: "transparent", border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.textMuted, "font-family": t.font.family, "font-size": t.font.sizeSm, padding: `4px ${t.space.sm}`, cursor: "pointer" }}>Live Logs</button>
      </div>

      {/* ── Quick stats 2×2 ── */}
      <div style={{ display: "grid", "grid-template-columns": "repeat(2, 1fr)", gap: t.space.md }}>
        <StatCard label="Active Sessions" value={status() ? String(status()!.activeSessions) : "—"} sub="currently open" accent />
        <StatCard label="Total Messages" value={status() ? fmtTokens(status()!.totalMessages) : "—"} sub="all time" />
        <StatCard label="Token Usage" value={usage() ? `${fmtTokens(usage()!.totalTokens)}` : "—"} sub={usage() ? `${usage()!.totalRequests} requests` : undefined} />
        <StatCard label="Estimated Cost" value={usage() ? fmtCost(usage()!.totalCost) : "—"} sub="current period" />
      </div>

      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: t.space.md }}>

        {/* ── Recent activity ── */}
        <Card title="Recent Activity">
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <Show when={recentMsgs().length === 0}>
              <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>No recent messages.</span>
            </Show>
            <For each={recentMsgs()}>
              {(m) => (
                <div style={{ display: "flex", gap: t.space.sm, "align-items": "flex-start", "padding-bottom": "6px", "border-bottom": `1px solid ${t.color.border}` }}>
                  <Badge variant={m.role === "user" ? "info" : "default"}>{m.role}</Badge>
                  <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}</span>
                </div>
              )}
            </For>
          </div>
        </Card>

        {/* ── Agent summary ── */}
        <Card title="Agents">
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <Show when={agents().length === 0}>
              <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>No agents configured.</span>
            </Show>
            <For each={agents().slice(0, 5)}>
              {(a) => (
                <div style={{ display: "flex", "align-items": "center", gap: t.space.sm, "padding-bottom": "6px", "border-bottom": `1px solid ${t.color.border}` }}>
                  <div style={{ width: "7px", height: "7px", "border-radius": t.radius.full, background: t.color.success, "flex-shrink": "0" }} />
                  <span style={{ "font-size": t.font.sizeSm, color: t.color.text, "font-weight": t.font.weightMedium, flex: "1" }}>{a.name}</span>
                  <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim, "font-family": t.font.familyMono }}>{a.model}</span>
                </div>
              )}
            </For>
          </div>
        </Card>

        {/* ── Cron status ── */}
        <Card title="Cron">
          <div style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>Enabled jobs</span>
              <span style={{ "font-size": t.font.sizeSm, "font-weight": t.font.weightBold, color: t.color.accent, "font-family": t.font.familyMono }}>{cron().filter(j => j.enabled).length}</span>
            </div>
            <Show when={nextCron()}>
              <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>
                Next: <span style={{ color: t.color.text, "font-weight": t.font.weightMedium }}>{nextCron()!.name}</span>
                {" "}at <span style={{ "font-family": t.font.familyMono, color: t.color.info }}>{new Date(nextCron()!.nextRun!).toLocaleTimeString()}</span>
              </div>
            </Show>
            <Show when={!nextCron() && cron().length === 0}>
              <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>No jobs scheduled.</span>
            </Show>
          </div>
        </Card>

        {/* ── Security score ── */}
        <Card title="Security">
          <Show when={secScore() !== null} fallback={<span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>{loading() ? "Auditing…" : "Unavailable"}</span>}>
            <div style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
              <ScoreBar score={secScore()!} />
              <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>
                {secScore()! >= 80 ? "Good posture — no critical issues." : secScore()! >= 50 ? "Some recommendations available." : "Action required — review security settings."}
              </span>
            </div>
          </Show>
        </Card>

      </div>
    </div>
  );
};

export default Dashboard;
