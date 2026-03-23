import { Component, For, onMount, createSignal, createMemo } from "solid-js";
import { store, setStore } from "../../stores/app";
import { loadSessions, loadHistory, createNewSession } from "../../stores/actions";
import type { SessionInfo } from "../../gateway/types";
import SessionFilters, { type FilterState, type SortKey } from "./SessionFilters";
import { tokens as t } from "../../design/tokens";

type SessionRow = SessionInfo & {
  state?: string;
  channel?: string;
  updatedAt?: number;
  lastMessage?: string;
  tokenUsage?: number;
};

function truncId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + "…" + id.slice(-4) : id;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortSessions(rows: SessionRow[], key: SortKey): SessionRow[] {
  return [...rows].sort((a, b) => {
    if (key === "messageCount") return (b.messageCount ?? 0) - (a.messageCount ?? 0);
    if (key === "createdAt") return b.createdAt - a.createdAt;
    return (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt);
  });
}

const COL = "1fr 1fr 60px 2fr 90px";

const SessionList: Component = () => {
  onMount(() => loadSessions());

  const [filters, setFilters] = createSignal<FilterState>({
    search: "",
    agent: "",
    state: "all",
    sort: "updatedAt",
    pageSize: 25,
    page: 0,
  });

  const selectSession = (id: string, agentId: string) => {
    setStore("session", "id", id);
    setStore("session", "agentId", agentId);
    setStore("ui", "tab", "chat");
    loadHistory();
  };

  const uniqueAgents = createMemo(() => {
    const set = new Set<string>();
    for (const s of store.sessions as SessionRow[]) {
      if (s.agentId) set.add(s.agentId);
    }
    return [...set].sort();
  });

  const filtered = createMemo(() => {
    const f = filters();
    let rows = store.sessions as SessionRow[];

    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.agentId ?? "").toLowerCase().includes(q) ||
          (s.lastMessage ?? "").toLowerCase().includes(q),
      );
    }

    if (f.agent) {
      rows = rows.filter((s) => s.agentId === f.agent);
    }

    if (f.state !== "all") {
      const archived = f.state === "archived";
      rows = rows.filter((s) => {
        const isArchived = s.state === "archived" || s.state === "closed";
        return archived ? isArchived : !isArchived;
      });
    }

    return sortSessions(rows, f.sort);
  });

  const totalPages = createMemo(() =>
    Math.ceil(filtered().length / filters().pageSize),
  );

  const paginated = createMemo(() => {
    const f = filters();
    const start = f.page * f.pageSize;
    return filtered().slice(start, start + f.pageSize);
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: t.color.bg,
        color: t.color.text,
        "font-family": t.font.family,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: `14px ${t.space.md}`,
          "border-bottom": `1px solid ${t.color.border}`,
          background: t.color.bgSidebar,
          "flex-shrink": "0",
        }}
      >
        <span style={{ "font-weight": t.font.weightBold, "font-size": t.font.sizeLg, color: "#c0c0e0" }}>
          Sessions
          <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim, "margin-left": t.space.sm }}>
            ({filtered().length})
          </span>
        </span>
        <button
          onClick={() => createNewSession()}
          style={{
            background: t.color.accent,
            border: "none",
            "border-radius": t.radius.md,
            color: "#fff",
            cursor: "pointer",
            "font-size": t.font.sizeMd,
            "font-weight": t.font.weightBold,
            padding: `6px 14px`,
          }}
        >
          + New Session
        </button>
      </div>

      {/* Filters */}
      <SessionFilters
        filters={filters()}
        agents={uniqueAgents()}
        totalPages={totalPages()}
        onChange={setFilters}
      />

      <div style={{ flex: "1", overflow: "auto", padding: `${t.space.sm} ${t.space.md}` }}>
        {/* Column headers */}
        <div
          style={{
            display: "grid",
            "grid-template-columns": COL,
            gap: "0 12px",
            padding: `5px ${t.space.sm}`,
            "font-size": t.font.sizeSm,
            "font-weight": t.font.weightBold,
            color: t.color.textDim,
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            "border-bottom": `1px solid ${t.color.border}`,
            "margin-bottom": "6px",
          }}
        >
          <span>Session ID</span>
          <span>Agent</span>
          <span>Msgs</span>
          <span>Last message</span>
          <span>Updated</span>
        </div>

        <For
          each={paginated()}
          fallback={
            <div
              style={{
                "text-align": "center",
                color: t.color.textDim,
                padding: "48px 0",
                "font-size": t.font.sizeMd,
              }}
            >
              {filters().search || filters().agent || filters().state !== "all"
                ? "No sessions match the current filters."
                : "No sessions. Start a new one."}
            </div>
          }
        >
          {(s) => {
            const active = () => store.session.id === s.id;
            const archived = s.state === "archived" || s.state === "closed";
            const preview = s.lastMessage
              ? s.lastMessage.slice(0, 60) + (s.lastMessage.length > 60 ? "…" : "")
              : "—";

            return (
              <div
                onClick={() => selectSession(s.id, s.agentId)}
                style={{
                  display: "grid",
                  "grid-template-columns": COL,
                  gap: "0 12px",
                  padding: `10px ${t.space.sm}`,
                  "border-radius": t.radius.md,
                  "margin-bottom": "4px",
                  cursor: "pointer",
                  background: active() ? "#1e2d50" : t.color.bgCard,
                  border: active()
                    ? `1px solid ${t.color.accent}44`
                    : `1px solid transparent`,
                  "font-size": t.font.sizeMd,
                  color: t.color.textMuted,
                  "align-items": "center",
                  transition: `background ${t.transition.normal}`,
                }}
                onMouseEnter={(e) => {
                  if (!active()) e.currentTarget.style.background = t.color.bgHover;
                }}
                onMouseLeave={(e) => {
                  if (!active()) e.currentTarget.style.background = t.color.bgCard;
                }}
              >
                <span
                  style={{
                    "font-family": t.font.familyMono,
                    "font-size": t.font.sizeSm,
                    color: "#9090cc",
                  }}
                >
                  {truncId(s.id)}
                </span>

                <span
                  style={{
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    color: t.color.text,
                  }}
                >
                  {s.agentId || "—"}
                </span>

                <span
                  style={{
                    display: "inline-block",
                    padding: `2px ${t.space.xs}`,
                    "border-radius": t.radius.full,
                    "font-size": t.font.sizeSm,
                    "font-weight": t.font.weightBold,
                    background: archived ? "#2a2a2a" : "rgba(76,175,80,0.12)",
                    color: archived ? "#888" : t.color.success,
                    "text-align": "center",
                  }}
                >
                  {s.messageCount ?? 0}
                </span>

                <span
                  style={{
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    "font-size": t.font.sizeSm,
                    color: t.color.textMuted,
                    "font-style": preview === "—" ? "italic" : "normal",
                  }}
                >
                  {preview}
                </span>

                <span style={{ color: t.color.textDim, "font-size": t.font.sizeSm }}>
                  {fmtDate(s.updatedAt ?? s.createdAt)}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default SessionList;
