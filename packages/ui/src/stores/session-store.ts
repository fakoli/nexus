import { createStore } from "solid-js/store";
import type { Message, SessionInfo } from "../gateway/types";

// ── Session store ─────────────────────────────────────────────────────────────

export interface SessionState {
  id: string;
  agentId: string;
  messages: Message[];
}

export const [sessionStore, setSessionStore] = createStore<SessionState>({
  id: "",
  agentId: "",
  messages: [],
});

export const [sessionsListStore, setSessionsListStore] = createStore<{
  sessions: SessionInfo[];
}>({ sessions: [] });

export function appendMessage(msg: Message): void {
  setSessionStore("messages", (msgs) => [...msgs, msg]);
}

export function updateLastMessage(text: string): void {
  setSessionStore("messages", (msgs) => {
    if (msgs.length === 0) return msgs;
    const last = msgs[msgs.length - 1];
    if (last.role !== "assistant") return msgs;
    const updated = { ...last, content: last.content + text };
    return [...msgs.slice(0, -1), updated];
  });
}

export function setCurrentSession(id: string, agentId: string): void {
  setSessionStore("id", id);
  setSessionStore("agentId", agentId);
  setSessionStore("messages", []);
}
