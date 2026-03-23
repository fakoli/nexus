import { createSignal, createMemo, Show } from "solid-js";
import type { JSX } from "solid-js";
import { store } from "../../stores/app";
import { updateAgent } from "../../stores/agent-actions";
import { Button, Input, Select, Toggle, Card } from "../../design/components";
import { tokens as t } from "../../design/tokens";

interface AgentEditorProps {
  agentId: string;
  onOpenBootstrap: () => void;
}

type Tab = "model" | "tuning" | "tools" | "bootstrap";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai",    label: "OpenAI" },
  { value: "google",    label: "Google" },
  { value: "groq",      label: "Groq" },
];

const THINK_LEVEL_OPTIONS = [
  { value: "none",   label: "None" },
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

const VERBOSE_OPTIONS = [
  { value: "false", label: "Off" },
  { value: "true",  label: "On" },
];

export default function AgentEditor(props: AgentEditorProps) {
  const agent = createMemo(() => store.agents.find((a) => a.id === props.agentId));

  const [tab, setTab]         = createSignal<Tab>("model");
  const [saving, setSaving]   = createSignal(false);

  // Model tab state
  const [provider, setProvider]     = createSignal(agent()?.provider ?? "anthropic");
  const [model, setModel]           = createSignal(agent()?.model ?? "");
  const [temperature, setTemperature] = createSignal("1");

  // Tuning tab state
  const [thinkLevel, setThinkLevel] = createSignal("none");
  const [verbose, setVerbose]       = createSignal("false");
  const [fastMode, setFastMode]     = createSignal(false);
  const [maxToolRounds, setMaxToolRounds] = createSignal("10");

  // Tools tab state
  const [allowList, setAllowList]   = createSignal("");
  const [denyList, setDenyList]     = createSignal("");

  async function saveModel() {
    setSaving(true);
    await updateAgent(props.agentId, {
      provider: provider(),
      model: model(),
      temperature: parseFloat(temperature()),
    });
    setSaving(false);
  }

  async function saveTuning() {
    setSaving(true);
    await updateAgent(props.agentId, {
      thinkLevel: thinkLevel(),
      verbose: verbose() === "true",
      fastMode: fastMode(),
      maxToolRounds: parseInt(maxToolRounds(), 10),
    });
    setSaving(false);
  }

  async function saveTools() {
    setSaving(true);
    const allow = allowList().split(",").map((s) => s.trim()).filter(Boolean);
    const deny  = denyList().split(",").map((s) => s.trim()).filter(Boolean);
    await updateAgent(props.agentId, { toolPolicy: { allow, deny } });
    setSaving(false);
  }

  const tabStyle = (active: boolean): JSX.CSSProperties => ({
    padding: `${t.space.sm} ${t.space.md}`,
    cursor: "pointer",
    "font-size": t.font.sizeMd,
    "font-weight": t.font.weightMedium,
    color: active ? t.color.accent : t.color.textMuted,
    background: "transparent",
    border: "none",
    "border-bottom": `2px solid ${active ? t.color.accent : "transparent"}`,
    transition: `color ${t.transition.normal}`,
  });

  return (
    <Show when={agent()} fallback={<div style={{ padding: t.space.lg, color: t.color.textMuted }}>Select an agent to edit.</div>}>
      <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>
        <div style={{ padding: `${t.space.md} ${t.space.lg}`, "border-bottom": `1px solid ${t.color.border}`, "flex-shrink": "0" }}>
          <div style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text }}>{props.agentId}</div>
          <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "margin-top": t.space.xs }}>{agent()?.provider} / {agent()?.model}</div>
        </div>

        <div style={{ display: "flex", "border-bottom": `1px solid ${t.color.border}`, "flex-shrink": "0" }}>
          {(["model", "tuning", "tools", "bootstrap"] as Tab[]).map((name) => (
            <button style={tabStyle(tab() === name)} onClick={() => setTab(name)}>
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ flex: "1", overflow: "auto", padding: t.space.lg }}>
          <Show when={tab() === "model"}>
            <Card title="Model Configuration">
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
                <Select label="Provider" value={provider()} options={PROVIDER_OPTIONS} onChange={(e) => setProvider(e.currentTarget.value)} />
                <Input label="Model" placeholder="e.g. claude-opus-4-5" value={model()} onInput={(e) => setModel(e.currentTarget.value)} />
                <div>
                  <label style={{ display: "block", "margin-bottom": t.space.xs, "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
                    Temperature: {temperature()}
                  </label>
                  <input type="range" min="0" max="2" step="0.1" value={temperature()} onInput={(e) => setTemperature(e.currentTarget.value)}
                    style={{ width: "100%", "accent-color": t.color.accent }} />
                </div>
                <Button loading={saving()} onClick={() => void saveModel()}>Save Model</Button>
              </div>
            </Card>
          </Show>

          <Show when={tab() === "tuning"}>
            <Card title="Tuning">
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
                <Select label="Think Level" value={thinkLevel()} options={THINK_LEVEL_OPTIONS} onChange={(e) => setThinkLevel(e.currentTarget.value)} />
                <Select label="Verbose" value={verbose()} options={VERBOSE_OPTIONS} onChange={(e) => setVerbose(e.currentTarget.value)} />
                <Toggle label="Fast Mode" checked={fastMode()} onChange={setFastMode} />
                <Input label="Max Tool Rounds" type="number" value={maxToolRounds()} onInput={(e) => setMaxToolRounds(e.currentTarget.value)} />
                <Button loading={saving()} onClick={() => void saveTuning()}>Save Tuning</Button>
              </div>
            </Card>
          </Show>

          <Show when={tab() === "tools"}>
            <Card title="Tool Policy">
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
                <Input label="Allow List (comma-separated)" placeholder="tool1, tool2" value={allowList()} onInput={(e) => setAllowList(e.currentTarget.value)} />
                <Input label="Deny List (comma-separated)" placeholder="tool3, tool4" value={denyList()} onInput={(e) => setDenyList(e.currentTarget.value)} />
                <Button loading={saving()} onClick={() => void saveTools()}>Save Tools</Button>
              </div>
            </Card>
          </Show>

          <Show when={tab() === "bootstrap"}>
            <Card title="Bootstrap Files">
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
                <p style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, margin: "0" }}>
                  Bootstrap files define the agent's identity, soul, tools awareness, and user context.
                </p>
                <Button onClick={props.onOpenBootstrap}>Open Bootstrap Editor</Button>
              </div>
            </Card>
          </Show>
        </div>
      </div>
    </Show>
  );
}
