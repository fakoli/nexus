/**
 * Agent RPC handlers.
 *
 * agents.list           — list all agents
 * agents.get            — get agent by id
 * agents.create         — create a new agent
 * agents.update         — update agent config
 * agents.delete         — delete an agent
 * agents.bootstrap.get  — read a bootstrap file for an agent
 * agents.bootstrap.set  — write a bootstrap file for an agent
 */
import { z } from "zod";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  duplicateAgent,
  getBootstrapFile,
  setBootstrapFile,
  listBootstrapFiles,
  createLogger,
} from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:agents");

// ── Param schemas ────────────────────────────────────────────────────

const AgentsListParams = z.object({}).passthrough();

const AgentsGetParams = z.object({
  id: z.string(),
});

const AgentsCreateParams = z.object({
  id: z.string(),
  config: z.record(z.unknown()).default({}),
});

const AgentsUpdateParams = z.object({
  id: z.string(),
  config: z.record(z.unknown()),
});

const AgentsDeleteParams = z.object({
  id: z.string(),
});

const AgentsDuplicateParams = z.object({
  sourceId: z.string(),
  newId: z.string(),
});

const BootstrapGetParams = z.object({
  agentId: z.string().optional(),
  name: z.string(),
});

const BootstrapSetParams = z.object({
  agentId: z.string().optional(),
  name: z.string(),
  content: z.string(),
});

const BootstrapListParams = z.object({
  agentId: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────

function invalidParams(message: string): ResponseFrame {
  return { id: "", ok: false, error: { code: "INVALID_PARAMS", message } };
}

function notFound(id: string): ResponseFrame {
  return { id: "", ok: false, error: { code: "NOT_FOUND", message: `Agent not found: ${id}` } };
}

// ── Handlers ────────────────────────────────────────────────────────

export function handleAgentsList(_params: Record<string, unknown>): ResponseFrame {
  const agents = listAgents();
  return { id: "", ok: true, payload: { agents } };
}

export function handleAgentsGet(params: Record<string, unknown>): ResponseFrame {
  const parsed = AgentsGetParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const agent = getAgent(parsed.data.id);
  if (!agent) return notFound(parsed.data.id);

  return { id: "", ok: true, payload: { agent } };
}

export function handleAgentsCreate(params: Record<string, unknown>): ResponseFrame {
  const parsed = AgentsCreateParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const { id, config } = parsed.data;

  if (getAgent(id)) {
    return { id: "", ok: false, error: { code: "CONFLICT", message: `Agent already exists: ${id}` } };
  }

  try {
    const agent = createAgent(id, config);
    log.info({ agentId: id }, "Agent created");
    return { id: "", ok: true, payload: { agent } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}

export function handleAgentsUpdate(params: Record<string, unknown>): ResponseFrame {
  const parsed = AgentsUpdateParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const { id, config } = parsed.data;
  if (!getAgent(id)) return notFound(id);

  updateAgent(id, config);
  log.info({ agentId: id }, "Agent updated");
  return { id: "", ok: true, payload: { agent: getAgent(id) } };
}

export function handleAgentsDelete(params: Record<string, unknown>): ResponseFrame {
  const parsed = AgentsDeleteParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const deleted = deleteAgent(parsed.data.id);
  if (!deleted) return notFound(parsed.data.id);

  log.info({ agentId: parsed.data.id }, "Agent deleted");
  return { id: "", ok: true, payload: { deleted: true } };
}

export function handleAgentsDuplicate(params: Record<string, unknown>): ResponseFrame {
  const parsed = AgentsDuplicateParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  try {
    const agent = duplicateAgent(parsed.data.sourceId, parsed.data.newId);
    log.info({ sourceId: parsed.data.sourceId, newId: parsed.data.newId }, "Agent duplicated");
    return { id: "", ok: true, payload: { agent } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: msg } };
  }
}

export function handleBootstrapGet(params: Record<string, unknown>): ResponseFrame {
  const parsed = BootstrapGetParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const { agentId, name } = parsed.data;
  const content = getBootstrapFile(name, agentId);
  return { id: "", ok: true, payload: { name, agentId, content } };
}

export function handleBootstrapSet(params: Record<string, unknown>): ResponseFrame {
  const parsed = BootstrapSetParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const { agentId, name, content } = parsed.data;
  try {
    setBootstrapFile(name, content, agentId);
    log.info({ agentId, name }, "Bootstrap file updated");
    return { id: "", ok: true, payload: { name, agentId } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}

export function handleBootstrapList(params: Record<string, unknown>): ResponseFrame {
  const parsed = BootstrapListParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const files = listBootstrapFiles(parsed.data.agentId);
  return { id: "", ok: true, payload: { files, agentId: parsed.data.agentId } };
}
