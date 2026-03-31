import { ErrorBoundary, type JSX } from "solid-js";
import { tokens as t } from "../design/tokens";

// ── SafePanel — wraps any panel in an ErrorBoundary ───────────────────────────

interface SafePanelProps {
  name: string;
  children: JSX.Element;
}

export function SafePanel(props: SafePanelProps): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(err) => (
        <div
          role="alert"
          style={{
            padding: t.space.lg,
            background: "rgba(244,67,54,0.08)",
            border: `1px solid ${t.color.error}`,
            "border-radius": t.radius.lg,
            color: t.color.text,
            "font-family": t.font.family,
            "font-size": t.font.sizeMd,
          }}
        >
          <div style={{ "font-weight": t.font.weightBold, color: t.color.error, "margin-bottom": t.space.sm }}>
            Error in {props.name}
          </div>
          <div style={{ color: t.color.textMuted }}>
            {err instanceof Error ? err.message : String(err)}
          </div>
        </div>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}
