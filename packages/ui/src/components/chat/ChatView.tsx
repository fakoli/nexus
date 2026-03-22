import { Component, onMount } from "solid-js";
import { loadHistory } from "../../stores/actions";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import StatusBar from "../shared/StatusBar";

const ChatView: Component = () => {
  onMount(() => {
    loadHistory();
  });

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      background: "#1a1a2e",
      color: "#e0e0e0",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      overflow: "hidden",
    }}>
      <StatusBar />
      <MessageList />
      <ChatInput />
    </div>
  );
};

export default ChatView;
