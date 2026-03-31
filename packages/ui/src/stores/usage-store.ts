import { createStore } from "solid-js/store";
import type { UsageSummary } from "../gateway/types";

// ── Usage store ───────────────────────────────────────────────────────────────

export interface UsageState {
  summary: UsageSummary | null;
}

export const [usageStore, setUsageStore] = createStore<UsageState>({
  summary: null,
});

export function setUsageSummary(summary: UsageSummary | null): void {
  setUsageStore("summary", summary);
}
