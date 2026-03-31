import { createSignal } from "solid-js";

// ── Focus mode signal — replaces window custom events ────────────────────────

const [focusMode, setFocusMode] = createSignal(false);

export { focusMode, setFocusMode };
