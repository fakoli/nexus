import { createSignal } from "solid-js";

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function saveSet(key: string, s: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    // ignore storage errors (e.g. private browsing quota)
  }
}

// ── Signals ───────────────────────────────────────────────────────────────────

const PINNED_KEY = "nexus:pinnedMessages";
const DELETED_KEY = "nexus:deletedMessages";

const [pinnedMessages, setPinnedMessages] = createSignal<Set<string>>(
  loadSet(PINNED_KEY),
);
const [deletedMessages, setDeletedMessages] = createSignal<Set<string>>(
  loadSet(DELETED_KEY),
);
const [showDeleted, setShowDeleted] = createSignal(false);

// ── Exported read signals ─────────────────────────────────────────────────────

export { pinnedMessages, deletedMessages, showDeleted };

// ── Mutators ──────────────────────────────────────────────────────────────────

export function togglePin(id: string): void {
  setPinnedMessages((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    saveSet(PINNED_KEY, next);
    return next;
  });
}

export function toggleDelete(id: string): void {
  setDeletedMessages((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    saveSet(DELETED_KEY, next);
    return next;
  });
}

export function toggleShowDeleted(): void {
  setShowDeleted((v) => !v);
}

// ── Derived helpers ───────────────────────────────────────────────────────────

export function isPinned(id: string): boolean {
  return pinnedMessages().has(id);
}

export function isDeleted(id: string): boolean {
  return deletedMessages().has(id);
}
