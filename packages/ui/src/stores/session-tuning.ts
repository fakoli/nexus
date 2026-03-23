/**
 * Session-level AI tuning store.
 * These params are merged into every agent.stream request so power users
 * can override provider/model/temperature without touching global config.
 */
import { createStore } from "solid-js/store";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThinkLevel = "off" | "low" | "medium" | "high";

export interface SessionTuningState {
  model: string;
  provider: string;
  thinkLevel: ThinkLevel;
  temperature: number;
  maxTokens: number;
  fastMode: boolean;
  verbose: boolean;
}

export interface TuningParams {
  model: string;
  provider: string;
  thinkLevel: ThinkLevel;
  temperature: number;
  maxTokens: number;
  fastMode: boolean;
  verbose: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: SessionTuningState = {
  model:       "claude-sonnet-4-6",
  provider:    "anthropic",
  thinkLevel:  "off",
  temperature: 0.7,
  maxTokens:   4096,
  fastMode:    false,
  verbose:     false,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const [tuningStore, setTuningStore] =
  createStore<SessionTuningState>({ ...DEFAULTS });

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Update a single tuning field. Type-safe via keyof.
 */
export function setTuning<K extends keyof SessionTuningState>(
  field: K,
  value: SessionTuningState[K],
): void {
  setTuningStore(field, value);
}

/**
 * Reset all tuning fields to their defaults.
 */
export function resetTuning(): void {
  setTuningStore({ ...DEFAULTS });
}

/**
 * Returns the params object to spread into agent.stream requests.
 * Only non-default values make the payload noisier; we always send all
 * so the server can apply them consistently.
 */
export function getTuningParams(): TuningParams {
  return {
    model:       tuningStore.model,
    provider:    tuningStore.provider,
    thinkLevel:  tuningStore.thinkLevel,
    temperature: tuningStore.temperature,
    maxTokens:   tuningStore.maxTokens,
    fastMode:    tuningStore.fastMode,
    verbose:     tuningStore.verbose,
  };
}

/**
 * Initialise from server config defaults if available.
 * Called after loadConfig() resolves.
 */
export function initTuningFromConfig(cfg: {
  defaultModel?: string;
  defaultProvider?: string;
  thinkLevel?: string;
  temperature?: number;
}): void {
  if (cfg.defaultModel)    setTuningStore("model",      cfg.defaultModel);
  if (cfg.defaultProvider) setTuningStore("provider",   cfg.defaultProvider);
  if (cfg.thinkLevel)      setTuningStore("thinkLevel", cfg.thinkLevel as ThinkLevel);
  if (typeof cfg.temperature === "number") setTuningStore("temperature", cfg.temperature);
}
