/**
 * Context builder — assembles the system prompt and message history.
 *
 * This is one of 6 composable units replacing OpenClaw's 3,212-line attempt.ts.
 * Responsibility: build the prompt. Nothing else.
 */
import { getMessages, createLogger, loadBootstrapContent } from "@nexus/core";
import type { ProviderMessage, ToolDefinition } from "./providers/base.js";
import type { EmbeddingProvider, VectorStore } from "@nexus/rag";

const log = createLogger("agent:context");

const DEFAULT_SYSTEM_PROMPT = `You are Nexus, a helpful personal AI assistant.
You can use tools when they would help answer the user's request.
Be concise and direct. Focus on being genuinely helpful.`;

const MESSAGE_TABLE = "message_vectors";

export interface RagOptions {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  topK?: number;
  similarityThreshold?: number;
  currentQuery?: string;
}

export interface ContextOptions {
  sessionId: string;
  agentId?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxHistoryMessages?: number;
  ragOptions?: RagOptions;
}

export interface BuiltContext {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
}

export async function buildContext(options: ContextOptions): Promise<BuiltContext> {
  const { sessionId, agentId, maxHistoryMessages = 100, ragOptions } = options;

  const bootstrapContent = loadBootstrapContent(agentId);
  const base = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPromptBase = bootstrapContent ? `${bootstrapContent}\n\n${base}` : base;
  const tools = options.tools ?? [];

  // Load message history from SQLite
  const dbMessages = getMessages(sessionId, maxHistoryMessages);

  const messages: ProviderMessage[] = dbMessages.map((m) => {
    const meta = m.metadata as Record<string, unknown> | undefined;
    const toolCallId = typeof meta?.toolCallId === "string" ? meta.toolCallId : undefined;
    const name = typeof meta?.toolName === "string" ? meta.toolName : undefined;
    const role: ProviderMessage["role"] =
      m.role === "tool_use" ? "assistant" : m.role === "tool_result" ? "tool" : (m.role as ProviderMessage["role"]);
    return { role, content: m.content, toolCallId, name };
  });

  // ── RAG: semantic context retrieval ──────────────────────────────────────────
  let systemPrompt = systemPromptBase;

  if (ragOptions && ragOptions.currentQuery) {
    const ragContext = await fetchSemanticContext(ragOptions, messages);
    if (ragContext.length > 0) {
      const contextBlock = buildContextBlock(ragContext);
      systemPrompt = `${contextBlock}\n\n${systemPromptBase}`;
    }
  }

  log.debug(
    { sessionId, messageCount: messages.length, toolCount: tools.length, ragEnabled: Boolean(ragOptions?.currentQuery) },
    "Context built",
  );

  return { systemPrompt, messages, tools };
}

// ── Semantic retrieval helpers ────────────────────────────────────────────────

interface RetrievedMessage {
  content: string;
  sessionId: string;
  role: string;
  score: number;
}

async function fetchSemanticContext(
  ragOptions: RagOptions,
  existingMessages: ProviderMessage[],
): Promise<RetrievedMessage[]> {
  const { embeddingProvider, vectorStore, topK = 5, similarityThreshold = 0.7, currentQuery } = ragOptions;

  if (!currentQuery) return [];

  let embedding: number[];
  try {
    [embedding] = await embeddingProvider.embed([currentQuery]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "RAG embedding failed; skipping semantic context");
    return [];
  }

  let results: Array<{ content: string; metadata: Record<string, unknown>; distance: number }>;
  try {
    const table = await vectorStore.getOrCreateTable(MESSAGE_TABLE);
    results = await table.search(embedding, { limit: topK });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "RAG vector search failed; skipping semantic context");
    return [];
  }

  // Build a set of existing message contents for dedup
  const existingContents = new Set(existingMessages.map((m) => m.content));

  const retrieved: RetrievedMessage[] = [];
  for (const result of results) {
    const score = Math.max(0, 1 - result.distance);
    if (score < similarityThreshold) continue;
    if (existingContents.has(result.content)) continue;

    retrieved.push({
      content: result.content,
      sessionId: typeof result.metadata["session_id"] === "string" ? result.metadata["session_id"] : "",
      role: typeof result.metadata["role"] === "string" ? result.metadata["role"] : "unknown",
      score,
    });
  }

  return retrieved;
}

function buildContextBlock(messages: RetrievedMessage[]): string {
  const lines = ["Relevant context from previous conversations:"];
  for (const m of messages) {
    lines.push(`[${m.role}]: ${m.content}`);
  }
  return lines.join("\n");
}
