import { Component, For, onMount } from "solid-js";
import { store, setStore } from "../../stores/app";
import { loadSessions, loadHistory } from "../../stores/actions";
import type { SessionInfo } from "../../gateway/types";

type SessionRow = SessionInfo & { state?: string; channel?: string; updatedAt?: number };

function truncId(id: string) { return id.length > 12 ? id.slice(0, 8) + "…" + id.slice(-4) : id; }
function fmtDate(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const COL = "1fr 1fr 1fr 72px 1fr";

const SessionList: Component = () => {
  onMount(() => loadSessions());

  const selectSession = (id: string, agentId: string) => {
    setStore("session", "id", id);
    setStore("session", "agentId", agentId);
    setStore("ui", "tab", "chat");
    loadHistory();
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", background: "#1a1a2e", color: "#e0e0e0", "font-family": "system-ui, sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "14px 20px", "border-bottom": "1px solid #2a2a45", background: "#13132a", "flex-shrink": "0" }}>
        <span style={{ "font-weight": "600", "font-size": "15px", color: "#c0c0e0" }}>Sessions</span>
        <button onClick={() => { setStore("session", "id", ""); setStore("session", "messages", []); setStore("ui", "tab", "chat"); }}
          style={{ background: "#4a9eff", border: "none", "border-radius": "8px", color: "#fff", cursor: "pointer", "font-size": "13px", "font-weight": "600", padding: "6px 14px" }}>
          + New Session
        </button>
      </div>

      <div style={{ flex: "1", overflow: "auto", padding: "12px 16px" }}>
        {/* Column headers */}
        <div style={{ display: "grid", "grid-template-columns": COL, gap: "0 12px", padding: "5px 12px", "font-size": "11px", "font-weight": "600", color: "#555", "text-transform": "uppercase", "letter-spacing": "0.06em", "border-bottom": "1px solid #2a2a45", "margin-bottom": "6px" }}>
          <span>Session ID</span><span>Agent</span><span>Channel</span><span>State</span><span>Updated</span>
        </div>

        <For each={store.sessions as SessionRow[]} fallback={
          <div style={{ "text-align": "center", color: "#555", padding: "48px 0", "font-size": "14px" }}>
            No sessions. Start a new one.
          </div>
        }>
          {(s) => {
            const active = () => store.session.id === s.id;
            const archived = s.state === "archived" || s.state === "closed";
            return (
              <div onClick={() => selectSession(s.id, s.agentId)}
                style={{
                  display: "grid", "grid-template-columns": COL, gap: "0 12px", padding: "10px 12px",
                  "border-radius": "8px", "margin-bottom": "4px", cursor: "pointer",
                  background: active() ? "#1e2d50" : "#252542",
                  border: active() ? "1px solid #4a9eff44" : "1px solid transparent",
                  "font-size": "13px", color: "#ccc", "align-items": "center", transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { if (!active()) e.currentTarget.style.background = "#2a2a50"; }}
                onMouseLeave={(e) => { if (!active()) e.currentTarget.style.background = "#252542"; }}
              >
                <span style={{ "font-family": "monospace", "font-size": "12px", color: "#9090cc" }}>{truncId(s.id)}</span>
                <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{s.agentId || "—"}</span>
                <span style={{ color: "#888" }}>{s.channel ?? "—"}</span>
                <span style={{ display: "inline-block", padding: "2px 8px", "border-radius": "10px", "font-size": "11px", "font-weight": "600", background: archived ? "#2a2a2a" : "#1a3a1a", color: archived ? "#888" : "#4caf50", "white-space": "nowrap" }}>
                  {s.state ?? "active"}
                </span>
                <span style={{ color: "#666", "font-size": "12px" }}>{fmtDate(s.updatedAt ?? s.createdAt)}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default SessionList;
