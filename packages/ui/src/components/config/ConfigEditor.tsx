import { Component, createSignal, onMount } from "solid-js";
import { store } from "../../stores/app";
import { loadConfig, saveConfig } from "../../stores/actions";
import { showToast } from "../shared/Toast";

type Section = "gateway" | "agent" | "security";

const inp = { background: "#1a1a2e", border: "1px solid #3a3a5c", "border-radius": "6px", color: "#e0e0e0", "font-size": "13px", padding: "7px 10px", width: "100%", "box-sizing": "border-box" as const, outline: "none", "font-family": "inherit" };
const lbl = { "font-size": "11px", color: "#888", "font-weight": "600" as const, "text-transform": "uppercase" as const, "letter-spacing": "0.05em", display: "block", "margin-bottom": "5px" };
const field = { "margin-bottom": "16px" };

const str = (v: unknown, fb = "") => v != null ? String(v) : fb;
const bool = (v: unknown) => v === true || v === "true";

const ConfigEditor: Component = () => {
  const [tab, setTab] = createSignal<Section>("gateway");
  const [saving, setSaving] = createSignal(false);

  onMount(() => loadConfig());

  const doSave = async () => {
    if (saving()) return;
    setSaving(true);
    const s = tab();
    try {
      await saveConfig(s, { ...store.config[s] });
      showToast(`${s.charAt(0).toUpperCase() + s.slice(1)} saved`, "success");
    } catch {
      showToast(`Failed to save ${s}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const TabBtn = (s: Section, label: string) => {
    const active = () => tab() === s;
    return (
      <button onClick={() => setTab(s)} style={{ background: "transparent", border: "none", "border-bottom": active() ? "2px solid #4a9eff" : "2px solid transparent", color: active() ? "#4a9eff" : "#888", cursor: "pointer", "font-size": "13px", "font-weight": active() ? "600" : "400", padding: "9px 16px 7px", "font-family": "inherit" }}>
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", background: "#1a1a2e", color: "#e0e0e0", "font-family": "system-ui, sans-serif", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", "border-bottom": "1px solid #2a2a45", background: "#13132a", "font-weight": "600", "font-size": "15px", color: "#c0c0e0", "flex-shrink": "0" }}>
        Configuration
      </div>
      <div style={{ display: "flex", "border-bottom": "1px solid #2a2a45", background: "#13132a", "flex-shrink": "0" }}>
        {TabBtn("gateway", "Gateway")}
        {TabBtn("agent", "Agent")}
        {TabBtn("security", "Security")}
      </div>

      <div style={{ flex: "1", overflow: "auto", padding: "24px 28px" }}>
        <div style={{ background: "#252542", "border-radius": "10px", padding: "20px 22px", "max-width": "480px" }}>

          {/* Gateway */}
          {tab() === "gateway" && <>
            <div style={field}><label style={lbl}>Port</label>
              <input type="number" style={inp} value={Number(store.config.gateway.port ?? 8080)} onInput={(e) => store.config.gateway.port = Number(e.currentTarget.value)} /></div>
            <div style={field}><label style={lbl}>Bind Address</label>
              <select style={inp} value={str(store.config.gateway.bind, "localhost")} onChange={(e) => store.config.gateway.bind = e.currentTarget.value}>
                <option value="localhost">localhost</option>
                <option value="0.0.0.0">0.0.0.0 (all interfaces)</option>
                <option value="127.0.0.1">127.0.0.1</option>
              </select></div>
            <div style={{ ...field, display: "flex", "align-items": "center", gap: "10px" }}>
              <input type="checkbox" id="verbose" checked={bool(store.config.gateway.verbose)} onChange={(e) => store.config.gateway.verbose = e.currentTarget.checked} style={{ width: "16px", height: "16px", "accent-color": "#4a9eff" }} />
              <label for="verbose" style={{ "font-size": "13px", color: "#ccc", cursor: "pointer" }}>Verbose logging</label>
            </div>
          </>}

          {/* Agent */}
          {tab() === "agent" && <>
            <div style={field}><label style={lbl}>Default Provider</label>
              <select style={inp} value={str(store.config.agent.defaultProvider, "anthropic")} onChange={(e) => store.config.agent.defaultProvider = e.currentTarget.value}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select></div>
            <div style={field}><label style={lbl}>Default Model</label>
              <input type="text" style={inp} value={str(store.config.agent.defaultModel)} onInput={(e) => store.config.agent.defaultModel = e.currentTarget.value} placeholder="e.g. claude-3-5-sonnet-20241022" /></div>
            <div style={field}><label style={lbl}>Think Level</label>
              <select style={inp} value={str(store.config.agent.thinkLevel, "none")} onChange={(e) => store.config.agent.thinkLevel = e.currentTarget.value}>
                <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select></div>
          </>}

          {/* Security */}
          {tab() === "security" && <>
            <div style={field}><label style={lbl}>Gateway Token</label>
              <input type="password" style={inp} value={str(store.config.security.gatewayToken)} onInput={(e) => store.config.security.gatewayToken = e.currentTarget.value} placeholder="••••••••" /></div>
            <div style={field}><label style={lbl}>DM Policy</label>
              <select style={inp} value={str(store.config.security.dmPolicy, "allow")} onChange={(e) => store.config.security.dmPolicy = e.currentTarget.value}>
                <option value="allow">Allow</option><option value="deny">Deny</option><option value="review">Review</option>
              </select></div>
            <div style={field}><label style={lbl}>Prompt Guard</label>
              <select style={inp} value={str(store.config.security.promptGuard, "off")} onChange={(e) => store.config.security.promptGuard = e.currentTarget.value}>
                <option value="off">Off</option><option value="warn">Warn</option><option value="block">Block</option>
              </select></div>
          </>}

          <button onClick={doSave} disabled={saving()}
            style={{ background: saving() ? "#2e2e50" : "#4a9eff", border: "none", "border-radius": "8px", color: saving() ? "#666" : "#fff", cursor: saving() ? "not-allowed" : "pointer", "font-size": "13px", "font-weight": "600", padding: "8px 20px", "margin-top": "4px", "font-family": "inherit" }}>
            {saving() ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigEditor;
