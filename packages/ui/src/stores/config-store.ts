import { createStore } from "solid-js/store";

// ── Config store ──────────────────────────────────────────────────────────────

export interface ConfigState {
  gateway: Record<string, unknown>;
  agent: Record<string, unknown>;
  security: Record<string, unknown>;
  channels: Record<string, unknown>;
}

export const [configStore, setConfigStore] = createStore<ConfigState>({
  gateway: {},
  agent: {},
  security: {},
  channels: {},
});

export function setConfigSection(
  section: keyof ConfigState,
  value: Record<string, unknown>,
): void {
  setConfigStore(section, value);
}
