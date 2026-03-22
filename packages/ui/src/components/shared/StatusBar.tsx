import { Component } from "solid-js";
import { store } from "../../stores/app";

const DOT_COLOR: Record<string, string> = {
  connected: "#4aff9e",
  connecting: "#ffd84a",
  disconnected: "#ff4a4a",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

const StatusBar: Component = () => {
  const status = () => store.connection.status;
  const dotColor = () => DOT_COLOR[status()] ?? "#888";
  const label = () => STATUS_LABEL[status()] ?? status();

  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      padding: "8px 16px",
      background: "#13132a",
      "border-bottom": "1px solid #2a2a45",
      "font-size": "12px",
      color: "#888",
      "flex-shrink": "0",
    }}>
      <span style={{ "font-weight": "600", color: "#aaa", "letter-spacing": "0.05em" }}>
        Nexus
      </span>

      <div style={{ display: "flex", "align-items": "center", gap: "7px" }}>
        <span style={{
          width: "8px",
          height: "8px",
          "border-radius": "50%",
          background: dotColor(),
          display: "inline-block",
          "box-shadow": `0 0 6px ${dotColor()}88`,
          transition: "background 0.3s, box-shadow 0.3s",
        }} />
        <span style={{ color: dotColor(), transition: "color 0.3s" }}>
          {label()}
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default StatusBar;
