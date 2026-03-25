import { type Component, createSignal, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";

// ── Types ────────────────────────────────────────────────────────────────────

type ToolStatus = "running" | "complete" | "error";

interface ToolCardProps {
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: ToolStatus;
}

// ── Legacy props (kept for MessageBubble compat) ─────────────────────────────

interface LegacyToolCardProps {
  role: "tool_use" | "tool_result";
  content: string;
}

// ── Tool icon map ────────────────────────────────────────────────────────────

function toolIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell")) return ">";
  if (lower.includes("file") || lower.includes("fs")) return "\u{1F4C1}";
  if (lower.includes("web_fetch") || lower.includes("fetch")) return "\u{1F310}";
  if (lower.includes("web_search") || lower.includes("search")) return "\u{1F50D}";
  if (lower.includes("memory")) return "\u{1F516}";
  if (lower.includes("text_to_speech") || lower.includes("tts")) return "\u{1F50A}";
  if (lower.includes("speech_to_text") || lower.includes("stt")) return "\u{1F3A4}";
  return "\u2699";
}

function statusColor(status: ToolStatus): string {
  switch (status) {
    case "running":  return t.color.info;
    case "complete": return t.color.success;
    case "error":    return t.color.error;
  }
}

function statusLabel(status: ToolStatus): string {
  switch (status) {
    case "running":  return "Running";
    case "complete": return "Complete";
    case "error":    return "Error";
  }
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function highlightJson(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "color:#ce9178";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = "color:#9cdcfe";
      } else if (/true|false/.test(match)) {
        cls = "color:#569cd6";
      } else if (/null/.test(match)) {
        cls = "color:#569cd6";
      } else {
        cls = "color:#b5cea8";
      }
      return `<span style="${cls}">${match}</span>`;
    },
  );
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarise(text: string, max = 80): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "\u2026";
}

// ── Parse legacy content ─────────────────────────────────────────────────────

function parseLegacy(role: string, content: string): ToolCardProps {
  let obj: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(content);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { toolName: role === "tool_use" ? "tool" : "Result", input: {}, output: content, status: "complete" };
    }
    obj = raw as Record<string, unknown>;
  } catch {
    return { toolName: role === "tool_use" ? "tool" : "Result", input: {}, output: content, status: "complete" };
  }
  if (role === "tool_use") {
    const name = typeof obj["name"] === "string" ? obj["name"]
      : typeof obj["tool"] === "string" ? obj["tool"] : "tool";
    const rawInput = obj["input"];
    const input = (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput))
      ? rawInput as Record<string, unknown> : obj;
    return { toolName: name, input, status: "complete" };
  }
  const isErr = obj["error"] !== undefined || obj["ok"] === false || obj["success"] === false;
  return {
    toolName: "Result",
    input: obj,
    status: isErr ? "error" : "complete",
  };
}

// ── Rich ToolCard ────────────────────────────────────────────────────────────

export const RichToolCard: Component<ToolCardProps> = (props) => {
  const [inputOpen, setInputOpen] = createSignal(false);
  const [outputOpen, setOutputOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const accent = () => statusColor(props.status);
  const icon = () => toolIcon(props.toolName);
  const inputStr = () => prettyJson(props.input);

  const copyAll = (): void => {
    const text = props.output
      ? `Input:\n${inputStr()}\n\nOutput:\n${props.output}`
      : inputStr();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{
      background: t.color.bgCard,
      "border-left": `3px solid ${accent()}`,
      border: `1px solid ${t.color.border}`,
      "border-radius": t.radius.md,
      "font-family": t.font.familyMono,
      "font-size": t.font.sizeSm,
      overflow: "hidden",
      width: "100%",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", "align-items": "center", gap: t.space.sm,
        padding: `${t.space.xs} ${t.space.sm}`,
        background: "rgba(0,0,0,0.2)", "user-select": "none",
      }}>
        <span style={{ "font-size": "13px", "line-height": "1" }}>{icon()}</span>
        <span style={{ color: t.color.text, "font-weight": t.font.weightBold, flex: "1" }}>
          {props.toolName}
        </span>
        <span style={{
          "font-size": "10px", padding: "1px 6px",
          "border-radius": t.radius.full,
          background: `${accent()}22`, color: accent(),
          "font-weight": t.font.weightBold,
        }}>
          {statusLabel(props.status)}
        </span>
        <button onClick={copyAll} style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: copied() ? t.color.success : t.color.textDim,
          "font-size": "10px", "font-family": t.font.family,
          padding: "2px 4px", transition: `color ${t.transition.normal}`,
        }}>
          {copied() ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Input params (collapsible) */}
      <div>
        <button onClick={() => setInputOpen((v) => !v)} style={{
          width: "100%", display: "flex", "align-items": "center", gap: t.space.xs,
          padding: `${t.space.xs} ${t.space.sm}`,
          background: "transparent", border: "none", cursor: "pointer",
          color: t.color.textMuted, "font-size": "11px", "font-family": t.font.familyMono,
          "text-align": "left",
        }}>
          <span>{inputOpen() ? "\u25BC" : "\u25B6"}</span>
          <span style={{ flex: "1" }}>
            {inputOpen() ? "Input" : summarise(JSON.stringify(props.input))}
          </span>
        </button>
        <Show when={inputOpen()}>
          <pre style={{
            margin: "0", padding: t.space.sm,
            "white-space": "pre-wrap", "word-break": "break-all",
            color: "#c0c0e0", "max-height": "240px",
            "overflow-y": "auto", "font-size": "11px", "line-height": "1.55",
          }} innerHTML={highlightJson(inputStr())} />
        </Show>
      </div>

      {/* Output section (collapsible) */}
      <Show when={props.output}>
        <div style={{ "border-top": `1px solid ${t.color.border}` }}>
          <button onClick={() => setOutputOpen((v) => !v)} style={{
            width: "100%", display: "flex", "align-items": "center", gap: t.space.xs,
            padding: `${t.space.xs} ${t.space.sm}`,
            background: "transparent", border: "none", cursor: "pointer",
            color: t.color.textMuted, "font-size": "11px", "font-family": t.font.familyMono,
            "text-align": "left",
          }}>
            <span>{outputOpen() ? "\u25BC" : "\u25B6"}</span>
            <span style={{ flex: "1" }}>
              {outputOpen() ? "Output" : summarise(props.output ?? "")}
            </span>
          </button>
          <Show when={outputOpen()}>
            <pre style={{
              margin: "0", padding: t.space.sm,
              "white-space": "pre-wrap", "word-break": "break-all",
              color: "#c0c0e0", "max-height": "240px",
              "overflow-y": "auto", "font-size": "11px", "line-height": "1.55",
            }}>
              {props.output}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
};

// ── Legacy wrapper (default export for backward compat) ──────────────────────

const ToolCard: Component<LegacyToolCardProps> = (props) => {
  const parsed = () => parseLegacy(props.role, props.content);

  return (
    <RichToolCard
      toolName={parsed().toolName}
      input={parsed().input}
      output={parsed().output}
      status={parsed().status}
    />
  );
};

export default ToolCard;
