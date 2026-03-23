import { type Component, For, createSignal, createMemo, onCleanup } from "solid-js";
import { setTab } from "../../stores/actions";
import type { TabName } from "../../gateway/types";
import { tokens as t } from "../../design/tokens";

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const ALL_COMMANDS: Command[] = [
  { id: "nav:chat",      label: "Go to Chat",      description: "Open the chat view",         shortcut: "G C", action: () => setTab("chat" as TabName) },
  { id: "nav:sessions",  label: "Go to Sessions",  description: "Open session history",       shortcut: "G S", action: () => setTab("sessions" as TabName) },
  { id: "nav:agents",    label: "Go to Agents",    description: "Manage agents",              shortcut: "G A", action: () => setTab("agents" as TabName) },
  { id: "nav:cron",      label: "Go to Cron",      description: "Schedule recurring tasks",   shortcut: "G R", action: () => setTab("cron" as TabName) },
  { id: "nav:config",    label: "Go to Config",    description: "Edit configuration",         shortcut: "G X", action: () => setTab("config" as TabName) },
  { id: "nav:analytics", label: "Go to Analytics", description: "View usage and stats",       shortcut: "G N", action: () => setTab("analytics" as TabName) },
];

function fuzzyMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let ni = 0;
  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (h[hi] === n[ni]) ni++;
  }
  return ni === n.length;
}

const CommandPalette: Component<Props> = (props) => {
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query().trim();
    return ALL_COMMANDS.filter(c =>
      fuzzyMatch(q, c.label) || (c.description ? fuzzyMatch(q, c.description) : false)
    );
  });

  const run = (cmd: Command) => {
    cmd.action();
    props.onClose();
    setQuery("");
    setCursor(0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const cmds = filtered();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, cmds.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      const cmd = cmds[cursor()];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      props.onClose();
      setQuery("");
      setCursor(0);
    }
  };

  if (!props.open) return null;

  return (
    <div
      style={{ position: "fixed", inset: "0", background: t.color.bgOverlay, "z-index": "1000", display: "flex", "align-items": "flex-start", "justify-content": "center", "padding-top": "15vh" }}
      onClick={props.onClose}
    >
      <div
        style={{ background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.xl, "box-shadow": t.shadow.xl, width: "min(560px, 90vw)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ display: "flex", "align-items": "center", gap: t.space.sm, padding: `${t.space.sm} ${t.space.md}`, "border-bottom": `1px solid ${t.color.border}` }}>
          <span style={{ color: t.color.textMuted, "font-size": "14px", "flex-shrink": "0" }}>⌘</span>
          <input
            ref={(el) => setTimeout(() => el?.focus(), 0)}
            type="text"
            placeholder="Search commands…"
            value={query()}
            onInput={(e) => { setQuery(e.currentTarget.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            style={{ flex: "1", background: "transparent", border: "none", outline: "none", color: t.color.text, "font-family": t.font.family, "font-size": t.font.sizeLg, padding: `${t.space.sm} 0` }}
          />
          <kbd style={{ "font-size": t.font.sizeSm, color: t.color.textDim, background: t.color.bgHover, border: `1px solid ${t.color.border}`, "border-radius": t.radius.sm, padding: "2px 6px", "font-family": t.font.familyMono }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ "max-height": "360px", overflow: "auto" }}>
          <For each={filtered()} fallback={
            <div style={{ padding: `${t.space.lg} ${t.space.md}`, "text-align": "center", color: t.color.textMuted, "font-size": t.font.sizeMd }}>No commands found</div>
          }>
            {(cmd, i) => (
              <div
                onClick={() => run(cmd)}
                style={{ display: "flex", "align-items": "center", gap: t.space.md, padding: `${t.space.sm} ${t.space.md}`, cursor: "pointer", background: cursor() === i() ? t.color.bgHover : "transparent", "border-left": cursor() === i() ? `3px solid ${t.color.accent}` : "3px solid transparent", transition: `background ${t.transition.fast}` }}
                onMouseEnter={() => setCursor(i())}
              >
                <div style={{ flex: "1" }}>
                  <div style={{ "font-size": t.font.sizeMd, color: t.color.text, "font-weight": cursor() === i() ? t.font.weightMedium : t.font.weightNormal }}>{cmd.label}</div>
                  {cmd.description && <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "margin-top": "2px" }}>{cmd.description}</div>}
                </div>
                {cmd.shortcut && (
                  <div style={{ display: "flex", gap: "3px" }}>
                    {cmd.shortcut.split(" ").map(k => (
                      <kbd style={{ "font-size": t.font.sizeSm, color: t.color.textDim, background: t.color.bgHover, border: `1px solid ${t.color.border}`, "border-radius": t.radius.sm, padding: "2px 6px", "font-family": t.font.familyMono }}>{k}</kbd>
                    ))}
                  </div>
                )}
              </div>
            )}
          </For>
        </div>

        {/* Footer hint */}
        <div style={{ padding: `${t.space.xs} ${t.space.md}`, "border-top": `1px solid ${t.color.border}`, display: "flex", gap: t.space.md, color: t.color.textDim, "font-size": t.font.sizeSm }}>
          <span><kbd style={{ "font-family": t.font.familyMono }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ "font-family": t.font.familyMono }}>↵</kbd> select</span>
          <span><kbd style={{ "font-family": t.font.familyMono }}>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
