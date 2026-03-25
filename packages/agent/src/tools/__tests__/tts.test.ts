import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getAllConfig: vi.fn(() => ({})),
}));

// Mock speech-providers
const mockSynthesize = vi.fn();
vi.mock("../speech-providers.js", () => ({
  resolveTTSProvider: vi.fn(() => ({
    id: "openai",
    name: "OpenAI TTS",
    synthesize: mockSynthesize,
    listVoices: vi.fn(async () => []),
  })),
}));

// Mock tool registration — capture the tool
let registeredTool: { execute: (input: unknown) => Promise<string> };
vi.mock("../../tool-executor.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTool = tool;
  }),
}));

// Mock speech-config to return defaults
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

import { registerTTSTool } from "../tts.js";

describe("TTS tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerTTSTool();
  });

  it("registers with name text_to_speech", () => {
    expect(registeredTool).toBeDefined();
  });

  it("rejects empty text", async () => {
    const result = await registeredTool.execute({ text: "" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects speed out of range", async () => {
    const result = await registeredTool.execute({ text: "hi", speed: 10 });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects invalid format", async () => {
    const result = await registeredTool.execute({ text: "hi", format: "aac" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("calls provider and returns base64 audio on success", async () => {
    const audioBuf = Buffer.from("fake-audio");
    mockSynthesize.mockResolvedValue({
      audio: audioBuf,
      format: "mp3",
      duration: 1.5,
      sampleRate: 24000,
    });

    const result = await registeredTool.execute({ text: "Hello world" });
    const parsed = JSON.parse(result);
    expect(parsed.audio).toBe(audioBuf.toString("base64"));
    expect(parsed.format).toBe("mp3");
    expect(parsed.duration).toBe(1.5);
  });

  it("returns error when text exceeds maxTextLength", async () => {
    const longText = "a".repeat(5000);
    const result = await registeredTool.execute({ text: longText });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("maximum length");
  });

  it("returns error when provider throws", async () => {
    mockSynthesize.mockRejectedValue(new Error("API key missing"));
    const result = await registeredTool.execute({ text: "hello" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("API key missing");
  });
});
