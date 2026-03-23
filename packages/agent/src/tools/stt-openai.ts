/**
 * OpenAI STT provider — uses the audio/transcriptions endpoint (Whisper).
 */
import { createLogger } from "@nexus/core";
import type { STTProvider, STTParams, STTResult } from "./speech-config.js";

const log = createLogger("agent:tools:stt:openai");

function getApiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return key;
}

/** Map audio format string to a MIME type for the multipart upload. */
function formatToMime(format: string): string {
  const mimes: Record<string, string> = {
    mp3: "audio/mpeg",
    opus: "audio/opus",
    wav: "audio/wav",
    webm: "audio/webm",
    m4a: "audio/mp4",
    flac: "audio/flac",
  };
  return mimes[format] ?? "application/octet-stream";
}

export function createOpenAISTTProvider(): STTProvider {
  return {
    id: "openai",
    name: "OpenAI Whisper",

    async transcribe(params: STTParams): Promise<STTResult> {
      const apiKey = getApiKey();
      log.info({ format: params.format, audioSize: params.audio.byteLength }, "Transcribing via OpenAI Whisper");

      const mime = formatToMime(params.format);
      const extension = params.format || "mp3";

      // Build multipart/form-data manually using Blob + FormData
      const formData = new FormData();
      const arrayBuf = params.audio.buffer.slice(
        params.audio.byteOffset,
        params.audio.byteOffset + params.audio.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuf], { type: mime });
      formData.append("file", blob, `audio.${extension}`);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");

      if (params.language) {
        formData.append("language", params.language);
      }

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        log.error({ status: response.status, body: errText }, "OpenAI STT request failed");
        throw new Error(`OpenAI STT failed: HTTP ${response.status} — ${errText}`);
      }

      const data = await response.json() as {
        text: string;
        language: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      };

      return {
        text: data.text,
        language: data.language ?? params.language ?? "en",
        confidence: 1.0, // Whisper does not return a top-level confidence
        segments: data.segments?.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        })),
      };
    },
  };
}
