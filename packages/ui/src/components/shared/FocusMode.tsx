/**
 * FocusMode — fullscreen chat overlay that removes all chrome.
 * Triggered via `/focus` command or the expand button in ChatView header.
 * Escape key exits. LukeW: remove distractions for the primary task.
 */
import { type Component, type JSX, Show, onMount, onCleanup } from "solid-js";
import { tokens as t } from "../../design/tokens";

interface FocusModeProps {
  active: boolean;
  onExit: () => void;
  children: JSX.Element;
}

const FocusMode: Component<FocusModeProps> = (props) => {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && props.active) {
      e.preventDefault();
      props.onExit();
    }
  };

  onMount(() => window.addEventListener("keydown", handleKey));
  onCleanup(() => window.removeEventListener("keydown", handleKey));

  return (
    <Show when={props.active} fallback={props.children}>
      {/* Vignette overlay behind the content box */}
      <div style={{
        position: "fixed", inset: "0",
        background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)",
        "z-index": "500", "pointer-events": "none",
      }} />

      {/* Fullscreen container */}
      <div style={{
        position: "fixed", inset: "0",
        background: t.color.bg,
        "z-index": "490",
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
      }}>
        {/* Minimal top bar: exit button only */}
        <div style={{
          display: "flex", "align-items": "center", "justify-content": "space-between",
          padding: `${t.space.xs} ${t.space.md}`,
          "flex-shrink": "0",
          "border-bottom": `1px solid ${t.color.border}`,
          background: t.color.bgSidebar,
        }}>
          <span style={{
            "font-size": t.font.sizeMd,
            "font-weight": t.font.weightBold,
            color: t.color.textDim,
            "letter-spacing": "-0.01em",
          }}>Focus</span>
          <button
            onClick={props.onExit}
            title="Exit focus mode (Esc)"
            style={{
              background: "transparent", border: `1px solid ${t.color.border}`,
              "border-radius": t.radius.md, color: t.color.textMuted,
              cursor: "pointer", "font-family": t.font.family,
              "font-size": t.font.sizeSm, padding: `2px ${t.space.sm}`,
              display: "flex", "align-items": "center", gap: t.space.xs,
              transition: `color ${t.transition.fast}, border-color ${t.transition.fast}`,
            }}
          >
            <span style={{ "font-size": "11px" }}>✕</span>
            <kbd style={{
              "font-family": t.font.familyMono, "font-size": t.font.sizeSm,
              color: t.color.textDim,
            }}>Esc</kbd>
          </button>
        </div>

        {/* Chat content fills remaining space */}
        <div style={{ flex: "1", overflow: "hidden", display: "flex", "flex-direction": "column" }}>
          {props.children}
        </div>
      </div>
    </Show>
  );
};

export default FocusMode;
