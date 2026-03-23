import { type Component, createSignal, onMount } from "solid-js";
import { loadHistory } from "../../stores/actions";
import { setChatInput } from "../../stores/app";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import StatusBar from "../shared/StatusBar";
import SessionTuning from "../sessions/SessionTuning";
import FocusMode from "../shared/FocusMode";
import { tokens as t } from "../../design/tokens";

const ChatView: Component = () => {
  const [focusMode, setFocusMode] = createSignal(false);

  onMount(() => {
    loadHistory();
  });

  // Handle /focus command typed into the input
  const handleFocusCommand = (text: string) => {
    if (text.trim() === "/focus") {
      setChatInput("");
      setFocusMode(true);
    }
  };

  // Expose handler for ChatInput to call when input changes
  // (we monkey-patch via a shared signal; ChatInput already watches store.chat.input)
  // Simpler: just listen reactively via store effect — but /focus is best caught in
  // ChatInput's handleSend. We wire it there via a document-level custom event.
  onMount(() => {
    const listener = () => setFocusMode(true);
    window.addEventListener("nexus:focus-mode", listener);
    return () => window.removeEventListener("nexus:focus-mode", listener);
  });

  const chatContent = (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      background: t.color.bg,
      color: t.color.text,
      "font-family": t.font.family,
      overflow: "hidden",
    }}>
      {/* Header with focus-mode toggle */}
      <div style={{
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: `${t.space.xs} ${t.space.md}`,
        "border-bottom": `1px solid ${t.color.border}`,
        background: t.color.bgSidebar,
        "flex-shrink": "0",
      }}>
        <span style={{
          "font-size": t.font.sizeMd, "font-weight": t.font.weightBold,
          color: t.color.textMuted,
        }}>Chat</span>
        <button
          onClick={() => setFocusMode(true)}
          title="Enter focus mode"
          style={{
            background: "transparent", border: `1px solid ${t.color.border}`,
            "border-radius": t.radius.md, color: t.color.textMuted,
            cursor: "pointer", "font-size": "13px",
            padding: `2px ${t.space.sm}`,
            transition: `color ${t.transition.fast}, border-color ${t.transition.fast}`,
          }}
        >⤢</button>
      </div>

      <StatusBar />
      <SessionTuning />
      <MessageList />
      <ChatInput />
    </div>
  );

  return (
    <FocusMode active={focusMode()} onExit={() => setFocusMode(false)}>
      {chatContent}
    </FocusMode>
  );
};

export default ChatView;
