import { describe, it, expect, vi } from "vitest";
import { createGuestHandler } from "../guest/template.js";
import type { GuestHostImports, GuestHandleMessageOutput } from "../guest/template.js";

function makeImports(overrides?: Partial<GuestHostImports>): GuestHostImports {
  return {
    tool_execute: vi.fn().mockReturnValue(JSON.stringify({ ok: true })),
    memory_search: vi.fn().mockReturnValue(JSON.stringify({ results: [] })),
    log: vi.fn().mockReturnValue(JSON.stringify({ ok: true })),
    ...overrides,
  };
}

describe("createGuestHandler", () => {
  it("returns a handle_message export", () => {
    const handler = createGuestHandler(makeImports());
    expect(typeof handler.handle_message).toBe("function");
  });

  it("echoes the user message content", () => {
    const imports = makeImports();
    const handler = createGuestHandler(imports);
    const input = JSON.stringify({
      messages: [{ role: "user", content: "Hello, sandbox!" }],
    });
    const rawResult = handler.handle_message(input);
    const result = JSON.parse(rawResult) as GuestHandleMessageOutput;
    expect(result.content).toContain("Hello, sandbox!");
    expect(result.toolCalls).toEqual([]);
  });

  it("calls imports.log for the preview", () => {
    const imports = makeImports();
    const handler = createGuestHandler(imports);
    const input = JSON.stringify({
      messages: [{ role: "user", content: "Test message" }],
    });
    handler.handle_message(input);
    expect(imports.log).toHaveBeenCalled();
    const logArg = (imports.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const logObj = JSON.parse(logArg) as { level: string; message: string };
    expect(logObj.level).toBe("info");
    expect(logObj.message).toContain("Test message");
  });

  it("handles malformed JSON gracefully", () => {
    const imports = makeImports();
    const handler = createGuestHandler(imports);
    const rawResult = handler.handle_message("not-json");
    const result = JSON.parse(rawResult) as GuestHandleMessageOutput;
    expect(result.content).toContain("Error");
    expect(result.toolCalls).toEqual([]);
  });

  it("uses the last user message when multiple messages are present", () => {
    const imports = makeImports();
    const handler = createGuestHandler(imports);
    const input = JSON.stringify({
      messages: [
        { role: "user", content: "First message" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "Second message" },
      ],
    });
    const rawResult = handler.handle_message(input);
    const result = JSON.parse(rawResult) as GuestHandleMessageOutput;
    expect(result.content).toContain("Second message");
  });

  it("handles empty messages array gracefully", () => {
    const imports = makeImports();
    const handler = createGuestHandler(imports);
    const input = JSON.stringify({ messages: [] });
    const rawResult = handler.handle_message(input);
    const result = JSON.parse(rawResult) as GuestHandleMessageOutput;
    expect(result.toolCalls).toEqual([]);
  });
});
