import { describe, it, expect } from "vitest";
import {
  TTSConfigSchema,
  STTConfigSchema,
  SpeechConfigSchema,
} from "../speech-config.js";

// ---------------------------------------------------------------------------
// TTSConfigSchema
// ---------------------------------------------------------------------------

describe("TTSConfigSchema", () => {
  it("applies correct defaults", () => {
    const result = TTSConfigSchema.parse({});
    expect(result.provider).toBe("openai");
    expect(result.defaultVoice).toBe("alloy");
    expect(result.defaultSpeed).toBe(1.0);
    expect(result.defaultFormat).toBe("mp3");
    expect(result.maxTextLength).toBe(4096);
  });

  it("accepts custom values", () => {
    const result = TTSConfigSchema.parse({
      provider: "system",
      defaultVoice: "nova",
      defaultSpeed: 1.5,
      defaultFormat: "opus",
      maxTextLength: 8192,
    });
    expect(result.provider).toBe("system");
    expect(result.defaultVoice).toBe("nova");
    expect(result.defaultFormat).toBe("opus");
  });

  it("rejects speed below 0.25", () => {
    const result = TTSConfigSchema.safeParse({ defaultSpeed: 0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects speed above 4.0", () => {
    const result = TTSConfigSchema.safeParse({ defaultSpeed: 5.0 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid format", () => {
    const result = TTSConfigSchema.safeParse({ defaultFormat: "flac" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STTConfigSchema
// ---------------------------------------------------------------------------

describe("STTConfigSchema", () => {
  it("applies correct defaults", () => {
    const result = STTConfigSchema.parse({});
    expect(result.provider).toBe("openai");
    expect(result.defaultLanguage).toBeUndefined();
    expect(result.maxAudioSize).toBe(25 * 1024 * 1024);
  });

  it("accepts custom language", () => {
    const result = STTConfigSchema.parse({ defaultLanguage: "es" });
    expect(result.defaultLanguage).toBe("es");
  });

  it("rejects invalid provider", () => {
    const result = STTConfigSchema.safeParse({ provider: "azure" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpeechConfigSchema
// ---------------------------------------------------------------------------

describe("SpeechConfigSchema", () => {
  it("applies nested defaults for empty object", () => {
    const result = SpeechConfigSchema.parse({});
    expect(result.tts.provider).toBe("openai");
    expect(result.stt.provider).toBe("openai");
  });

  it("allows overriding tts only", () => {
    const result = SpeechConfigSchema.parse({
      tts: { provider: "system" },
    });
    expect(result.tts.provider).toBe("system");
    expect(result.stt.provider).toBe("openai");
  });
});
