import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  events: { emit: vi.fn() },
  getAllConfig: vi.fn(() => ({})),
}));

// Mock @nexus/agent speech modules
const mockSynthesize = vi.fn();
const mockTranscribe = vi.fn();
const mockListVoices = vi.fn();

vi.mock("@nexus/agent", () => ({
  SpeechConfigSchema: {
    parse: vi.fn(() => ({
      tts: {
        provider: "mock",
        maxTextLength: 5000,
        defaultVoice: "alloy",
        defaultSpeed: 1.0,
        defaultFormat: "mp3",
      },
      stt: {
        provider: "mock",
        maxAudioSize: 25 * 1024 * 1024,
        defaultLanguage: "en",
      },
    })),
  },
  resolveTTSProvider: vi.fn(() => ({
    id: "mock-tts",
    synthesize: mockSynthesize,
    listVoices: mockListVoices,
  })),
  resolveSTTProvider: vi.fn(() => ({
    id: "mock-stt",
    transcribe: mockTranscribe,
  })),
}));

import {
  handleSpeechTTS,
  handleSpeechSTT,
  handleSpeechVoices,
} from "../speech.js";
import type { ResponseFrame } from "../../protocol/frames.js";

function payload(r: ResponseFrame): Record<string, unknown> {
  return r.payload as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSpeechTTS", () => {
  it("rejects missing text param", async () => {
    const result = await handleSpeechTTS({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects empty text param", async () => {
    const result = await handleSpeechTTS({ text: "" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects invalid speed value", async () => {
    const result = await handleSpeechTTS({ text: "hello", speed: 10 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects invalid format value", async () => {
    const result = await handleSpeechTTS({ text: "hello", format: "aac" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns audio on valid request", async () => {
    mockSynthesize.mockResolvedValue({
      audio: Buffer.from("fake-audio"),
      format: "mp3",
      duration: 1.5,
      sampleRate: 24000,
    });

    const result = await handleSpeechTTS({ text: "Hello world" });
    expect(result.ok).toBe(true);
    expect(result.payload).toHaveProperty("audio");
    expect(result.payload).toHaveProperty("format", "mp3");
  });

  it("returns TTS_ERROR on provider failure", async () => {
    mockSynthesize.mockRejectedValue(new Error("Provider down"));
    const result = await handleSpeechTTS({ text: "Hello" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TTS_ERROR");
  });
});

describe("handleSpeechSTT", () => {
  it("rejects missing audio param", async () => {
    const result = await handleSpeechSTT({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects empty audio param", async () => {
    const result = await handleSpeechSTT({ audio: "" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns transcription on valid request", async () => {
    const audioB64 = Buffer.from("fake-audio-data").toString("base64");
    mockTranscribe.mockResolvedValue({
      text: "Hello world",
      language: "en",
      confidence: 0.95,
      segments: [],
    });

    const result = await handleSpeechSTT({ audio: audioB64 });
    expect(result.ok).toBe(true);
    expect(result.payload).toHaveProperty("text", "Hello world");
    expect(result.payload).toHaveProperty("language", "en");
  });

  it("returns STT_ERROR on provider failure", async () => {
    const audioB64 = Buffer.from("data").toString("base64");
    mockTranscribe.mockRejectedValue(new Error("Transcription failed"));
    const result = await handleSpeechSTT({ audio: audioB64 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("STT_ERROR");
  });
});

describe("handleSpeechVoices", () => {
  it("returns voice list", async () => {
    mockListVoices.mockResolvedValue([
      { id: "alloy", name: "Alloy" },
      { id: "echo", name: "Echo" },
    ]);

    const result = await handleSpeechVoices({});
    expect(result.ok).toBe(true);
    expect(result.payload).toHaveProperty("voices");
    expect(payload(result).provider).toBe("mock-tts");
  });

  it("returns VOICES_ERROR on provider failure", async () => {
    mockListVoices.mockRejectedValue(new Error("List failed"));
    const result = await handleSpeechVoices({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VOICES_ERROR");
  });
});
