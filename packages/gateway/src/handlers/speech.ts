/**
 * Speech RPC handlers — TTS, STT, and voice listing.
 */
import { z } from "zod";
import { createLogger, events, getAllConfig } from "@nexus/core";
import {
  SpeechConfigSchema,
  resolveTTSProvider,
  resolveSTTProvider,
} from "@nexus/agent";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:speech");

// ── Param Schemas ───────────────────────────────────────────────────

const TTSParams = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  format: z.enum(["mp3", "opus", "wav"]).optional(),
  sessionId: z.string().optional(),
});

const STTParams = z.object({
  audio: z.string().min(1),
  language: z.string().optional(),
  format: z.string().default("mp3"),
  sessionId: z.string().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────

function getSpeechConfig(): z.infer<typeof SpeechConfigSchema> {
  const fullConfig = getAllConfig();
  const speechRaw = (fullConfig as Record<string, unknown>)["speech"];
  return SpeechConfigSchema.parse(speechRaw ?? {});
}

// ── Handlers ────────────────────────────────────────────────────────

export async function handleSpeechTTS(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = TTSParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  const speechConfig = getSpeechConfig();
  const ttsConfig = speechConfig.tts;
  const { text, voice, speed, format, sessionId } = parsed.data;

  if (text.length > ttsConfig.maxTextLength) {
    return {
      id: "",
      ok: false,
      error: {
        code: "TEXT_TOO_LONG",
        message: `Text exceeds maximum length of ${ttsConfig.maxTextLength} characters`,
      },
    };
  }

  const provider = resolveTTSProvider(ttsConfig.provider);

  try {
    const result = await provider.synthesize({
      text,
      voice: voice ?? ttsConfig.defaultVoice,
      speed: speed ?? ttsConfig.defaultSpeed,
      format: format ?? ttsConfig.defaultFormat,
    });

    events.emit("speech:tts", {
      sessionId: sessionId ?? "",
      textLength: text.length,
      voice: voice ?? ttsConfig.defaultVoice,
    });

    log.info({ provider: provider.id, textLength: text.length }, "TTS completed");

    return {
      id: "",
      ok: true,
      payload: {
        audio: result.audio.toString("base64"),
        format: result.format,
        duration: result.duration,
        sampleRate: result.sampleRate,
        byteLength: result.audio.byteLength,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "TTS handler failed");
    return { id: "", ok: false, error: { code: "TTS_ERROR", message: msg } };
  }
}

export async function handleSpeechSTT(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = STTParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  const speechConfig = getSpeechConfig();
  const sttConfig = speechConfig.stt;
  const { audio: audioB64, language, format, sessionId } = parsed.data;

  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(audioB64, "base64");
  } catch {
    return { id: "", ok: false, error: { code: "INVALID_AUDIO", message: "Invalid base64 audio data" } };
  }

  if (audioBuffer.byteLength > sttConfig.maxAudioSize) {
    return {
      id: "",
      ok: false,
      error: {
        code: "AUDIO_TOO_LARGE",
        message: `Audio exceeds maximum size of ${Math.round(sttConfig.maxAudioSize / (1024 * 1024))}MB`,
      },
    };
  }

  const provider = resolveSTTProvider(sttConfig.provider);

  try {
    const result = await provider.transcribe({
      audio: audioBuffer,
      language: language ?? sttConfig.defaultLanguage,
      format,
    });

    events.emit("speech:stt", {
      sessionId: sessionId ?? "",
      audioSize: audioBuffer.byteLength,
      language: result.language,
    });

    log.info({ provider: provider.id, audioSize: audioBuffer.byteLength }, "STT completed");

    return {
      id: "",
      ok: true,
      payload: {
        text: result.text,
        language: result.language,
        confidence: result.confidence,
        segments: result.segments,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "STT handler failed");
    return { id: "", ok: false, error: { code: "STT_ERROR", message: msg } };
  }
}

export async function handleSpeechVoices(
  _params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const speechConfig = getSpeechConfig();
  const provider = resolveTTSProvider(speechConfig.tts.provider);

  try {
    const voices = provider.listVoices ? await provider.listVoices() : [];
    return {
      id: "",
      ok: true,
      payload: { voices, provider: provider.id },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "Voice listing failed");
    return { id: "", ok: false, error: { code: "VOICES_ERROR", message: msg } };
  }
}
