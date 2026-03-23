import { Component, createSignal, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";

interface ToolCardProps {
  role: "tool_use" | "tool_result";
  content: string;
}

// Simple JSON syntax highlighter — returns an HTML string.
function highlightJson(raw: string): string {
  let escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "color:#ce9178"; // string
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = "color:#9cdcfe"; // key
      } else if (/true|false/.test(match)) {
        cls = "color:#569cd6"; // boolean
      } else if (/null/.test(match)) {
        cls = "color:#569cd6"; // null
      } else {
        cls = "color:#b5cea8"; // number
      }
      return `<span style="${cls}">${match}</span>`;
    },
  );
}

function summarise(content: string, max = 80): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "…";
}

function parseToolName(content: string): string {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    if (typeof obj["name"] === "string") return obj["name"];
    if (typeof obj["tool"] === "string") return obj["tool"];
  } catch {
    // not JSON
  }
  return "tool";
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function isErrorResult(content: string): boolean {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    return (
      obj["error"] !== undefined ||
      obj["ok"] === false ||
      obj["success"] === false
    );
  } catch {
    return false;
  }
}

const ToolCard: Component<ToolCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const isUse = () => props.role === "tool_use";

  // Border colour: purple for tool_use, green for success result, red for error result
  const borderColor = () => {
    if (isUse()) return "#7c6fc4";
    return isErrorResult(props.content) ? t.color.error : t.color.success;
  };

  const headerColor = () => (isUse() ? "#b39ddb" : t.color.textMuted);

  const toolName = () =>
    isUse() ? parseToolName(props.content) : "Result";

  const icon = () => (isUse() ? "⚙" : "↩");

  const copyContent = () => {
    navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{
        background: t.color.bgCard,
        border: `1px solid ${borderColor()}`,
        "border-radius": t.radius.md,
        "font-family": t.font.familyMono,
        "font-size": t.font.sizeSm,
        overflow: "hidden",
        width: "100%",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          "align-items": "center",
          gap: t.space.sm,
          padding: `${t.space.xs} ${t.space.sm}`,
          cursor: "pointer",
          background: "rgba(0,0,0,0.2)",
          "user-select": "none",
        }}
      >
        <span style={{ color: headerColor(), "font-size": "12px" }}>{icon()}</span>
        <span style={{ color: headerColor(), "font-weight": t.font.weightBold, flex: "1" }}>
          {toolName()}
        </span>
        <span style={{ color: t.color.textDim, "font-size": "11px" }}>
          {expanded() ? "▲" : "▼"}
        </span>
      </div>

      {/* Collapsed summary */}
      <Show when={!expanded()}>
        <div
          style={{
            padding: `${t.space.xs} ${t.space.sm}`,
            color: t.color.textMuted,
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
          }}
        >
          {summarise(props.content)}
        </div>
      </Show>

      {/* Expanded content */}
      <Show when={expanded()}>
        <div style={{ position: "relative" }}>
          <pre
            style={{
              margin: "0",
              padding: t.space.sm,
              "white-space": "pre-wrap",
              "word-break": "break-all",
              color: "#c0c0e0",
              "max-height": "320px",
              "overflow-y": "auto",
              "font-size": "11px",
              "line-height": "1.55",
            }}
            innerHTML={highlightJson(prettyJson(props.content))}
          />
          <button
            onClick={copyContent}
            style={{
              position: "absolute",
              top: t.space.xs,
              right: t.space.xs,
              background: t.color.bgHover,
              border: `1px solid ${t.color.border}`,
              "border-radius": t.radius.sm,
              color: copied() ? t.color.success : t.color.textMuted,
              cursor: "pointer",
              "font-size": "10px",
              "font-family": t.font.family,
              padding: "2px 6px",
              transition: `color ${t.transition.normal}`,
            }}
          >
            {copied() ? "Copied" : "Copy"}
          </button>
        </div>
      </Show>
    </div>
  );
};

export default ToolCard;
