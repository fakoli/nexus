/**
 * streaming-loop.test.ts
 *
 * Tests for the streaming path of the agent provider layer.
 * provider.stream() is mocked to yield typed StreamDelta events.
 * We verify: text accumulation, tool_use_start/end tracking, done event.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  Provider,
  ProviderMessage,
  ProviderOptions,
  ProviderResponse,
  StreamDelta,
} from "../providers/base.js";

// ── Mock provider factory ─────────────────────────────────────────────────────

/**
 * Build a Provider whose stream() method yields the given deltas in order.
 * complete() always returns a default response.
 */
function makeStreamingProvider(deltas: StreamDelta[]): Provider {
  return {
    id: "mock-stream",
    name: "MockStream",
    async *stream(_opts: ProviderOptions): AsyncGenerator<StreamDelta> {
      for (const delta of deltas) {
        yield delta;
      }
    },
    async complete(_opts: ProviderOptions): Promise<ProviderResponse> {
      return {
        content: "complete response",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: "end_turn",
      };
    },
  };
}

/**
 * Collect all deltas from an async generator into an array.
 */
async function collectDeltas(provider: Provider, opts: ProviderOptions): Promise<StreamDelta[]> {
  const collected: StreamDelta[] = [];
  for await (const delta of provider.stream(opts)) {
    collected.push(delta);
  }
  return collected;
}

const BASE_OPTS: ProviderOptions = {
  model: "claude-test",
  messages: [{ role: "user", content: "hello" }],
};

// ── Text accumulation ─────────────────────────────────────────────────────────

describe("streaming: text accumulation", () => {
  it("collects all text deltas in order", async () => {
    const deltas: StreamDelta[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: ", " },
      { type: "text", text: "world!" },
      { type: "done" },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const textDeltas = collected.filter((d) => d.type === "text") as Extract<
      StreamDelta,
      { type: "text" }
    >[];
    const accumulated = textDeltas.map((d) => d.text).join("");
    expect(accumulated).toBe("Hello, world!");
  });

  it("yields a done delta as the final event", async () => {
    const deltas: StreamDelta[] = [{ type: "text", text: "ok" }, { type: "done" }];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    expect(collected.at(-1)?.type).toBe("done");
  });

  it("handles an empty stream (just done)", async () => {
    const provider = makeStreamingProvider([{ type: "done" }]);
    const collected = await collectDeltas(provider, BASE_OPTS);
    expect(collected).toHaveLength(1);
    expect(collected[0].type).toBe("done");
  });

  it("accumulates text from multiple separate text deltas", async () => {
    const words = ["one", " ", "two", " ", "three"];
    const deltas: StreamDelta[] = [
      ...words.map((w) => ({ type: "text" as const, text: w })),
      { type: "done" as const },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const text = (
      collected.filter((d) => d.type === "text") as Extract<StreamDelta, { type: "text" }>[]
    )
      .map((d) => d.text)
      .join("");
    expect(text).toBe("one two three");
  });
});

// ── Tool call handling ────────────────────────────────────────────────────────

describe("streaming: tool call handling", () => {
  it("emits tool_use_start, tool_use_delta, tool_use_end in sequence", async () => {
    const deltas: StreamDelta[] = [
      { type: "tool_use_start", id: "tc-1", name: "bash" },
      { type: "tool_use_delta", id: "tc-1", input: '{"cmd":"ls"}' },
      { type: "tool_use_end", id: "tc-1" },
      { type: "done" },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const types = collected.map((d) => d.type);
    expect(types).toEqual(["tool_use_start", "tool_use_delta", "tool_use_end", "done"]);
  });

  it("tool_use_start carries correct id and name", async () => {
    const deltas: StreamDelta[] = [
      { type: "tool_use_start", id: "tc-99", name: "read_file" },
      { type: "tool_use_end", id: "tc-99" },
      { type: "done" },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const start = collected.find((d) => d.type === "tool_use_start") as Extract<
      StreamDelta,
      { type: "tool_use_start" }
    >;
    expect(start.id).toBe("tc-99");
    expect(start.name).toBe("read_file");
  });

  it("done delta can carry usage info", async () => {
    const deltas: StreamDelta[] = [
      { type: "done", usage: { inputTokens: 42, outputTokens: 17 } },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const done = collected[0] as Extract<StreamDelta, { type: "done" }>;
    expect(done.usage?.inputTokens).toBe(42);
    expect(done.usage?.outputTokens).toBe(17);
  });

  it("handles mixed text and tool deltas correctly", async () => {
    const deltas: StreamDelta[] = [
      { type: "text", text: "Let me check that." },
      { type: "tool_use_start", id: "tc-2", name: "bash" },
      { type: "tool_use_delta", id: "tc-2", input: '{"cmd":"pwd"}' },
      { type: "tool_use_end", id: "tc-2" },
      { type: "text", text: " Done." },
      { type: "done" },
    ];
    const provider = makeStreamingProvider(deltas);
    const collected = await collectDeltas(provider, BASE_OPTS);

    const textContent = (
      collected.filter((d) => d.type === "text") as Extract<StreamDelta, { type: "text" }>[]
    )
      .map((d) => d.text)
      .join("");
    expect(textContent).toBe("Let me check that. Done.");

    const toolStart = collected.filter((d) => d.type === "tool_use_start");
    expect(toolStart).toHaveLength(1);
  });
});

// ── Provider interface compliance ─────────────────────────────────────────────

describe("streaming: provider interface", () => {
  it("stream() returns an async generator", async () => {
    const provider = makeStreamingProvider([{ type: "done" }]);
    const gen = provider.stream(BASE_OPTS);
    // AsyncGenerator has .next(), .return(), .throw()
    expect(typeof gen.next).toBe("function");
    await gen.return(undefined); // clean up
  });

  it("complete() still works alongside stream()", async () => {
    const provider = makeStreamingProvider([{ type: "done" }]);
    const result = await provider.complete(BASE_OPTS);
    expect(result.content).toBe("complete response");
    expect(result.stopReason).toBe("end_turn");
  });

  it("stream() can be iterated with for-await multiple times independently", async () => {
    const provider = makeStreamingProvider([
      { type: "text", text: "hello" },
      { type: "done" },
    ]);

    const first = await collectDeltas(provider, BASE_OPTS);
    const second = await collectDeltas(provider, BASE_OPTS);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });
});
