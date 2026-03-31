import { type Component, type JSX, For } from "solid-js";
import { tokens as t } from "../design/tokens";

// ── LoadingSpinner ────────────────────────────────────────────────────────────

export const LoadingSpinner: Component = () => (
  <>
    <style>{`
      @keyframes nx-loading-spin { to { transform: rotate(360deg); } }
      .nx-loading-spinner {
        width: 24px; height: 24px;
        border: 2px solid ${t.color.border};
        border-top-color: ${t.color.accent};
        border-radius: 50%;
        animation: nx-loading-spin 0.7s linear infinite;
        display: inline-block;
      }
    `}</style>
    <div
      class="nx-loading-spinner"
      role="status"
      aria-label="Loading"
      style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: t.space.md }}
    />
  </>
);

// ── Skeleton ──────────────────────────────────────────────────────────────────

interface SkeletonProps { lines?: number; }

export const Skeleton: Component<SkeletonProps> = (props) => {
  const count = () => props.lines ?? 3;
  return (
    <>
      <style>{`
        @keyframes nx-shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .nx-skeleton-bar {
          background: linear-gradient(90deg, ${t.color.bgCard} 25%, ${t.color.bgHover} 50%, ${t.color.bgCard} 75%);
          background-size: 800px 100%;
          animation: nx-shimmer 1.4s infinite linear;
          border-radius: ${t.radius.sm};
          height: 14px;
          margin-bottom: ${t.space.sm};
        }
      `}</style>
      <div aria-busy="true" aria-label="Loading content">
        <For each={Array.from({ length: count() })}>
          {(_, i) => (
            <div
              class="nx-skeleton-bar"
              style={{ width: i() === count() - 1 ? "60%" : "100%" }}
            />
          )}
        </For>
      </div>
    </>
  );
};

// ── LoadingOverlay ────────────────────────────────────────────────────────────

export const LoadingOverlay: Component<{ label?: string }> = (props) => (
  <div style={{
    display: "flex", "flex-direction": "column",
    "align-items": "center", "justify-content": "center",
    height: "100%", gap: t.space.md, color: t.color.textMuted,
    "font-family": t.font.family, "font-size": t.font.sizeMd,
  }}>
    <LoadingSpinner />
    {props.label ?? "Loading…"}
  </div>
);

// Re-export JSX type for consumers
export type { JSX };
