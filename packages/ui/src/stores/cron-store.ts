import { createStore } from "solid-js/store";
import type { CronJob, CronRunHistory } from "../gateway/types";

// ── Cron store ────────────────────────────────────────────────────────────────

export interface CronState {
  jobs: CronJob[];
  history: CronRunHistory[];
}

export const [cronStore, setCronStore] = createStore<CronState>({
  jobs: [],
  history: [],
});

export function setCronJobs(jobs: CronJob[]): void {
  setCronStore("jobs", jobs);
}

export function setCronHistory(history: CronRunHistory[]): void {
  setCronStore("history", history);
}
