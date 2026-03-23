import { createEffect, For, Show } from "solid-js";
import { store } from "../../stores/app";
import { loadCronHistory } from "../../stores/cron-actions";
import { Badge } from "../../design/components";
import { tokens as t } from "../../design/tokens";
import type { CronRunHistory } from "../../gateway/types";

interface CronHistoryProps {
  jobId: string;
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function durationMs(run: CronRunHistory): string {
  if (!run.finishedAt) return "running…";
  const ms = (run.finishedAt - run.startedAt) * 1000;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusVariant(status: CronRunHistory["status"]): "success" | "error" | "info" {
  if (status === "success") return "success";
  if (status === "error") return "error";
  return "info";
}

export default function CronHistory(props: CronHistoryProps) {
  createEffect(() => {
    void loadCronHistory(props.jobId);
  });

  const jobHistory = () =>
    store.cron.history.filter((h) => h.jobId === props.jobId);

  const thStyle = {
    padding: `${t.space.xs} ${t.space.md}`, "text-align": "left" as const,
    "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold,
    "text-transform": "uppercase" as const, "letter-spacing": "0.05em",
    "border-bottom": `1px solid ${t.color.border}`,
  };
  const tdStyle = {
    padding: `${t.space.xs} ${t.space.md}`, "font-size": t.font.sizeSm,
    color: t.color.text, "border-bottom": `1px solid ${t.color.border}`,
    "vertical-align": "middle" as const,
  };

  return (
    <div style={{ background: t.color.bg, "border-top": `1px solid ${t.color.border}` }}>
      <div style={{ padding: `${t.space.sm} ${t.space.md}`, "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "border-bottom": `1px solid ${t.color.border}` }}>
        Run History — {props.jobId}
      </div>

      <Show when={jobHistory().length === 0}>
        <div style={{ padding: t.space.md, color: t.color.textDim, "font-size": t.font.sizeSm, "text-align": "center" }}>
          No runs recorded yet.
        </div>
      </Show>

      <Show when={jobHistory().length > 0}>
        <table style={{ width: "100%", "border-collapse": "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Run Time</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>Error</th>
            </tr>
          </thead>
          <tbody>
            <For each={jobHistory()}>{(run) => (
              <tr>
                <td style={tdStyle}>{formatTs(run.startedAt)}</td>
                <td style={tdStyle}>
                  <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                </td>
                <td style={{ ...tdStyle, "font-family": t.font.familyMono }}>{durationMs(run)}</td>
                <td style={{ ...tdStyle, color: t.color.error, "max-width": "320px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  <Show when={run.error} fallback={<span style={{ color: t.color.textDim }}>—</span>}>
                    {run.error}
                  </Show>
                </td>
              </tr>
            )}</For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
