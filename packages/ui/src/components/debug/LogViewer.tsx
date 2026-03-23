import { type Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { gateway } from "../../stores/app";
import { tokens as t } from "../../design/tokens";
import { Button, Badge } from "../../design/components";
import type { LogEntry, LogLevel } from "../../gateway/types";

// ── Level config ──────────────────────────────────────────────────────────────

const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: t.color.textDim,
  debug: t.color.textMuted,
  info:  t.color.info,
  warn:  t.color.warning,
  error: t.color.error,
  fatal: t.color.error,
};

const LEVEL_BG: Record<LogLevel, string> = {
  trace: "rgba(90,90,122,0.15)",
  debug: "rgba(136,136,170,0.15)",
  info:  "rgba(41,182,246,0.15)",
  warn:  "rgba(255,167,38,0.15)",
  error: "rgba(244,67,54,0.15)",
  fatal: "rgba(244,67,54,0.3)",
};

// ── Log row ───────────────────────────────────────────────────────────────────

const LogRow: Component<{ entry: LogEntry }> = (p) => {
  const [open, setOpen] = createSignal(false);
  const hasData = () => p.entry.data && Object.keys(p.entry.data).length > 0;
  const ts = () => new Date(p.entry.ts).toISOString().slice(11, 23);

  return (
    <div style={{ "border-bottom": `1px solid ${t.color.border}`, padding: `5px ${t.space.sm}`, "font-family": t.font.familyMono, "font-size": t.font.sizeSm }}>
      <div style={{ display: "flex", "align-items": "baseline", gap: t.space.sm, cursor: hasData() ? "pointer" : "default" }} onClick={() => hasData() && setOpen(v => !v)}>
        <span style={{ color: t.color.textDim, "flex-shrink": "0", "min-width": "90px" }}>{ts()}</span>
        <span style={{ display: "inline-block", padding: "1px 6px", "border-radius": t.radius.sm, "font-size": "10px", "font-weight": t.font.weightBold, color: LEVEL_COLOR[p.entry.level], background: LEVEL_BG[p.entry.level], "flex-shrink": "0", "min-width": "44px", "text-align": "center" }}>
          {p.entry.level.toUpperCase()}
        </span>
        <span style={{ color: t.color.text, flex: "1", "white-space": "pre-wrap", "word-break": "break-word" }}>{p.entry.msg}</span>
        <Show when={hasData()}>
          <span style={{ color: t.color.textDim, "flex-shrink": "0" }}>{open() ? "▾" : "▸"}</span>
        </Show>
      </div>
      <Show when={open() && hasData()}>
        <pre style={{ margin: `${t.space.xs} 0 0 102px`, padding: t.space.sm, background: t.color.bgCard, "border-radius": t.radius.sm, color: t.color.textMuted, "font-size": "11px", overflow: "auto", "max-height": "200px" }}>
          {JSON.stringify(p.entry.data, null, 2)}
        </pre>
      </Show>
    </div>
  );
};

// ── LogViewer ─────────────────────────────────────────────────────────────────

const LogViewer: Component = () => {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [enabledLevels, setEnabledLevels] = createSignal<Set<LogLevel>>(new Set(LEVELS));
  const [search, setSearch] = createSignal("");
  const [paused, setPaused] = createSignal(false);
  let scrollRef: HTMLDivElement | undefined;
  let userScrolled = false;

  const filtered = () => {
    const q = search().toLowerCase();
    const levels = enabledLevels();
    return logs().filter(e => levels.has(e.level) && (!q || e.msg.toLowerCase().includes(q)));
  };

  onMount(() => {
    const unsub = gateway.onEvent("log", (payload) => {
      const entry = payload as unknown as LogEntry;
      if (!paused()) {
        setLogs(prev => [...prev.slice(-2000), { ...entry, id: entry.id ?? crypto.randomUUID() }]);
        if (!userScrolled && scrollRef) {
          requestAnimationFrame(() => { if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight; });
        }
      }
    });
    onCleanup(unsub);
  });

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels(prev => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  };

  const onScroll = () => {
    if (!scrollRef) return;
    const atBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 40;
    userScrolled = !atBottom;
    if (atBottom) setPaused(false);
  };

  const exportLogs = () => {
    const text = filtered().map(e => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.msg}${e.data ? " " + JSON.stringify(e.data) : ""}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "nexus-logs.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", background: t.color.bg }}>

      {/* ── Toolbar ── */}
      <div style={{ "flex-shrink": "0", display: "flex", "align-items": "center", gap: t.space.sm, padding: `${t.space.sm} ${t.space.md}`, "border-bottom": `1px solid ${t.color.border}`, "flex-wrap": "wrap" }}>
        <span style={{ "font-size": t.font.sizeMd, "font-weight": t.font.weightBold, color: t.color.text, "margin-right": t.space.xs }}>Logs</span>

        {/* Level toggles */}
        <div style={{ display: "flex", gap: "4px" }}>
          <For each={LEVELS}>
            {(level) => {
              const on = () => enabledLevels().has(level);
              return (
                <button onClick={() => toggleLevel(level)} style={{ padding: "2px 8px", "border-radius": t.radius.sm, border: `1px solid ${on() ? LEVEL_COLOR[level] : t.color.border}`, background: on() ? LEVEL_BG[level] : "transparent", color: on() ? LEVEL_COLOR[level] : t.color.textDim, "font-size": "11px", "font-weight": t.font.weightBold, cursor: "pointer", "font-family": t.font.familyMono, transition: `all ${t.transition.fast}` }}>
                  {level.toUpperCase()}
                </button>
              );
            }}
          </For>
        </div>

        {/* Search */}
        <input
          type="text" placeholder="Filter…" value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: "1", "min-width": "120px", background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono, "font-size": t.font.sizeSm, padding: "4px 8px", outline: "none" }}
        />

        <Show when={paused()}>
          <Badge variant="warning">Paused</Badge>
        </Show>

        <Button variant="ghost" onClick={() => setLogs([])}>Clear</Button>
        <Button variant="secondary" onClick={exportLogs}>Export</Button>
      </div>

      {/* ── Log stream ── */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: "1", overflow: "auto", "font-family": t.font.familyMono }}>
        <Show when={filtered().length === 0}>
          <div style={{ padding: t.space.xl, "text-align": "center", color: t.color.textDim, "font-size": t.font.sizeSm }}>
            {logs().length === 0 ? "Waiting for log events from gateway…" : "No entries match current filters."}
          </div>
        </Show>
        <For each={filtered()}>
          {(entry) => <LogRow entry={entry} />}
        </For>
      </div>

      {/* ── Footer ── */}
      <div style={{ "flex-shrink": "0", padding: `${t.space.xs} ${t.space.md}`, "border-top": `1px solid ${t.color.border}`, display: "flex", "align-items": "center", gap: t.space.md }}>
        <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim, "font-family": t.font.familyMono }}>{filtered().length} / {logs().length} entries</span>
        <div style={{ flex: "1" }} />
        <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>Scroll to bottom to resume auto-scroll</span>
      </div>
    </div>
  );
};

export default LogViewer;
