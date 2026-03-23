/**
 * Memory RPC handlers — CRUD operations for agent memory notes.
 */
import { z } from "zod";
import { addMemory, getMemory, updateMemory, deleteMemory, searchMemory, listMemory } from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

// ── Schemas ─────────────────────────────────────────────────────────

const MemoryAddParams = z.object({
  content: z.string().min(1),
  scope: z.string().default("global"),
  tags: z.array(z.string()).default([]),
});

const MemoryGetParams = z.object({
  id: z.string(),
});

const MemoryUpdateParams = z.object({
  id: z.string(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const MemoryDeleteParams = z.object({
  id: z.string(),
});

const MemorySearchParams = z.object({
  scope: z.string().optional(),
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const MemoryListParams = z.object({
  scope: z.string().default("global"),
  limit: z.number().int().min(1).max(200).default(100),
});

// ── Handlers ────────────────────────────────────────────────────────

export function handleMemoryAdd(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemoryAddParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const note = addMemory(parsed.data.content, parsed.data.scope, parsed.data.tags);
  return { id: "", ok: true, payload: note };
}

export function handleMemoryGet(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemoryGetParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const note = getMemory(parsed.data.id);
  if (!note) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: "Memory note not found" } };
  }
  return { id: "", ok: true, payload: note };
}

export function handleMemoryUpdate(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemoryUpdateParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const note = updateMemory(parsed.data.id, {
    content: parsed.data.content,
    tags: parsed.data.tags,
  });
  if (!note) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: "Memory note not found" } };
  }
  return { id: "", ok: true, payload: note };
}

export function handleMemoryDelete(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemoryDeleteParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const deleted = deleteMemory(parsed.data.id);
  if (!deleted) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: "Memory note not found" } };
  }
  return { id: "", ok: true, payload: { deleted: true } };
}

export function handleMemorySearch(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemorySearchParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const notes = searchMemory(parsed.data);
  return { id: "", ok: true, payload: { notes, count: notes.length } };
}

export function handleMemoryList(params: Record<string, unknown>): ResponseFrame {
  const parsed = MemoryListParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const notes = listMemory(parsed.data.scope, parsed.data.limit);
  return { id: "", ok: true, payload: { notes, count: notes.length } };
}
