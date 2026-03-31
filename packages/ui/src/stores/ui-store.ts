import { createStore } from "solid-js/store";
import type { TabName, ThemeName } from "../gateway/types";

// ── UI store ──────────────────────────────────────────────────────────────────

export interface UiState {
  tab: TabName;
  theme: ThemeName;
  commandPaletteOpen: boolean;
}

export const [uiStore, setUiStore] = createStore<UiState>({
  tab: "overview",
  theme: "dark",
  commandPaletteOpen: false,
});

export function setTab(tab: TabName): void {
  setUiStore("tab", tab);
}

export function setTheme(theme: ThemeName): void {
  setUiStore("theme", theme);
}

export function setCommandPaletteOpen(open: boolean): void {
  setUiStore("commandPaletteOpen", open);
}
