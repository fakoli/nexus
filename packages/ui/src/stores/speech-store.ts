import { createStore } from "solid-js/store";
import type { VoiceInfo } from "../gateway/types";

// ── Speech store ──────────────────────────────────────────────────────────────

export interface SpeechState {
  voices: VoiceInfo[];
  ttsEnabled: boolean;
  sttEnabled: boolean;
}

export const [speechStore, setSpeechStore] = createStore<SpeechState>({
  voices: [],
  ttsEnabled: false,
  sttEnabled: false,
});

export function setVoices(voices: VoiceInfo[]): void {
  setSpeechStore("voices", voices);
}

export function setTtsEnabled(enabled: boolean): void {
  setSpeechStore("ttsEnabled", enabled);
}

export function setSttEnabled(enabled: boolean): void {
  setSpeechStore("sttEnabled", enabled);
}
