import { gateway, setStore } from "./app";
import type { Agent } from "../gateway/types";

// ── agents.list ───────────────────────────────────────────────────────────────

/**
 * Fetches all agents from the server and replaces the local list.
 */
export async function loadAgents(): Promise<void> {
  try {
    const payload = await gateway.request("agents.list", {});
    const agents = (payload.agents as Agent[] | undefined) ?? [];
    setStore("agents", agents);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── agents.create ─────────────────────────────────────────────────────────────

/**
 * Creates a new agent and refreshes the agents list on success.
 */
export async function createAgent(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  try {
    await gateway.request("agents.create", { id, config });
    await loadAgents();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── agents.update ─────────────────────────────────────────────────────────────

/**
 * Updates an existing agent's config and refreshes the agents list on success.
 */
export async function updateAgent(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  try {
    await gateway.request("agents.update", { id, config });
    await loadAgents();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── agents.delete ─────────────────────────────────────────────────────────────

/**
 * Deletes an agent by ID and refreshes the agents list on success.
 */
export async function deleteAgent(id: string): Promise<void> {
  try {
    await gateway.request("agents.delete", { id });
    await loadAgents();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── agents.bootstrap.get ──────────────────────────────────────────────────────

/**
 * Fetches the content of a bootstrap file. Optionally scoped to a specific agent.
 * Returns the file content string, or null on error.
 */
export async function loadBootstrapFile(
  name: string,
  agentId?: string,
): Promise<string | null> {
  try {
    const params: Record<string, unknown> = { name };
    if (agentId) params.agentId = agentId;
    const payload = await gateway.request("agents.bootstrap.get", params);
    return (payload.content as string | undefined) ?? "";
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    return null;
  }
}

// ── agents.bootstrap.set ──────────────────────────────────────────────────────

/**
 * Saves the content of a bootstrap file. Optionally scoped to a specific agent.
 */
export async function saveBootstrapFile(
  name: string,
  content: string,
  agentId?: string,
): Promise<void> {
  try {
    const params: Record<string, unknown> = { name, content };
    if (agentId) params.agentId = agentId;
    await gateway.request("agents.bootstrap.set", params);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}
