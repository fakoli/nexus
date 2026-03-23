import { type Component, type JSX, type ParentComponent, Show, createSignal } from "solid-js";
import { tokens as t } from "./tokens";

// ── Button ────────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: JSX.CSSProperties;
  children: JSX.Element;
}

export const Button: Component<ButtonProps> = (props) => {
  const base: JSX.CSSProperties = {
    display: "inline-flex", "align-items": "center", gap: t.space.xs,
    "border-radius": t.radius.md, "font-family": t.font.family,
    "font-size": t.font.sizeMd, "font-weight": t.font.weightBold,
    padding: `7px ${t.space.md}`, cursor: "pointer", border: "none",
    transition: `opacity ${t.transition.normal}`, "white-space": "nowrap",
  };
  const variants: Record<ButtonVariant, JSX.CSSProperties> = {
    primary:   { background: t.color.accent, color: "#fff" },
    secondary: { background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.text },
    ghost:     { background: "transparent", color: t.color.textMuted },
  };
  const v = () => props.variant ?? "primary";
  const isOff = () => props.loading || props.disabled;

  return (
    <button
      onClick={props.onClick}
      disabled={isOff()}
      style={{ ...base, ...variants[v()], opacity: isOff() ? "0.45" : "1", cursor: isOff() ? "not-allowed" : "pointer", ...props.style }}
    >
      {props.loading ? "…" : props.children}
    </button>
  );
};

// ── Input ─────────────────────────────────────────────────────────────────────

interface InputProps {
  label?: string;
  error?: string;
  placeholder?: string;
  value?: string;
  type?: string;
  onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>;
  style?: JSX.CSSProperties;
}

