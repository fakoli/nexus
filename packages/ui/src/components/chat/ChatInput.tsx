import { Component, createEffect } from "solid-js";
import { store, setStore } from "../../stores/app";
import { sendMessage } from "../../stores/actions";
import { setFocusMode } from "../../stores/focus-mode";

const ChatInput: Component = () => {
  let textareaRef: HTMLTextAreaElement | undefined;

  const handleSend = () => {
    const text = store.chat.input.trim();
    if (!text || store.chat.sending) return;
    // Handle /focus command — update signal; ChatView reads it reactively
    if (text === "/focus") {
      setStore("chat", "input", "");
      setFocusMode(true);
      return;
    }
    sendMessage(text);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  createEffect(() => {
    const _ = store.chat.input;
    if (textareaRef) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = Math.min(textareaRef.scrollHeight, 160) + "px";
    }
  });

  return (
    <div class="nx-chat-input" style={{
      padding: "12px 16px 16px",
      "border-top": "1px solid #2a2a45",
      background: "#1a1a2e",
    }}>
      <div style={{
        display: "flex",
        gap: "10px",
        "align-items": "flex-end",
        background: "#22223a",
        "border-radius": "12px",
        padding: "8px 12px",
        border: "1px solid #3a3a5c",
      }}>
        <textarea
          ref={textareaRef}
          value={store.chat.input}
          onInput={(e) => setStore("chat", "input", e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={store.chat.sending}
          placeholder="Type a message… (Ctrl+Enter to send)"
          rows={1}
          style={{
            flex: "1",
            background: "transparent",
            border: "none",
            outline: "none",
            color: store.chat.sending ? "#666" : "#e0e0e0",
            "font-size": "14px",
            "font-family": "inherit",
            resize: "none",
            "line-height": "1.5",
            "min-height": "24px",
            "max-height": "160px",
            overflow: "auto",
            cursor: store.chat.sending ? "not-allowed" : "text",
          }}
        />
        <button
          onClick={handleSend}
          disabled={store.chat.sending || !store.chat.input.trim()}
          style={{
            background: store.chat.sending || !store.chat.input.trim() ? "#2e2e50" : "#4a9eff",
            border: "none",
            "border-radius": "8px",
            color: store.chat.sending || !store.chat.input.trim() ? "#666" : "#fff",
            cursor: store.chat.sending || !store.chat.input.trim() ? "not-allowed" : "pointer",
            "font-size": "13px",
            "font-weight": "600",
            padding: "7px 14px",
            transition: "background 0.15s, color 0.15s",
            "white-space": "nowrap",
            "flex-shrink": "0",
          }}
        >
          {store.chat.sending
            ? <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                <Spinner /> Thinking…
              </span>
            : "Send"}
        </button>
      </div>
      <div style={{ "font-size": "11px", color: "#444", "margin-top": "5px", "text-align": "center" }}>
        Ctrl+Enter to send
      </div>
    </div>
  );
};

const Spinner: Component = () => (
  <>
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      .spinner { width: 12px; height: 12px; border: 2px solid #555; border-top-color: #aaa; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
    `}</style>
    <span class="spinner" />
  </>
);

export default ChatInput;
