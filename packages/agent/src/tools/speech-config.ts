/**
 * Speech configuration schemas and types for TTS and STT tools.
 *
 * Re-exports the canonical schemas from @nexus/core and defines
 * provider-facing types used by TTS/STT tool implementations.
 */
import { z } from "zod";

// ── Config schemas ──────────────────────────────────────────────────

export const TTSConfigSchema = z.object({
  provider: z.enum(["openai", "system"]).default("openai"),
  defaultVoice: z.string().default("alloy"),
  defaultSpeed: z.number().min(0.25).max(4.0).default(1.0),
  defaultFormat: z.enum(["mp3", "opus", "wav"]).default("mp3"),
  maxTextLength: z.number().default(4096),
});

export const STTConfigSchema = z.object({
  provider: z.enum(["openai", "system"]).default("openai"),
  defaultLanguage: z.string().optional(),
  maxAudioSize: z.number().default(25 * 1024 * 1024), // 25 MB
});

export const SpeechConfigSchema = z.object({
  tts: TTSConfigSchema.default({}),
  stt: STTConfigSchema.default({}),
});

// ── Derived types ───────────────────────────────────────────────────

export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type SpeechConfig = z.infer<typeof SpeechConfigSchema>;

// ── Provider types ──────────────────────────────────────────────────

export interface Voice {
  id: string;
  name: string;
  language?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TTSParams {
  text: string;
  voice?: string;
  speed?: number;
  format?: "mp3" | "opus" | "wav";
}

export interface TTSResult {
  audio: Buffer;
  format: string;
  duration?: number;
  sampleRate?: number;
}

export interface TTSProvider {
  id: string;
  name: string;
  synthesize(params: TTSParams): Promise<TTSResult>;
  listVoices?(): Promise<Voice[]>;
}

export interface STTParams {
  audio: Buffer;
  format: string;
  language?: string;
}

export interface STTResult {
  text: string;
  language: string;
  confidence: number;
  segments?: TranscriptSegment[];
}

export interface STTProvider {
  id: string;
  name: string;
  transcribe(params: STTParams): Promise<STTResult>;
}
