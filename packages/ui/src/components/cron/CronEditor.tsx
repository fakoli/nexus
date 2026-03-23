import { createSignal, For, onMount, Show } from "solid-js";
import { store } from "../../stores/app";
import { loadAgents } from "../../stores/agent-actions";
import { createCronJob, updateCronJob } from "../../stores/cron-actions";
import { Button, Input, Select, Modal } from "../../design/components";
import { tokens as t } from "../../design/tokens";
import type { CronJob } from "../../gateway/types";

interface CronEditorProps {
  job?: CronJob;
  onClose: () => void;
}

const SCHEDULE_EXAMPLES = [
  "*/5 * * * *   — every 5 minutes",
  "0 * * * *     — every hour",
  "0 9 * * 1-5   — 9am Mon-Fri",
  "@every 1h     — every 1 hour",
  "@daily        — once a day at midnight",
];

const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

const CRON_RE = /^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|@every\s+\d+[smh]|(\S+\s+){4}\S+)$/;

function validateSchedule(s: string): string | null {
  if (!s.trim()) return "Schedule is required";
  if (!CRON_RE.test(s.trim())) return "Invalid schedule — use cron syntax or @every / @daily etc.";
  return null;
}

export default function CronEditor(props: CronEditorProps) {
  const isEdit = () => Boolean(props.job);

  const [jobId, setJobId]         = createSignal(props.job?.id ?? "");
  const [schedule, setSchedule]   = createSignal(props.job?.schedule ?? "");
  const [agentId, setAgentId]     = createSignal(props.job?.agentId ?? "");
  const [message, setMessage]     = createSignal(props.job?.prompt ?? "");
  const [timezone, setTimezone]   = createSignal("UTC");
  const [enabled, setEnabled]     = createSignal(props.job?.enabled ?? true);
  const [schedErr, setSchedErr]   = createSignal<string | undefined>(undefined);
  const [saving, setSaving]       = createSignal(false);

  onMount(() => { void loadAgents(); });

  const agentOptions = () => [
    { value: "", label: "— select agent —" },
    ...store.agents.map((a) => ({ value: a.id, label: a.name || a.id })),
  ];

  async function handleSave() {
    const err = validateSchedule(schedule());
    setSchedErr(err ?? undefined);
    if (err) return;
    if (!agentId()) return;
    if (!message().trim()) return;

    setSaving(true);
    if (isEdit() && props.job) {
      await updateCronJob(props.job.id, {
        schedule: schedule(),
        prompt: message(),
        enabled: enabled(),
      });
    } else {
      await createCronJob({
        id: jobId().trim() || undefined,
        name: jobId().trim(),
        schedule: schedule(),
        agentId: agentId(),
        prompt: message(),
        enabled: enabled(),
      });
    }
    setSaving(false);
    props.onClose();
  }

  const fieldGap: import("solid-js").JSX.CSSProperties = { display: "flex", "flex-direction": "column", gap: t.space.md };
  const labelStyle: import("solid-js").JSX.CSSProperties = {
    display: "block", "margin-bottom": t.space.xs, "font-size": t.font.sizeSm,
    color: t.color.textMuted, "font-weight": t.font.weightBold,
    "text-transform": "uppercase", "letter-spacing": "0.05em",
  };

  return (
    <Modal
      title={isEdit() ? `Edit Job: ${props.job!.id}` : "Create Cron Job"}
      open={true}
      onClose={props.onClose}
      actions={<>
        <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
        <Button loading={saving()} onClick={() => void handleSave()}>
          {isEdit() ? "Save" : "Create"}
        </Button>
      </>}
    >
      <div style={fieldGap}>
        <Show when={!isEdit()}>
          <Input label="Job ID (optional)" placeholder="e.g. daily-summary"
            value={jobId()} onInput={(e) => setJobId(e.currentTarget.value)} />
        </Show>

        <div>
          <label style={labelStyle}>Schedule</label>
          <input
            placeholder="*/5 * * * *"
            value={schedule()}
            onInput={(e) => { setSchedule(e.currentTarget.value); setSchedErr(undefined); }}
            style={{ width: "100%", background: t.color.bgInput, border: `1px solid ${schedErr() ? t.color.error : t.color.border}`,
              "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono,
              "font-size": t.font.sizeMd, padding: `7px ${t.space.sm}`, outline: "none", "box-sizing": "border-box" }}
          />
          <Show when={schedErr()}>
            <span style={{ display: "block", "margin-top": t.space.xs, "font-size": t.font.sizeSm, color: t.color.error }}>{schedErr()}</span>
          </Show>
          <div style={{ "margin-top": t.space.xs }}>
            <For each={SCHEDULE_EXAMPLES}>{(ex) => (
              <div style={{ "font-size": t.font.sizeSm, color: t.color.textDim, "font-family": t.font.familyMono }}>{ex}</div>
            )}</For>
          </div>
        </div>

        <Select label="Agent" value={agentId()} options={agentOptions()}
          onChange={(e) => setAgentId(e.currentTarget.value)} />

        <Select label="Timezone" value={timezone()} options={TIMEZONE_OPTIONS}
          onChange={(e) => setTimezone(e.currentTarget.value)} />

        <div>
          <label style={labelStyle}>Message / Prompt</label>
          <textarea
            placeholder="What should the agent do on each run?"
            value={message()}
            onInput={(e) => setMessage(e.currentTarget.value)}
            rows={3}
            style={{ width: "100%", background: t.color.bgInput, border: `1px solid ${t.color.border}`,
              "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.family,
              "font-size": t.font.sizeMd, padding: `7px ${t.space.sm}`, outline: "none",
              resize: "vertical", "box-sizing": "border-box" }}
          />
        </div>

        <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
          <input type="checkbox" id="cron-enabled" checked={enabled()} onChange={(e) => setEnabled(e.currentTarget.checked)} />
          <label for="cron-enabled" style={{ color: t.color.text, "font-size": t.font.sizeMd, cursor: "pointer" }}>
            Enabled
          </label>
        </div>
      </div>
    </Modal>
  );
}
