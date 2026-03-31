/**
 * Guest-side interface template for Wasm agent plugins.
 *
 * This file documents the interface a Wasm guest must implement.
 * It cannot be compiled to Wasm without the extism-js compiler toolchain.
 *
 * For development and testing the createGuestHandler factory creates a
 * compatible in-process handler that runs inside InProcessSandbox.
 */

// ── Guest export / host import interfaces ───────────────────────────

export interface GuestExports {
  handle_message(input: string): string;
}

export interface GuestHostImports {
  tool_execute(input: string): string;
  memory_search(input: string): string;
  log(input: string): string;
}

// ── Message shapes (shared between host and guest) ──────────────────

export interface GuestMessage {
  role: string;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface GuestHandleMessageInput {
  messages: GuestMessage[];
  agentId?: string;
  sessionId?: string;
}

export interface GuestToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface GuestHandleMessageOutput {
  content: string;
  toolCalls: GuestToolCall[];
}

// ── In-process guest handler (dev / test implementation) ─────────────

/**
 * Create a guest handler compatible with GuestExports.
 * Used by InProcessSandbox during development and testing.
 *
 * The handler:
 * 1. Parses the JSON input into a GuestHandleMessageInput.
 * 2. Logs the first 50 chars of the last user message.
 * 3. Returns an echo response (no tool calls) so the loop terminates.
 */
export function createGuestHandler(imports: GuestHostImports): GuestExports {
  return {
    handle_message(input: string): string {
      let parsed: GuestHandleMessageInput;
      try {
        parsed = JSON.parse(input) as GuestHandleMessageInput;
      } catch {
        return JSON.stringify({
          content: "[Sandboxed] Error: could not parse input",
          toolCalls: [],
        } satisfies GuestHandleMessageOutput);
      }

      const lastUserMsg = parsed.messages
        .slice()
        .reverse()
        .find((m) => m.role === "user");

      const preview = lastUserMsg?.content?.substring(0, 50) ?? "(no user message)";

      imports.log(
        JSON.stringify({ level: "info", message: `Processing: ${preview}` }),
      );

      return JSON.stringify({
        content: `[Sandboxed] Processed message: ${lastUserMsg?.content ?? ""}`,
        toolCalls: [],
      } satisfies GuestHandleMessageOutput);
    },
  };
}
