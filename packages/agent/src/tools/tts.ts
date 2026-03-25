/**
 * TTS tool — text-to-speech synthesis via a pluggable provider.
 */
import { createLogger, getAllConfig } from "@nexus/core";
import { registerTool } from "../tool-executor.js";
import { SpeechConfigSchema } from "./speech-config.js";
import { resolveTTSProvider } from "./speech-providers.js";

const log = createLogger("agent:tools:tts");

export function registerTTSTool(): void {
  registerTool({
    name: "text_to_speech",
    description: "Convert text to speech audio. Returns base64-encoded audio.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to synthesize" },
        voice: { type: "string", description: "Voice id (e.g. alloy, nova)" },
        speed: { type: "number", description: "Speed multiplier 0.25–4.0" },
        format: { type: "string", enum: ["mp3", "opus", "wav"], description: "Output format" },
      },
      required: ["text"],
    },

    async execute(input: Record<string, unknown>): Promise<string> {
      const params = input;
      const text = typeof params["text"] === "string" ? params["text"] : "";
      const voice = typeof params["voice"] === "string" ? params["voice"] : undefined;
      const speed = typeof params["speed"] === "number" ? params["speed"] : undefined;
      const format = typeof params["format"] === "string" ? params["format"] : undefined;

      if (!text) {
        return JSON.stringify({ error: "text is required and must be non-empty" });
      }

      if (speed !== undefined && (speed < 0.25 || speed > 4.0)) {
        return JSON.stringify({ error: "speed must be between 0.25 and 4.0" });
      }

      const validFormats = ["mp3", "opus", "wav"];
      if (format !== undefined && !validFormats.includes(format)) {
        return JSON.stringify({ error: `Invalid format: ${format}. Must be one of: ${validFormats.join(", ")}` });
      }

      // Load config
      let speechConfig;
      try {
        const allConfig = getAllConfig();
        speechConfig = SpeechConfigSchema.parse(allConfig.speech ?? {});
      } catch {
        speechConfig = SpeechConfigSchema.parse({});
      }

      if (text.length > speechConfig.tts.maxTextLength) {
        return JSON.stringify({ error: `Text exceeds maximum length of ${speechConfig.tts.maxTextLength} characters` });
      }

      try {
        const provider = resolveTTSProvider(speechConfig.tts.provider);
        const result = await provider.synthesize({
          text,
          voice: voice ?? speechConfig.tts.defaultVoice,
          speed: speed ?? speechConfig.tts.defaultSpeed,
          format: (format as "mp3" | "opus" | "wav") ?? speechConfig.tts.defaultFormat,
        });

        log.info({ format: result.format, size: result.audio.byteLength }, "TTS synthesis complete");

        return JSON.stringify({
          audio: result.audio.toString("base64"),
          format: result.format,
          duration: result.duration,
          sampleRate: result.sampleRate,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "TTS synthesis failed");
        return JSON.stringify({ error: msg });
      }
    },
  });
}
