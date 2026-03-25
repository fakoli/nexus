/**
 * Agent tools — re-exports all tool registration functions.
 */
export { registerWebFetchTool } from "./web-fetch.js";
export { registerWebSearchTool } from "./web-search.js";
export { registerMemoryTool } from "./memory.js";
export { registerTTSTool } from "./tts.js";
export { registerSTTTool } from "./stt.js";
export {
  TTSConfigSchema,
  STTConfigSchema,
  SpeechConfigSchema,
} from "./speech-config.js";
export type {
  TTSConfig,
  STTConfig,
  SpeechConfig,
  TTSProvider,
  TTSParams,
  TTSResult,
  STTProvider,
  STTParams,
  STTResult,
  Voice,
  TranscriptSegment,
} from "./speech-config.js";
export { resolveTTSProvider, resolveSTTProvider } from "./speech-providers.js";
