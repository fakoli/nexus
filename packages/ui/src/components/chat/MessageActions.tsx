import { Component, createSignal, Show } from "solid-js";
import { tokens as t } from "../../design/tokens";
import {
  isPinned,
  isDeleted,
  togglePin,
  toggleDelete,
} from "../../stores/chat-state";

interface MessageActionsProps {
  id: string;
  content: string;
  visible: boolean;
}

const MessageActions: Component<MessageActionsProps> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const copy = () => {
    navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const btnStyle = (active = false): Record<string, string> => ({
    background: active ? "rgba(74,158,255,0.15)" : t.color.bgHover,
    border: `1px solid ${t.color.border}`,
    "border-radius": t.radius.sm,
    color: active ? t.color.accent : t.color.textMuted,
    cursor: "pointer",
    "font-size": "11px",
    "font-family": t.font.family,
    padding: "2px 7px",
    "white-space": "nowrap",
    transition: `color ${t.transition.normal}, background ${t.transition.normal}`,
    "line-height": "1.6",
  });

  return (
    <Show when={props.visible}>
      <div
        style={{
          display: "flex",
          gap: t.space.xs,
          "align-items": "center",
          position: "absolute",
          top: "-26px",
          right: "0",
          "z-index": "10",
          background: t.color.bgCard,
          border: `1px solid ${t.color.border}`,
          "border-radius": t.radius.md,
          padding: "3px 4px",
          "box-shadow": t.shadow.md,
        }}
      >
        {/* Copy */}
        <button
          onClick={copy}
          title="Copy message"
          style={btnStyle(copied())}
        >
          {copied() ? "✓ Copied" : "Copy"}
        </button>

        {/* Pin / Unpin */}
        <button
          onClick={() => togglePin(props.id)}
          title={isPinned(props.id) ? "Unpin" : "Pin message"}
          style={btnStyle(isPinned(props.id))}
        >
          {isPinned(props.id) ? "📌 Pinned" : "Pin"}
        </button>

        {/* Delete / Restore */}
        <button
          onClick={() => toggleDelete(props.id)}
          title={isDeleted(props.id) ? "Restore message" : "Hide message"}
          style={{
            ...btnStyle(),
            color: isDeleted(props.id) ? t.color.success : t.color.error,
          }}
        >
          {isDeleted(props.id) ? "Restore" : "Delete"}
        </button>
      </div>
    </Show>
  );
};

export default MessageActions;
