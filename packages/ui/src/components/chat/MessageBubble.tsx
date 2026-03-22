import { Component, Show, createSignal } from "solid-js";
import { renderMarkdown } from "../../utils/markdown";

interface MessageBubbleProps {
  role: string;
  content: string;
  createdAt: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const isUser = () => props.role === "user";
  const isTool = () => props.role === "tool_use" || props.role === "tool_result";

  const copyContent = () => {
    navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const bubbleStyle = () => ({
    "max-width": "72%",
    padding: "10px 14px",
    "border-radius": isTool() ? "6px" : isUser() ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
    background: isTool() ? "#12122a" : isUser() ? "#4a9eff" : "#2a2a45",
    color: "#e0e0e0",
    "font-size": "14px",
    "line-height": "1.55",
    border: isTool() ? "1px solid #3a3a5c" : "none",
    "font-family": isTool() ? "monospace" : "inherit",
    position: "relative" as const,
    "word-break": "break-word",
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": isUser() ? "flex-end" : "flex-start",
        margin: "6px 16px",
        position: "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Show when={!isUser() && !isTool()}>
        <span style={{ "font-size": "11px", color: "#888", "margin-bottom": "3px", "padding-left": "4px" }}>
          Assistant
        </span>
      </Show>
      <Show when={isTool()}>
        <span style={{ "font-size": "11px", color: "#7a7aaa", "margin-bottom": "3px", "padding-left": "4px" }}>
          {props.role === "tool_use" ? "Tool Call" : "Tool Result"}
        </span>
      </Show>

      <div style={{ display: "flex", "align-items": "flex-end", gap: "6px", "flex-direction": isUser() ? "row-reverse" : "row" }}>
        <div style={bubbleStyle()}>
          <Show
            when={isTool()}
            fallback={<span innerHTML={renderMarkdown(props.content)} />}
          >
            <details>
              <summary style={{ cursor: "pointer", color: "#9090cc", "font-size": "12px", "user-select": "none" }}>
                {props.role === "tool_use" ? "View tool call" : "View result"}
              </summary>
              <pre style={{ margin: "8px 0 0", "white-space": "pre-wrap", "font-size": "12px", color: "#c0c0e0" }}>
                {props.content}
              </pre>
            </details>
          </Show>
        </div>

        <Show when={hovered()}>
          <button
            onClick={copyContent}
            title="Copy"
            style={{
              background: "#2a2a45",
              border: "1px solid #3a3a5c",
              "border-radius": "6px",
              color: copied() ? "#4aff9e" : "#aaa",
              cursor: "pointer",
              "font-size": "11px",
              padding: "3px 7px",
              "white-space": "nowrap",
              transition: "color 0.2s",
            }}
          >
            {copied() ? "Copied" : "Copy"}
          </button>
        </Show>
      </div>

      <Show when={hovered()}>
        <span style={{
          "font-size": "10px",
          color: "#666",
          "margin-top": "3px",
          "padding-left": isUser() ? "0" : "4px",
          "padding-right": isUser() ? "4px" : "0",
        }}>
          {formatTime(props.createdAt)}
        </span>
      </Show>

      <style>{`
        .code-block { background: #0d0d1a; border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 6px 0; font-size: 12px; }
        .inline-code { background: rgba(0,0,0,0.35); border-radius: 3px; padding: 1px 5px; font-size: 13px; }
        a { color: #7ab8ff; }
      `}</style>
    </div>
  );
};

export default MessageBubble;
