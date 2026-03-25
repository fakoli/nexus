/**
 * Memory tool — allows the agent to save, search, and list memory notes.
 *
 * Wraps the @nexus/core memory module so the agent can persist
 * information across conversations.
 */
import { z } from "zod";
import { createLogger, recordAudit, addMemory, searchMemory, listMemory } from "@nexus/core";
import type { MemoryNote } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

const log = createLogger("agent:tools:memory");

// ── Input validation ─────────────────────────────────────────────────

const MemoryInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    content: z.string().min(1).max(10_000),
    tags: z.array(z.string().max(100)).max(20).default([]),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1).max(500),
    tags: z.array(z.string().max(100)).max(20).optional(),
  }),
  z.object({
    action: z.literal("list"),
    tags: z.array(z.string().max(100)).max(20).optional(),
  }),
]);

// ── Formatting ───────────────────────────────────────────────────────

function formatNote(note: MemoryNote): string {
  const tagStr = note.tags.length > 0 ? ` [${note.tags.join(", ")}]` : "";
  const date = new Date(note.createdAt * 1000).toISOString();
  return `- [${note.id}] (${date})${tagStr}\n  ${note.content}`;
}

function formatNotes(notes: MemoryNote[], label: string): string {
  if (notes.length === 0) {
    return `No memory notes found (${label}).`;
  }
  const header = `Found ${notes.length} memory note(s) (${label}):\n`;
  return header + notes.map(formatNote).join("\n\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerMemoryTool(): void {
  registerTool({
    name: "memory",
    description:
      "Save, search, or list persistent memory notes. Use to remember " +
      "important information across conversations. " +
      "Actions: save (store a note), search (find notes by text), list (recent notes).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["save", "search", "list"],
          description: "The memory action to perform",
        },
        content: {
          type: "string",
          description: "The content to save (required for 'save' action)",
        },
        query: {
          type: "string",
          description: "Search query text (required for 'search' action)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorisation",
        },
      },
      required: ["action"],
    },
    async execute(input) {
      const parsed = MemoryInput.safeParse(input);
      if (!parsed.success) {
        return JSON.stringify({ error: `Invalid input: ${parsed.error.message}` });
      }

      const data = parsed.data;
      recordAudit("memory_tool", "agent", { action: data.action });

      try {
        switch (data.action) {
          case "save": {
            const note = addMemory(data.content, "global", data.tags);
            log.info({ noteId: note.id, tags: data.tags }, "Memory note saved");
            return `Memory note saved (id: ${note.id}).`;
          }
          case "search": {
            const results = searchMemory({
              query: data.query,
              tags: data.tags,
              limit: 20,
            });
            log.info({ query: data.query, count: results.length }, "Memory search");
            return formatNotes(results, `search: "${data.query}"`);
          }
          case "list": {
            const notes = listMemory("global", 20);
            log.info({ count: notes.length }, "Memory list");
            return formatNotes(notes, "recent");
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ action: data.action, error: msg }, "Memory tool failed");
        return JSON.stringify({ error: msg });
      }
    },
  });
}
