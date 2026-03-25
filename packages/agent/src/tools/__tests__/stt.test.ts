import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getAllConfig: vi.fn(() => ({})),
}));

const mockTranscribe = vi.fn();
vi.mock("../speech-providers.js", () => ({
  resolveSTTProvider: vi.fn(() => ({
    id: "openai",
    name: "OpenAI Whisper",
    transcribe: mockTranscribe,
  })),
}));

let registeredTool: { execute: (input: unknown) => Promise<string> };
vi.mock("../../tool-executor.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTool = tool;
  }),
}));

vi.mock("../speech-config.js", () => {
  const { z } = require("zod");
  const TTSConfigSchema = z.object({
    provider: z.enum(["openai", "system"]).default("openai"),
    defaultVoice: z.string().default("alloy"),
    defaultSpeed: z.number().default(1.0),
    defaultFormat: z.enum(["mp3", "opus", "wav"]).default("mp3"),
    maxTextLength: z.number().default(4096),
  });
  const STTConfigSchema = z.object({
    provider: z.enum(["openai", "system"]).default("openai"),
    defaultLanguage: z.string().optional(),
    maxAudioSize: z.number().default(25 * 1024 * 1024),
  });
  const SpeechConfigSchema = z.object({
    tts: TTSConfigSchema.default({}),
    stt: STTConfigSchema.default({}),
  });
  return { TTSConfigSchema, STTConfigSchema, SpeechConfigSchema };
});

import { registerSTTTool } from "../stt.js";

describe("STT tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerSTTTool();
  });

  it("registers the speech_to_text tool", () => {
    expect(registeredTool).toBeDefined();
  });

  it("rejects empty audio string", async () => {
    const result = await registeredTool.execute({ audio: "" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects missing audio field", async () => {
    const result = await registeredTool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("transcribes valid audio successfully", async () => {
    mockTranscribe.mockResolvedValue({
      text: "Hello world",
      language: "en",
      confidence: 0.95,
      segments: [],
    });

    const audioB64 = Buffer.from("fake-audio-data").toString("base64");
    const result = await registeredTool.execute({ audio: audioB64 });
    const parsed = JSON.parse(result);
    expect(parsed.text).toBe("Hello world");
    expect(parsed.language).toBe("en");
    expect(parsed.confidence).toBe(0.95);
  });

  it("returns error when provider throws", async () => {
    mockTranscribe.mockRejectedValue(new Error("Whisper unavailable"));
    const audioB64 = Buffer.from("data").toString("base64");
    const result = await registeredTool.execute({ audio: audioB64 });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("Whisper unavailable");
  });

  it("defaults format to mp3", async () => {
    mockTranscribe.mockResolvedValue({
      text: "hi",
      language: "en",
      confidence: 1,
    });

    const audioB64 = Buffer.from("data").toString("base64");
    await registeredTool.execute({ audio: audioB64 });
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ format: "mp3" }),
    );
  });
});
