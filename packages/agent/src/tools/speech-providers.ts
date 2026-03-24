/**
 * Speech provider resolver — maps provider names to implementations.
 */
import { createLogger } from "@nexus/core";
import type { TTSProvider, STTProvider } from "./speech-config.js";
import { createOpenAISTTProvider } from "./stt-openai.js";

const log = createLogger("agent:tools:speech-providers");

// ── TTS ─────────────────────────────────────────────────────────────

function createOpenAITTSProvider(): TTSProvider {
  return {
    id: "openai",
    name: "OpenAI TTS",

    async synthesize(params) {
      const key = process.env["OPENAI_API_KEY"];
      if (!key) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
      }

      const body = JSON.stringify({
        model: "tts-1",
        input: params.text,
        voice: params.voice ?? "alloy",
        speed: params.speed ?? 1.0,
        response_format: params.format ?? "mp3",
      });

      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body,
      });

      if (!res.ok) {
        const errText = await res.text();
        log.error({ status: res.status, body: errText }, "OpenAI TTS request failed");
        throw new Error(`OpenAI TTS failed: HTTP ${res.status} — ${errText}`);
      }

      const arrayBuf = await res.arrayBuffer();
      return {
        audio: Buffer.from(arrayBuf),
        format: params.format ?? "mp3",
      };
    },

    async listVoices() {
      return [
        { id: "alloy", name: "Alloy" },
        { id: "echo", name: "Echo" },
        { id: "fable", name: "Fable" },
        { id: "onyx", name: "Onyx" },
        { id: "nova", name: "Nova" },
        { id: "shimmer", name: "Shimmer" },
      ];
    },
  };
}

// ── Resolvers ───────────────────────────────────────────────────────

export function resolveTTSProvider(providerName?: string): TTSProvider {
  const name = providerName ?? "openai";
  switch (name) {
    case "openai":
      return createOpenAITTSProvider();
    default:
      log.warn({ provider: name }, "Unknown TTS provider, falling back to OpenAI");
      return createOpenAITTSProvider();
  }
}

export function resolveSTTProvider(providerName?: string): STTProvider {
  const name = providerName ?? "openai";
  switch (name) {
    case "openai":
      return createOpenAISTTProvider();
    default:
      log.warn({ provider: name }, "Unknown STT provider, falling back to OpenAI");
      return createOpenAISTTProvider();
  }
}
