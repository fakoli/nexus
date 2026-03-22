import { Component, For } from "solid-js";
import { store } from "../../stores/app";
import { setTab } from "../../stores/actions";
import type { TabName } from "../../gateway/types";

interface TabDef {
  id: TabName;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "chat",     label: "Chat",     icon: "\u{1F4AC}" },
  { id: "sessions", label: "Sessions", icon: "\u{1F4CB}" },
  { id: "config",   label: "Config",   icon: "\u2699\uFE0F" },
  { id: "logs",     label: "Logs",     icon: "\u{1F4DD}" },
];

const TabBar: Component = () => {
  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      background: "#13132a",
      "border-bottom": "1px solid #2a2a45",
      padding: "0 8px",
      "flex-shrink": "0",
      gap: "2px",
    }}>
      <For each={TABS}>
        {(tab) => {
          const isActive = () => store.ui.tab === tab.id;
          return (
            <button
              onClick={() => setTab(tab.id)}
              style={{
                background: "transparent",
                border: "none",
                "border-bottom": isActive() ? "2px solid #4a9eff" : "2px solid transparent",
                color: isActive() ? "#4a9eff" : "#888",
                cursor: "pointer",
                "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                "font-size": "13px",
                "font-weight": isActive() ? "600" : "400",
                padding: "10px 14px 8px",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                transition: "color 0.15s, border-color 0.15s",
                "white-space": "nowrap",
                "flex-shrink": "0",
              }}
              onMouseEnter={(e) => {
                if (!isActive()) e.currentTarget.style.color = "#bbb";
              }}
              onMouseLeave={(e) => {
                if (!isActive()) e.currentTarget.style.color = "#888";
              }}
            >
              <span style={{ "font-size": "14px", "line-height": "1" }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
};

export default TabBar;
