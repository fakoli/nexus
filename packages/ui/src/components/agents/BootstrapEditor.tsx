import { createSignal, createEffect, Show } from "solid-js";
import type { JSX } from "solid-js";
import { loadBootstrapFile, saveBootstrapFile } from "../../stores/agent-actions";
import { Button, Badge } from "../../design/components";
import { tokens as t } from "../../design/tokens";

interface BootstrapEditorProps {
  agentId: string;
  onClose: () => void;
}

type FileName = "SOUL.md" | "IDENTITY.md" | "USER.md" | "TOOLS.md" | "AGENTS.md";

const FILES: FileName[] = ["SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "AGENTS.md"];

export default function BootstrapEditor(props: BootstrapEditorProps) {
  const [activeFile, setActiveFile]   = createSignal<FileName>("SOUL.md");
  const [content, setContent]         = createSignal("");
  const [preview, setPreview]         = createSignal(false);
  const [loading, setLoading]         = createSignal(false);
  const [saving, setSaving]           = createSignal(false);
  const [saved, setSaved]             = createSignal(false);

  async function loadFile(name: FileName) {
    setLoading(true);
    const text = await loadBootstrapFile(name, props.agentId || undefined);
    setContent(text ?? "");
    setLoading(false);
    setSaved(false);
  }

  createEffect(() => { void loadFile(activeFile()); });

  async function handleSave() {
    setSaving(true);
    await saveBootstrapFile(activeFile(), content(), props.agentId || undefined);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function switchFile(name: FileName) {
    setActiveFile(name);
    setPreview(false);
  }

  const tabStyle = (active: boolean): JSX.CSSProperties => ({
    padding: `${t.space.sm} ${t.space.md}`,
    cursor: "pointer",
    "font-size": t.font.sizeSm,
    "font-weight": t.font.weightMedium,
    color: active ? t.color.accent : t.color.textMuted,
    background: active ? t.color.bgHover : "transparent",
    border: "none",
    "border-bottom": `2px solid ${active ? t.color.accent : "transparent"}`,
    "white-space": "nowrap",
    transition: `all ${t.transition.normal}`,
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden", background: t.color.bg }}>
      {/* Header */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: `${t.space.md} ${t.space.lg}`, "border-bottom": `1px solid ${t.color.border}`, "flex-shrink": "0" }}>
        <span style={{ "font-size": t.font.sizeLg, "font-weight": t.font.weightBold, color: t.color.text }}>Bootstrap Files</span>
        <div style={{ display: "flex", gap: t.space.sm, "align-items": "center" }}>
          <Show when={saved()}><Badge variant="success">Saved</Badge></Show>
          <Button variant="secondary" onClick={() => setPreview(!preview())}>{preview() ? "Raw" : "Preview"}</Button>
          <Button loading={saving()} onClick={() => void handleSave()}>Save</Button>
          <Button variant="ghost" onClick={props.onClose}>Close</Button>
        </div>
      </div>

      {/* File tabs */}
      <div style={{ display: "flex", "border-bottom": `1px solid ${t.color.border}`, "overflow-x": "auto", "flex-shrink": "0" }}>
        {FILES.map((name) => (
          <button style={tabStyle(activeFile() === name)} onClick={() => switchFile(name)}>
            {name}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <Show when={loading()}>
        <div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", color: t.color.textMuted }}>
          Loading…
        </div>
      </Show>

      <Show when={!loading()}>
        <div style={{ flex: "1", display: "flex", overflow: "hidden" }}>
          {/* Raw editor — always present; hidden in pure-preview mode */}
          <Show when={!preview()}>
            <textarea
              value={content()}
              onInput={(e) => setContent(e.currentTarget.value)}
              spellcheck={false}
              style={{
                flex: "1",
                resize: "none",
                background: t.color.bgInput,
                color: t.color.text,
                "font-family": t.font.familyMono,
                "font-size": t.font.sizeMd,
                "line-height": t.font.lineHeight,
                border: "none",
                outline: "none",
                padding: t.space.lg,
                "overflow-y": "auto",
              }}
            />
          </Show>

          {/* Preview pane */}
          <Show when={preview()}>
            <div style={{
              flex: "1",
              overflow: "auto",
              padding: t.space.lg,
              color: t.color.text,
              "font-family": t.font.family,
              "font-size": t.font.sizeMd,
              "line-height": t.font.lineHeight,
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}>
              <Show when={content()} fallback={<span style={{ color: t.color.textDim }}>No content.</span>}>
                {content()}
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Footer: file info */}
      <div style={{ "flex-shrink": "0", padding: `${t.space.xs} ${t.space.lg}`, "border-top": `1px solid ${t.color.border}`, "font-size": t.font.sizeSm, color: t.color.textDim, display: "flex", gap: t.space.md }}>
        <span>{activeFile()}</span>
        <span>{content().split("\n").length} lines</span>
        <span>{content().length} chars</span>
      </div>
    </div>
  );
}
