import { Component, Show, createSignal } from "solid-js";
import { renderMarkdown } from "../../utils/markdown";
import ToolCard from "./ToolCard";
import MessageActions from "./MessageActions";
import { isPinned, isDeleted, showDeleted } from "../../stores/chat-state";

interface MessageBubbleProps {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const [hovered, setHovered] = createSignal(false);

  const isUser = () => props.role === "user";
  const isTool = () => props.role === "tool_use" || props.role === "tool_result";
  const pinned = () => isPinned(props.id);
  const deleted = () => isDeleted(props.id);

  // Hide deleted messages unless showDeleted is toggled on
  const hidden = () => deleted() && !showDeleted();

  const bubbleStyle = () => ({
    "max-width": "72%",
    padding: isTool() ? "0" : "10px 14px",
    "border-radius": isTool() ? "6px" : isUser() ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
    background: isTool() ? "transparent" : isUser() ? "#4a9eff" : "#2a2a45",
    color: "#e0e0e0",
    "font-size": "14px",
    "line-height": "1.55",
    border: "none",
    position: "relative" as const,
    "word-break": "break-word" as const,
    width: isTool() ? "min(520px, 80vw)" : undefined,
    opacity: deleted() ? "0.45" : "1",
    transition: "opacity 0.2s",
  });

  return (
    <Show when={!hidden()}>
      <div
        class="nx-message-row"
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
        {/* Role label */}
        <Show when={!isUser() && !isTool()}>
          <span style={{ "font-size": "11px", color: "#888", "margin-bottom": "3px", "padding-left": "4px" }}>
            {pinned() ? "📌 Assistant" : "Assistant"}
          </span>
        </Show>
        <Show when={isTool()}>
          <span style={{ "font-size": "11px", color: "#7a7aaa", "margin-bottom": "3px", "padding-left": "4px" }}>
            {props.role === "tool_use" ? "Tool Call" : "Tool Result"}
            {pinned() ? " 📌" : ""}
          </span>
        </Show>
        <Show when={isUser()}>
          <span style={{ "font-size": "11px", color: "#888", "margin-bottom": "3px", "padding-right": "4px" }}>
            {pinned() ? "📌 You" : ""}
          </span>
        </Show>

        <div style={{ display: "flex", "align-items": "flex-end", gap: "6px", "flex-direction": isUser() ? "row-reverse" : "row", position: "relative" }}>
          {/* Floating action bar */}
          <MessageActions
            id={props.id}
            content={props.content}
            visible={hovered()}
          />

          <div class="nx-message-bubble" style={bubbleStyle()}>
            <Show
              when={isTool()}
              fallback={<span innerHTML={renderMarkdown(props.content)} />}
            >
              <ToolCard
                role={props.role as "tool_use" | "tool_result"}
                content={props.content}
              />
            </Show>
          </div>
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
    </Show>
  );
};

export default MessageBubble;
