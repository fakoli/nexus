/**
 * SessionTuning — collapsible per-session AI parameter panel.
 * Sits above ChatInput. Collapsed by default (progressive disclosure).
 * LukeW: most users never touch this; power users love it.
 */
import { type Component, createSignal, Show } from "solid-js";
import { tuningStore, setTuning, type ThinkLevel } from "../../stores/session-tuning";
import { tokens as t } from "../../design/tokens";
import { Toggle } from "../../design/components";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS = [
  { value: "claude-sonnet-4-6",           label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4",               label: "Claude Opus 4" },
  { value: "gpt-4o",                      label: "GPT-4o" },
  { value: "gpt-4o-mini",                 label: "GPT-4o Mini" },
  { value: "gemini-pro",                  label: "Gemini Pro" },
  { value: "llama3-70b-8192",             label: "Llama 3 70B (Groq)" },
];

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai",    label: "OpenAI" },
  { value: "google",    label: "Google" },
  { value: "groq",      label: "Groq" },
];

const THINK_LEVELS: { value: ThinkLevel; label: string }[] = [
  { value: "off",    label: "Off" },
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const selectStyle = {
  background: t.color.bgInput, border: `1px solid ${t.color.border}`,
  "border-radius": t.radius.md, color: t.color.text,
  "font-family": t.font.family, "font-size": t.font.sizeMd,
  padding: `5px ${t.space.sm}`, outline: "none", width: "100%",
} as const;

const labelStyle = {
  "font-size": t.font.sizeSm, color: t.color.textMuted,
  "font-weight": t.font.weightBold, "text-transform": "uppercase" as const,
  "letter-spacing": "0.05em", display: "block", "margin-bottom": "3px",
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

const SessionTuning: Component = () => {
  const [open, setOpen] = createSignal(false);

  const summaryLabel = () =>
    `${tuningStore.model} · ${tuningStore.provider}${tuningStore.fastMode ? " · fast" : ""}`;

  return (
    <div style={{
      "border-bottom": `1px solid ${t.color.border}`,
      background: t.color.bgSidebar,
      "flex-shrink": "0",
    }}>
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", "align-items": "center",
          gap: t.space.sm, padding: `6px ${t.space.md}`,
          background: "transparent", border: "none", cursor: "pointer",
          color: t.color.textMuted, "font-family": t.font.family,
          "font-size": t.font.sizeSm,
        }}
      >
        <span style={{
          display: "inline-block",
          transform: open() ? "rotate(90deg)" : "rotate(0deg)",
          transition: `transform ${t.transition.normal}`,
          "font-size": "10px", color: t.color.textDim,
        }}>▶</span>
        <span style={{ flex: "1", "text-align": "left", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {summaryLabel()}
        </span>
        <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim, "flex-shrink": "0" }}>
          AI Tuning
        </span>
      </button>

      {/* Expanded panel */}
      <Show when={open()}>
        <div style={{ padding: `${t.space.sm} ${t.space.md} ${t.space.md}` }}>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: t.space.sm, "margin-bottom": t.space.sm }}>
            {/* Model */}
            <div>
              <label style={labelStyle}>Model</label>
              <select value={tuningStore.model} onChange={(e) => setTuning("model", e.currentTarget.value)} style={selectStyle}>
                {MODELS.map(m => <option value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {/* Provider */}
            <div>
              <label style={labelStyle}>Provider</label>
              <select value={tuningStore.provider} onChange={(e) => setTuning("provider", e.currentTarget.value)} style={selectStyle}>
                {PROVIDERS.map(p => <option value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Think level */}
          <div style={{ "margin-bottom": t.space.sm }}>
            <label style={labelStyle}>Thinking</label>
            <div style={{ display: "flex", gap: "3px" }}>
              {THINK_LEVELS.map(lvl => (
                <button
                  onClick={() => setTuning("thinkLevel", lvl.value)}
                  style={{
                    flex: "1", padding: "4px 0", border: `1px solid ${tuningStore.thinkLevel === lvl.value ? t.color.accent : t.color.border}`,
                    "border-radius": t.radius.sm, background: tuningStore.thinkLevel === lvl.value ? t.color.accentDim : "transparent",
                    color: tuningStore.thinkLevel === lvl.value ? t.color.accent : t.color.textMuted,
                    cursor: "pointer", "font-family": t.font.family, "font-size": t.font.sizeSm,
                    "font-weight": tuningStore.thinkLevel === lvl.value ? t.font.weightBold : t.font.weightNormal,
                    transition: `all ${t.transition.fast}`,
                  }}
                >{lvl.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: t.space.sm, "margin-bottom": t.space.sm }}>
            {/* Temperature */}
            <div>
              <label style={labelStyle}>
                Temperature <span style={{ color: t.color.accent, "font-weight": t.font.weightBold }}>{tuningStore.temperature.toFixed(1)}</span>
              </label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={tuningStore.temperature}
                onInput={(e) => setTuning("temperature", parseFloat(e.currentTarget.value))}
                style={{ width: "100%", cursor: "pointer", "accent-color": t.color.accent }}
              />
            </div>
            {/* Max tokens */}
            <div>
              <label style={labelStyle}>Max Tokens</label>
              <input
                type="number" min="256" max="32768" step="256"
                value={tuningStore.maxTokens}
                onInput={(e) => setTuning("maxTokens", parseInt(e.currentTarget.value, 10) || 4096)}
                style={{ ...selectStyle, width: "100%" }}
              />
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: "flex", gap: t.space.lg }}>
            <Toggle checked={tuningStore.fastMode} onChange={(v) => setTuning("fastMode", v)} label="Fast mode" />
            <Toggle checked={tuningStore.verbose} onChange={(v) => setTuning("verbose", v)} label="Verbose" />
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SessionTuning;