export const Input: Component<InputProps> = (props) => {
  const inputStyle: JSX.CSSProperties = {
    width: "100%", background: t.color.bgInput, border: `1px solid ${props.error ? t.color.error : t.color.border}`,
    "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.family,
    "font-size": t.font.sizeMd, padding: `7px ${t.space.sm}`, outline: "none",
    transition: `border-color ${t.transition.normal}`, ...props.style,
  };
  return (
    <div>
      <Show when={props.label}>
        <label style={{ display: "block", "margin-bottom": t.space.xs, "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
          {props.label}
        </label>
      </Show>
      <input type={props.type ?? "text"} placeholder={props.placeholder} value={props.value ?? ""} onInput={props.onInput} style={inputStyle} />
      <Show when={props.error}>
        <span style={{ display: "block", "margin-top": t.space.xs, "font-size": t.font.sizeSm, color: t.color.error }}>{props.error}</span>
      </Show>
    </div>
  );
};

// ── Select ────────────────────────────────────────────────────────────────────

interface SelectOption { value: string; label: string; }
interface SelectProps {
  label?: string;
  value?: string;
  options: SelectOption[];
  onChange?: JSX.EventHandler<HTMLSelectElement, Event>;
}

export const Select: Component<SelectProps> = (props) => (
  <div>
    <Show when={props.label}>
      <label style={{ display: "block", "margin-bottom": t.space.xs, "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "text-transform": "uppercase", "letter-spacing": "0.05em" }}>{props.label}</label>
    </Show>
    <select value={props.value} onChange={props.onChange}
      style={{ width: "100%", background: t.color.bgInput, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.family, "font-size": t.font.sizeMd, padding: `7px ${t.space.sm}`, outline: "none" }}>
      {props.options.map(o => <option value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ── Toggle ────────────────────────────────────────────────────────────────────

interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; label?: string; }

export const Toggle: Component<ToggleProps> = (props) => (
  <label style={{ display: "flex", "align-items": "center", gap: t.space.sm, cursor: "pointer" }}>
    <div style={{ position: "relative", width: "36px", height: "20px", "flex-shrink": "0" }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)}
        style={{ opacity: "0", width: "0", height: "0", position: "absolute" }} />
      <div style={{ position: "absolute", inset: "0", background: props.checked ? t.color.accent : t.color.border, "border-radius": t.radius.full, transition: `background ${t.transition.normal}` }} />
      <div style={{ position: "absolute", top: "3px", left: props.checked ? "19px" : "3px", width: "14px", height: "14px", background: "#fff", "border-radius": t.radius.full, transition: `left ${t.transition.normal}` }} />
    </div>
    <Show when={props.label}>
      <span style={{ "font-size": t.font.sizeMd, color: t.color.text }}>{props.label}</span>
    </Show>
  </label>
);

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant = "success" | "warning" | "error" | "info" | "default";
interface BadgeProps { variant?: BadgeVariant; children: JSX.Element; }

export const Badge: Component<BadgeProps> = (props) => {
  const colors: Record<BadgeVariant, [string, string]> = {
    success: [t.color.success, "rgba(76,175,80,0.15)"],
    warning: [t.color.warning, "rgba(255,167,38,0.15)"],
    error:   [t.color.error,   "rgba(244,67,54,0.15)"],
    info:    [t.color.info,    "rgba(41,182,246,0.15)"],
    default: [t.color.textMuted, t.color.bgHover],
  };
  const [fg, bg] = colors[props.variant ?? "default"];
  return (
    <span style={{ display: "inline-block", padding: `1px 8px`, "border-radius": t.radius.full, "font-size": t.font.sizeSm, "font-weight": t.font.weightBold, color: fg, background: bg, "white-space": "nowrap" }}>
      {props.children}
    </span>
  );
};

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps { title?: string; style?: JSX.CSSProperties; children: JSX.Element; }

export const Card: ParentComponent<CardProps> = (props) => (
  <div style={{ background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.lg, padding: t.space.md, ...props.style }}>
    <Show when={props.title}>
      <div style={{ "font-size": t.font.sizeMd, "font-weight": t.font.weightBold, color: t.color.text, "margin-bottom": t.space.md }}>{props.title}</div>
    </Show>
    {props.children}
  </div>
);

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps { title: string; open: boolean; onClose: () => void; actions?: JSX.Element; children: JSX.Element; }

export const Modal: Component<ModalProps> = (props) => (
  <Show when={props.open}>
    <div style={{ position: "fixed", inset: "0", background: t.color.bgOverlay, "z-index": "1000", display: "flex", "align-items": "center", "justify-content": "center" }} onClick={props.onClose}>
      <div style={{ background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.xl, "box-shadow": t.shadow.xl, width: "min(480px, 90vw)", "max-height": "80vh", display: "flex", "flex-direction": "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: `${t.space.md} ${t.space.lg}`, "border-bottom": `1px solid ${t.color.border}`, "font-weight": t.font.weightBold, "font-size": t.font.sizeLg, color: t.color.text, "flex-shrink": "0" }}>{props.title}</div>
        <div style={{ padding: t.space.lg, overflow: "auto", flex: "1" }}>{props.children}</div>
        <Show when={props.actions}>
          <div style={{ padding: `${t.space.sm} ${t.space.lg}`, "border-top": `1px solid ${t.color.border}`, display: "flex", gap: t.space.sm, "justify-content": "flex-end", "flex-shrink": "0" }}>{props.actions}</div>
        </Show>
      </div>
    </div>
  </Show>
);

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps { text: string; children: JSX.Element; }

export const Tooltip: Component<TooltipProps> = (props) => {
  const [show, setShow] = createSignal(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {props.children}
      <Show when={show()}>
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: t.color.bgHover, border: `1px solid ${t.color.border}`, "border-radius": t.radius.sm, padding: `${t.space.xs} ${t.space.sm}`, "font-size": t.font.sizeSm, color: t.color.text, "white-space": "nowrap", "z-index": "200", "pointer-events": "none", "box-shadow": t.shadow.md }}>
          {props.text}
        </div>
      </Show>
    </div>
  );
};
