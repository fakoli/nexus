import { createStore } from "solid-js/store";
import type { Agent } from "../gateway/types";

// ── Agent store ───────────────────────────────────────────────────────────────

export interface AgentState {
  agents: Agent[];
  currentAgentId: string;
}

export const [agentStore, setAgentStore] = createStore<AgentState>({
  agents: [],
  currentAgentId: "",
});

export function setAgents(agents: Agent[]): void {
  setAgentStore("agents", agents);
}

export function setCurrentAgent(agentId: string): void {
  setAgentStore("currentAgentId", agentId);
}
