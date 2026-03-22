import { Component, For, onMount, createEffect } from "solid-js";
import { store } from "../../stores/app";
import MessageBubble from "./MessageBubble";

const MessageList: Component = () => {
  let bottomRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom whenever messages change
  createEffect(() => {
    const _ = store.session.messages.length;
    bottomRef?.scrollIntoView({ behavior: "smooth" });
  });

  onMount(() => {
    bottomRef?.scrollIntoView({ behavior: "instant" });
  });

  return (
    <div
      style={{
        flex: "1",
        "overflow-y": "auto",
        display: "flex",
        "flex-direction": "column",
        padding: "12px 0",
        gap: "2px",
      }}
    >
      <For
        each={store.session.messages}
        fallback={
          <div style={{
            flex: "1",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#555",
            "font-size": "14px",
          }}>
            No messages yet. Start a conversation.
          </div>
        }
      >
        {(msg) => (
          <MessageBubble
            role={msg.role}
            content={msg.content}
            createdAt={msg.timestamp}
          />
        )}
      </For>
      <div ref={bottomRef} style={{ height: "1px" }} />
    </div>
  );
};

export default MessageList;
