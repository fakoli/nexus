import { createSignal, For, onMount, Show } from "solid-js";
import { store } from "../../stores/app";
import { loadCronJobs, deleteCronJob, runCronJob, updateCronJob } from "../../stores/cron-actions";
import { Button, Badge, Modal } from "../../design/components";
import { tokens as t } from "../../design/tokens";
import type { CronJob } from "../../gateway/types";
import CronEditor from "./CronEditor";
import CronHistory from "./CronHistory";

function formatTs(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export default function CronList() {
  const [showEditor, setShowEditor]       = createSignal(false);
  const [editingJob, setEditingJob]       = createSignal<CronJob | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [selectedJobId, setSelectedJobId] = createSignal<string | null>(null);
  const [running, setRunning]             = createSignal<string | null>(null);

  onMount(() => { void loadCronJobs(); });

  async function handleRunNow(id: string) {
    setRunning(id);
    await runCronJob(id);
    setRunning(null);
    await loadCronJobs();
  }

  async function handleToggle(job: CronJob) {
    await updateCronJob(job.id, { enabled: !job.enabled });
  }

  async function handleDelete(id: string) {
    await deleteCronJob(id);
    setConfirmDelete(null);
    if (selectedJobId() === id) setSelectedJobId(null);
  }

  const thStyle = {
    padding: `${t.space.sm} ${t.space.md}`, "text-align": "left" as const,
    "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold,
    "text-transform": "uppercase" as const, "letter-spacing": "0.05em",
    "border-bottom": `1px solid ${t.color.border}`,
  };
  const tdStyle = {
    padding: `${t.space.sm} ${t.space.md}`, "font-size": t.font.sizeMd,
    color: t.color.text, "border-bottom": `1px solid ${t.color.border}`,
    "vertical-align": "middle" as const,
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md, padding: t.space.md, height: "100%", "overflow-y": "auto" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "flex-shrink": "0" }}>
        <span style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text }}>Cron Jobs</span>
        <Button onClick={() => { setEditingJob(undefined); setShowEditor(true); }}>+ Create Job</Button>
      </div>

      <Show when={store.cron.jobs.length === 0}>
        <div style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.xxl }}>
          No cron jobs configured. Create one to get started.
        </div>
      </Show>

      <Show when={store.cron.jobs.length > 0}>
        <div style={{ background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.lg, overflow: "hidden" }}>
          <table style={{ width: "100%", "border-collapse": "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Job</th>
                <th style={thStyle}>Schedule</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Next Run</th>
                <th style={thStyle}>Last Run</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={store.cron.jobs}>{(job) => (
                <>
                  <tr style={{ cursor: "pointer", background: selectedJobId() === job.id ? t.color.bgHover : "transparent" }}
                    onClick={() => setSelectedJobId(selectedJobId() === job.id ? null : job.id)}>
                    <td style={tdStyle}>
                      <div style={{ "font-weight": t.font.weightMedium }}>{job.name || job.id}</div>
                      <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{job.id}</div>
                    </td>
                    <td style={tdStyle}>
                      <code style={{ "font-family": t.font.familyMono, "font-size": t.font.sizeSm, color: t.color.info }}>{job.schedule}</code>
                    </td>
                    <td style={tdStyle}><span style={{ color: t.color.textMuted }}>{job.agentId}</span></td>
                    <td style={tdStyle} onClick={(e) => { e.stopPropagation(); void handleToggle(job); }}>
                      <Badge variant={job.enabled ? "success" : "default"}>{job.enabled ? "enabled" : "disabled"}</Badge>
                    </td>
                    <td style={tdStyle}><span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{formatTs(job.nextRun)}</span></td>
                    <td style={tdStyle}><span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{formatTs(job.lastRun)}</span></td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: t.space.xs }} onClick={(e) => e.stopPropagation()}>
                        <Button variant="secondary" style={{ "font-size": t.font.sizeSm, padding: "4px 8px" }}
                          loading={running() === job.id} onClick={() => void handleRunNow(job.id)}>Run</Button>
                        <Button variant="ghost" style={{ "font-size": t.font.sizeSm, padding: "4px 8px" }}
                          onClick={() => { setEditingJob(job); setShowEditor(true); }}>Edit</Button>
                        <Button variant="ghost" style={{ "font-size": t.font.sizeSm, color: t.color.error, padding: "4px 8px" }}
                          onClick={() => setConfirmDelete(job.id)}>Del</Button>
                      </div>
                    </td>
                  </tr>
                  <Show when={selectedJobId() === job.id}>
                    <tr><td colspan="7" style={{ padding: "0", "border-bottom": `1px solid ${t.color.border}` }}>
                      <CronHistory jobId={job.id} />
                    </td></tr>
                  </Show>
                </>
              )}</For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={showEditor()}>
        <CronEditor job={editingJob()} onClose={() => setShowEditor(false)} />
      </Show>

      <Modal title="Delete Cron Job" open={confirmDelete() !== null} onClose={() => setConfirmDelete(null)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button style={{ background: t.color.error }} onClick={() => void handleDelete(confirmDelete()!)}>Delete</Button>
        </>}>
        <p style={{ color: t.color.text }}>Delete job <strong>{confirmDelete()}</strong>? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
