/**
 * STT tool — speech-to-text transcription via a pluggable provider.
 */
import { createLogger, getAllConfig } from "@nexus/core";
import { registerTool } from "../tool-executor.js";
import { SpeechConfigSchema } from "./speech-config.js";
import { resolveSTTProvider } from "./speech-providers.js";

const log = createLogger("agent:tools:stt");

export function registerSTTTool(): void {
  registerTool({
    name: "speech_to_text",
    description: "Transcribe audio to text. Accepts base64-encoded audio.",
    parameters: {
      type: "object",
      properties: {
        audio: { type: "string", description: "Base64-encoded audio data" },
        language: { type: "string", description: "Language code (e.g. en, es)" },
        format: { type: "string", description: "Audio format (e.g. mp3, wav, webm)" },
      },
      required: ["audio"],
    },

    async execute(input: Record<string, unknown>): Promise<string> {
      const params = input;
      const audioB64 = typeof params["audio"] === "string" ? params["audio"] : "";
      const language = typeof params["language"] === "string" ? params["language"] : undefined;
      const format = typeof params["format"] === "string" ? params["format"] : "mp3";

      if (!audioB64) {
        return JSON.stringify({ error: "audio is required and must be a non-empty base64 string" });
      }

      const audioBuf = Buffer.from(audioB64, "base64");

      // Load config
      let speechConfig;
      try {
        const allConfig = getAllConfig();
        speechConfig = SpeechConfigSchema.parse(allConfig.speech ?? {});
      } catch {
        speechConfig = SpeechConfigSchema.parse({});
      }

      if (audioBuf.byteLength > speechConfig.stt.maxAudioSize) {
        return JSON.stringify({ error: `Audio exceeds maximum size of ${speechConfig.stt.maxAudioSize} bytes` });
      }

      try {
        const provider = resolveSTTProvider(speechConfig.stt.provider);
        const result = await provider.transcribe({
          audio: audioBuf,
          format,
          language: language ?? speechConfig.stt.defaultLanguage,
        });

        log.info({ language: result.language, textLength: result.text.length }, "STT transcription complete");

        return JSON.stringify({
          text: result.text,
          language: result.language,
          confidence: result.confidence,
          segments: result.segments,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "STT transcription failed");
        return JSON.stringify({ error: msg });
      }
    },
  });
}
