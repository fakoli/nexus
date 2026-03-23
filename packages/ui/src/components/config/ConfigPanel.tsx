import { type Component, createSignal, createMemo, onMount, For, Show } from "solid-js";
import { store, setStore } from "../../stores/app";
import { loadConfig, saveConfig } from "../../stores/actions";
import { showToast } from "../shared/Toast";
import { tokens as t } from "../../design/tokens";
import { Button, Input, Select, Toggle, Badge } from "../../design/components";

type Section = "gateway" | "agent" | "security" | "channels";

interface SectionDef { id: Section; label: string; group: string; }

const SECTIONS: SectionDef[] = [
  { id: "gateway",  label: "Gateway",  group: "Server" },
  { id: "agent",    label: "AI Agent", group: "AI" },
  { id: "security", label: "Security", group: "Security" },
  { id: "channels", label: "Channels", group: "Channels" },
];

const str = (v: unknown, fb = "") => v != null ? String(v) : fb;
const bool = (v: unknown) => v === true || v === "true";

const field: Record<string, string | number> = { "margin-bottom": t.space.md };

const ConfigPanel: Component = () => {
  const [active, setActive] = createSignal<Section>("gateway");
  const [search, setSearch] = createSignal("");
  const [rawMode, setRawMode] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [showSecrets, setShowSecrets] = createSignal<Record<string, boolean>>({});

  onMount(() => loadConfig());

  const toggleSecret = (key: string) =>
    setShowSecrets(s => ({ ...s, [key]: !s[key] }));

  const filteredSections = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(s => s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q));
  });

  const doSave = async () => {
    if (saving()) return;
    setSaving(true);
    const s = active();
    try {
      if (s === "channels") {
        showToast("Channel config is managed via environment variables", "success");
        return;
      }
      await saveConfig(s, { ...store.config[s] as Record<string, unknown> });
      showToast(`${s.charAt(0).toUpperCase() + s.slice(1)} saved`, "success");
    } catch {
      showToast(`Failed to save ${s}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const SecretInput = (key: string, label: string) => {
    const visible = () => showSecrets()[key] ?? false;
    return (
      <div style={field}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": t.space.xs }}>
          <label style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "text-transform": "uppercase", "letter-spacing": "0.05em" }}>{label}</label>
          <button onClick={() => toggleSecret(key)} style={{ background: "none", border: "none", color: t.color.textMuted, cursor: "pointer", "font-size": t.font.sizeSm, padding: "0" }}>{visible() ? "hide" : "show"}</button>
        </div>
        <input type={visible() ? "text" : "password"} placeholder="••••••••" value={str(store.config.security[key])} onInput={(e) => setStore("config", "security", key, e.currentTarget.value)}
          style={{ width: "100%", background: t.color.bgInput, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono, "font-size": t.font.sizeMd, padding: `7px ${t.space.sm}`, outline: "none" }} />
      </div>
    );
  };

  const sectionLabel = (s: SectionDef) => {
    const isActive = () => active() === s.id;
    return (
      <button onClick={() => setActive(s.id)} style={{
        width: "100%", "text-align": "left", padding: `${t.space.sm} ${t.space.md}`,
        background: isActive() ? t.color.bgHover : "transparent",
        "border-left": isActive() ? `3px solid ${t.color.accent}` : "3px solid transparent",
        border: "none", "border-radius": `0 ${t.radius.md} ${t.radius.md} 0`,
        color: isActive() ? t.color.text : t.color.textMuted,
        cursor: "pointer", "font-family": t.font.family, "font-size": t.font.sizeMd,
        "font-weight": isActive() ? t.font.weightBold : t.font.weightNormal,
        transition: `all ${t.transition.normal}`,
      }}>{s.label}</button>
    );
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", background: t.color.bg, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: `${t.space.sm} ${t.space.md}`, "border-bottom": `1px solid ${t.color.border}`, background: t.color.bgSidebar, display: "flex", "align-items": "center", "justify-content": "space-between", "flex-shrink": "0" }}>
        <span style={{ "font-weight": t.font.weightBold, "font-size": t.font.sizeLg, color: t.color.text }}>Configuration</span>
        <div style={{ display: "flex", gap: t.space.sm, "align-items": "center" }}>
          <Badge variant={rawMode() ? "info" : "default"}>{rawMode() ? "JSON" : "Form"}</Badge>
          <Toggle checked={rawMode()} onChange={setRawMode} label="Raw JSON" />
        </div>
      </div>

      <div style={{ flex: "1", display: "flex", overflow: "hidden" }}>
        {/* Section list */}
        <div style={{ width: "160px", "min-width": "160px", "border-right": `1px solid ${t.color.border}`, display: "flex", "flex-direction": "column", "background": t.color.bgSidebar, overflow: "hidden" }}>
          <div style={{ padding: t.space.sm, "border-bottom": `1px solid ${t.color.border}`, "flex-shrink": "0" }}>
            <input type="text" placeholder="Filter…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)}
              style={{ width: "100%", background: t.color.bgInput, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-size": t.font.sizeMd, padding: `5px ${t.space.sm}`, outline: "none", "font-family": t.font.family }} />
          </div>
          <div style={{ flex: "1", overflow: "auto", padding: `${t.space.xs} 0` }}>
            <For each={filteredSections()}>
              {(s) => sectionLabel(s)}
            </For>
          </div>
        </div>

        {/* Form area */}
        <div style={{ flex: "1", overflow: "auto", padding: t.space.lg }}>
          <div style={{ "max-width": "480px" }}>
            <Show when={rawMode()} fallback={
              <>
                {/* Gateway */}
                <Show when={active() === "gateway"}>
                  <div style={field}>
                    <Input label="Port" type="number" value={str(store.config.gateway.port, "8080")}
                      onInput={(e) => setStore("config", "gateway", "port", Number(e.currentTarget.value))} />
                  </div>
                  <div style={field}>
                    <Select label="Bind Address" value={str(store.config.gateway.bind, "localhost")}
                      options={[{ value: "localhost", label: "localhost" }, { value: "0.0.0.0", label: "0.0.0.0 (all interfaces)" }, { value: "127.0.0.1", label: "127.0.0.1" }]}
                      onChange={(e) => setStore("config", "gateway", "bind", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Toggle checked={bool(store.config.gateway.verbose)} onChange={(v) => setStore("config", "gateway", "verbose", v)} label="Verbose logging" />
                  </div>
                </Show>

                {/* Agent */}
                <Show when={active() === "agent"}>
                  <div style={field}>
                    <Select label="Default Provider" value={str(store.config.agent.defaultProvider, "anthropic")}
                      options={[{ value: "anthropic", label: "Anthropic" }, { value: "openai", label: "OpenAI" }]}
                      onChange={(e) => setStore("config", "agent", "defaultProvider", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Input label="Default Model" value={str(store.config.agent.defaultModel)} placeholder="e.g. claude-3-5-sonnet-20241022"
                      onInput={(e) => setStore("config", "agent", "defaultModel", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Select label="Think Level" value={str(store.config.agent.thinkLevel, "none")}
                      options={[{ value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]}
                      onChange={(e) => setStore("config", "agent", "thinkLevel", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Input label="Temperature" type="number" value={str(store.config.agent.temperature, "0.7")} placeholder="0.0 – 1.0"
                      onInput={(e) => setStore("config", "agent", "temperature", Number(e.currentTarget.value))} />
                  </div>
                </Show>

                {/* Security */}
                <Show when={active() === "security"}>
                  {SecretInput("gatewayToken", "Gateway Token")}
                  <div style={field}>
                    <Select label="DM Policy" value={str(store.config.security.dmPolicy, "allow")}
                      options={[{ value: "allow", label: "Allow" }, { value: "deny", label: "Deny" }, { value: "review", label: "Review" }]}
                      onChange={(e) => setStore("config", "security", "dmPolicy", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Select label="Prompt Guard" value={str(store.config.security.promptGuard, "off")}
                      options={[{ value: "off", label: "Off" }, { value: "warn", label: "Warn" }, { value: "block", label: "Block" }]}
                      onChange={(e) => setStore("config", "security", "promptGuard", e.currentTarget.value)} />
                  </div>
                  <div style={field}>
                    <Input label="SSRF Allowlist" value={str(store.config.security.ssrfAllowlist)} placeholder="Comma-separated domains"
                      onInput={(e) => setStore("config", "security", "ssrfAllowlist", e.currentTarget.value)} />
                  </div>
                </Show>

                {/* Channels */}
                <Show when={active() === "channels"}>
                  <p style={{ "font-size": t.font.sizeMd, color: t.color.textMuted }}>Managed via TELEGRAM_BOT_TOKEN and DISCORD_BOT_TOKEN environment variables.</p>
                </Show>
              </>
            }>
              <textarea
                value={JSON.stringify(store.config[active() as keyof typeof store.config] ?? {}, null, 2)}
                onInput={(e) => { try { setStore("config", active(), JSON.parse(e.currentTarget.value) as Record<string, unknown>); } catch { /* keep typing */ } }}
                style={{ width: "100%", height: "320px", background: t.color.bgInput, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono, "font-size": t.font.sizeMd, padding: t.space.sm, outline: "none", resize: "vertical" }}
              />
            </Show>

            <div style={{ "margin-top": t.space.md }}>
              <Button onClick={doSave} loading={saving()}>Save</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;
