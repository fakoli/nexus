import { Component } from "solid-js";
import { tokens as t } from "../../design/tokens";

export type SortKey = "updatedAt" | "createdAt" | "messageCount";
export type StateFilter = "all" | "active" | "archived";
export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface FilterState {
  search: string;
  agent: string;
  state: StateFilter;
  sort: SortKey;
  pageSize: PageSize;
  page: number;
}

interface SessionFiltersProps {
  filters: FilterState;
  agents: string[];
  totalPages: number;
  onChange: (f: FilterState) => void;
}

const inputStyle: Record<string, string> = {
  background: t.color.bgCard,
  border: `1px solid ${t.color.border}`,
  "border-radius": t.radius.md,
  color: t.color.text,
  "font-family": t.font.family,
  "font-size": t.font.sizeMd,
  padding: `5px ${t.space.sm}`,
  outline: "none",
};

const SessionFilters: Component<SessionFiltersProps> = (props) => {
  const set = (patch: Partial<FilterState>) =>
    props.onChange({ ...props.filters, ...patch, page: 0 });

  const setPage = (page: number) =>
    props.onChange({ ...props.filters, page });

  return (
    <div
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        gap: t.space.sm,
        padding: `${t.space.sm} ${t.space.md}`,
        "border-bottom": `1px solid ${t.color.border}`,
        "align-items": "center",
        background: t.color.bgCard,
        "flex-shrink": "0",
      }}
    >
      {/* Search */}
      <input
        type="text"
        placeholder="Search sessions…"
        value={props.filters.search}
        onInput={(e) => set({ search: e.currentTarget.value })}
        style={{ ...inputStyle, "min-width": "160px", flex: "1" }}
      />

      {/* Agent filter */}
      <select
        value={props.filters.agent}
        onChange={(e) => set({ agent: e.currentTarget.value })}
        style={{ ...inputStyle }}
      >
        <option value="">All agents</option>
        {props.agents.map((a) => (
          <option value={a}>{a}</option>
        ))}
      </select>

      {/* State filter */}
      <select
        value={props.filters.state}
        onChange={(e) => set({ state: e.currentTarget.value as StateFilter })}
        style={{ ...inputStyle }}
      >
        <option value="all">All states</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>

      {/* Sort */}
      <select
        value={props.filters.sort}
        onChange={(e) => set({ sort: e.currentTarget.value as SortKey })}
        style={{ ...inputStyle }}
      >
        <option value="updatedAt">Sort: Updated</option>
        <option value="createdAt">Sort: Created</option>
        <option value="messageCount">Sort: Messages</option>
      </select>

      {/* Page size */}
      <select
        value={String(props.filters.pageSize)}
        onChange={(e) => set({ pageSize: Number(e.currentTarget.value) as PageSize })}
        style={{ ...inputStyle }}
      >
        {PAGE_SIZES.map((n) => (
          <option value={String(n)}>{n} / page</option>
        ))}
      </select>

      {/* Pagination */}
      <div style={{ display: "flex", gap: t.space.xs, "align-items": "center", "margin-left": "auto" }}>
        <button
          disabled={props.filters.page === 0}
          onClick={() => setPage(props.filters.page - 1)}
          style={{
            ...inputStyle,
            cursor: props.filters.page === 0 ? "not-allowed" : "pointer",
            opacity: props.filters.page === 0 ? "0.4" : "1",
            padding: `4px ${t.space.sm}`,
          }}
        >
          ‹ Prev
        </button>
        <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "white-space": "nowrap" }}>
          {props.filters.page + 1} / {Math.max(1, props.totalPages)}
        </span>
        <button
          disabled={props.filters.page >= props.totalPages - 1}
          onClick={() => setPage(props.filters.page + 1)}
          style={{
            ...inputStyle,
            cursor: props.filters.page >= props.totalPages - 1 ? "not-allowed" : "pointer",
            opacity: props.filters.page >= props.totalPages - 1 ? "0.4" : "1",
            padding: `4px ${t.space.sm}`,
          }}
        >
          Next ›
        </button>
      </div>
    </div>
  );
};

export default SessionFilters;
