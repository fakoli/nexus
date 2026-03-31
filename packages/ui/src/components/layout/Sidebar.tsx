import { type Component, For, createSignal } from "solid-js";
import { store, setStore } from "../../stores/app";
import { setTab } from "../../stores/actions";
import type { TabName } from "../../gateway/types";
import { tokens as t } from "../../design/tokens";
import { Tooltip } from "../../design/components";

interface NavItem {
  id: TabName;
  label: string;
  icon: string;
  count?: () => number | null;
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview",   label: "Overview",   icon: "⊞" },
  { id: "chat",       label: "Chat",       icon: "◎" },
  { id: "sessions",   label: "Sessions",   icon: "≡", count: () => store.sessions.length || null },
  { id: "agents",     label: "Agents",     icon: "⬡", count: () => store.agents.length || null },
  { id: "cron",       label: "Cron",       icon: "◷", count: () => store.cron.jobs.length || null },
  { id: "plugins",    label: "Plugins",    icon: "⬡" },
  { id: "config",     label: "Config",     icon: "⚙" },
  { id: "analytics",  label: "Analytics",  icon: "↗" },
  { id: "federation", label: "Federation", icon: "\u{1F310}" },
  { id: "skills",     label: "Skills",     icon: "\u{26A1}" },
  { id: "logs",       label: "Logs",       icon: "\u25A4" },
  { id: "debug",      label: "Debug",      icon: "\u2325" },
];

const Sidebar: Component = () => {
  const [expanded, setExpanded] = createSignal(false);
  const w = () => expanded() ? t.sidebar.expanded : t.sidebar.collapsed;

  return (
    <nav
      class={`nx-sidebar${expanded() ? " nx-sidebar--open" : ""}`}
      aria-label="Main navigation"
      role="tablist"
      aria-orientation="vertical"
      style={{
        width: w(), "min-width": w(), "flex-shrink": "0",
        background: t.color.bgSidebar, "border-right": `1px solid ${t.color.border}`,
        display: "flex", "flex-direction": "column", "align-items": expanded() ? "stretch" : "center",
        padding: `${t.space.sm} 0`, "z-index": "10", overflow: "hidden",
        transition: `width ${t.transition.slow}, min-width ${t.transition.slow}`,
        "will-change": "width",
      }}
    >

      {/* Logo / brand mark */}
      <div style={{ padding: `${t.space.sm} ${expanded() ? t.space.md : "0"}`, "margin-bottom": t.space.sm, display: "flex", "align-items": "center", "justify-content": expanded() ? "flex-start" : "center", "flex-shrink": "0" }}>
        <span style={{ "font-size": "18px", "font-weight": t.font.weightBold, color: t.color.accent, "font-family": t.font.family, "letter-spacing": "-0.02em" }}>
          {expanded() ? "nexus" : "N"}
        </span>
      </div>

      {/* Nav items */}
      <div style={{ flex: "1", display: "flex", "flex-direction": "column", gap: "2px", padding: `0 ${t.space.xs}`, overflow: "hidden" }}>
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () => store.ui.tab === item.id;
            const count = () => item.count ? item.count() : null;
            const label = () => count() != null ? `${item.label} (${count()})` : item.label;

            const btn = (
              <button
                role="tab"
                aria-selected={isActive()}
                aria-label={label()}
                tabindex={0}
                onClick={() => setTab(item.id)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setTab(item.id);
                  }
                }}
                title={expanded() ? undefined : item.label}
                style={{
                  width: "100%", display: "flex", "align-items": "center",
                  gap: t.space.sm, padding: `9px ${expanded() ? t.space.sm : "0"}`,
                  background: isActive() ? t.color.bgHover : "transparent",
                  border: "none", "border-left": isActive() ? `3px solid ${t.color.accent}` : "3px solid transparent",
                  "border-radius": `0 ${t.radius.md} ${t.radius.md} 0`,
                  color: isActive() ? t.color.accent : t.color.textMuted,
                  cursor: "pointer", "font-family": t.font.family,
                  "font-size": t.font.sizeMd, "font-weight": isActive() ? t.font.weightBold : t.font.weightNormal,
                  transition: `all ${t.transition.normal}`,
                  "justify-content": expanded() ? "flex-start" : "center",
                }}
              >
                <span style={{ "font-size": "15px", "line-height": "1", "flex-shrink": "0", width: "20px", "text-align": "center" }}>{item.icon}</span>
                {expanded() && (
                  <span style={{ flex: "1", "text-align": "left", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {label()}
                  </span>
                )}
              </button>
            );

            return expanded() ? btn : <Tooltip text={label()}>{btn}</Tooltip>;
          }}
        </For>
      </div>

      {/* Expand / collapse toggle */}
      <div style={{ padding: `${t.space.sm} ${t.space.xs}`, "border-top": `1px solid ${t.color.border}`, "flex-shrink": "0" }}>
        <button
          onClick={() => setExpanded(v => !v)}
          aria-label={expanded() ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded() ? "Collapse sidebar" : "Expand sidebar"}
          style={{
            width: "100%", display: "flex", "align-items": "center", "justify-content": expanded() ? "flex-end" : "center",
            gap: t.space.xs, padding: `${t.space.sm} ${t.space.sm}`,
            background: "transparent", border: "none", "border-radius": t.radius.md,
            color: t.color.textDim, cursor: "pointer", "font-size": "13px",
            transition: `color ${t.transition.normal}`,
          }}
        >
          <span style={{ "font-size": "14px", transform: expanded() ? "rotate(180deg)" : "none", transition: `transform ${t.transition.slow}`, display: "inline-block" }}>▶</span>
          {expanded() && <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>Collapse</span>}
        </button>
      </div>

    </nav>
  );
};

export default Sidebar;
