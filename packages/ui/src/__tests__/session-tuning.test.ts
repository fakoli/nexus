/**
 * Tests for packages/ui/src/stores/session-tuning.ts
 *
 * solid-js/store is shimmed with a plain-object stand-in (same pattern as
 * stores.test.ts) so no browser/DOM environment is needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Shim solid-js/store ───────────────────────────────────────────────────────

type State = Record<string, unknown>;

function makeStore<T extends State>(initial: T): [T, (...args: unknown[]) => void] {
  const state: T = { ...initial };

  function setStore(...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      // setTuningStore({ ...DEFAULTS })
      Object.assign(state, args[0] as Partial<T>);
    } else if (args.length === 2) {
      // setTuningStore("field", value)
      const key = args[0] as keyof T;
      const val = args[1];
      (state as State)[key as string] =
        typeof val === "function" ? (val as (v: unknown) => unknown)((state as State)[key as string]) : val;
    }
  }

  return [state, setStore];
}

vi.mock("solid-js/store", () => ({
  createStore: (initial: State) => makeStore(initial),
}));

// Import AFTER mock is registered
const {
  tuningStore,
  setTuning,
  resetTuning,
  getTuningParams,
  initTuningFromConfig,
} = await import("../stores/session-tuning");

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetToDefaults(): void {
  resetTuning();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("default values", () => {
  beforeEach(() => resetToDefaults());

  it("has the correct default model", () => {
    expect(tuningStore.model).toBe("claude-sonnet-4-6");
  });

  it("has the correct default provider", () => {
    expect(tuningStore.provider).toBe("anthropic");
  });

  it("has think level off by default", () => {
    expect(tuningStore.thinkLevel).toBe("off");
  });

  it("has temperature 0.7 by default", () => {
    expect(tuningStore.temperature).toBeCloseTo(0.7);
  });

  it("has maxTokens 4096 by default", () => {
    expect(tuningStore.maxTokens).toBe(4096);
  });

  it("has fastMode false by default", () => {
    expect(tuningStore.fastMode).toBe(false);
  });

  it("has verbose false by default", () => {
    expect(tuningStore.verbose).toBe(false);
  });
});

describe("setTuning", () => {
  beforeEach(() => resetToDefaults());

  it("updates model", () => {
    setTuning("model", "gpt-4o");
    expect(tuningStore.model).toBe("gpt-4o");
  });

  it("updates provider", () => {
    setTuning("provider", "openai");
    expect(tuningStore.provider).toBe("openai");
  });

  it("updates thinkLevel", () => {
    setTuning("thinkLevel", "high");
    expect(tuningStore.thinkLevel).toBe("high");
  });

  it("updates temperature", () => {
    setTuning("temperature", 1.2);
    expect(tuningStore.temperature).toBeCloseTo(1.2);
  });

  it("updates maxTokens", () => {
    setTuning("maxTokens", 8192);
    expect(tuningStore.maxTokens).toBe(8192);
  });

  it("updates fastMode to true", () => {
    setTuning("fastMode", true);
    expect(tuningStore.fastMode).toBe(true);
  });

  it("updates verbose to true", () => {
    setTuning("verbose", true);
    expect(tuningStore.verbose).toBe(true);
  });
});

describe("getTuningParams", () => {
  beforeEach(() => resetToDefaults());

  it("returns an object with all required keys", () => {
    const params = getTuningParams();
    expect(params).toHaveProperty("model");
    expect(params).toHaveProperty("provider");
    expect(params).toHaveProperty("thinkLevel");
    expect(params).toHaveProperty("temperature");
    expect(params).toHaveProperty("maxTokens");
    expect(params).toHaveProperty("fastMode");
    expect(params).toHaveProperty("verbose");
  });

  it("reflects current store values", () => {
    setTuning("model", "gemini-pro");
    setTuning("provider", "google");
    setTuning("temperature", 0.3);
    const params = getTuningParams();
    expect(params.model).toBe("gemini-pro");
    expect(params.provider).toBe("google");
    expect(params.temperature).toBeCloseTo(0.3);
  });

  it("returns correct defaults shape", () => {
    const params = getTuningParams();
    expect(params).toEqual({
      model:       "claude-sonnet-4-6",
      provider:    "anthropic",
      thinkLevel:  "off",
      temperature: 0.7,
      maxTokens:   4096,
      fastMode:    false,
      verbose:     false,
    });
  });
});

describe("resetTuning", () => {
  it("restores all fields to defaults after changes", () => {
    setTuning("model", "gpt-4o");
    setTuning("provider", "openai");
    setTuning("thinkLevel", "high");
    setTuning("temperature", 1.8);
    setTuning("maxTokens", 16384);
    setTuning("fastMode", true);
    setTuning("verbose", true);

    resetTuning();

    expect(tuningStore.model).toBe("claude-sonnet-4-6");
    expect(tuningStore.provider).toBe("anthropic");
    expect(tuningStore.thinkLevel).toBe("off");
    expect(tuningStore.temperature).toBeCloseTo(0.7);
    expect(tuningStore.maxTokens).toBe(4096);
    expect(tuningStore.fastMode).toBe(false);
    expect(tuningStore.verbose).toBe(false);
  });
});

describe("initTuningFromConfig", () => {
  beforeEach(() => resetToDefaults());

  it("sets model from config.defaultModel", () => {
    initTuningFromConfig({ defaultModel: "claude-opus-4" });
    expect(tuningStore.model).toBe("claude-opus-4");
  });

  it("sets provider from config.defaultProvider", () => {
    initTuningFromConfig({ defaultProvider: "openai" });
    expect(tuningStore.provider).toBe("openai");
  });

  it("sets thinkLevel from config.thinkLevel", () => {
    initTuningFromConfig({ thinkLevel: "medium" });
    expect(tuningStore.thinkLevel).toBe("medium");
  });

  it("sets temperature from config.temperature", () => {
    initTuningFromConfig({ temperature: 0.5 });
    expect(tuningStore.temperature).toBeCloseTo(0.5);
  });

  it("leaves unspecified fields at their previous value", () => {
    setTuning("maxTokens", 8192);
    initTuningFromConfig({ defaultModel: "gpt-4o" });
    // maxTokens was not in config, so it should keep its previous value
    expect(tuningStore.maxTokens).toBe(8192);
  });

  it("does not override fields when config values are undefined", () => {
    initTuningFromConfig({});
    expect(tuningStore.model).toBe("claude-sonnet-4-6");
    expect(tuningStore.provider).toBe("anthropic");
  });
});
